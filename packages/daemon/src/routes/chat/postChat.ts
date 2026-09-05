import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  loadConfig,
  getPool,
  isDbHealthy,
  recordCostCall,
  anotar,
  appendUsageMetadata,
  getSoul,
  sumCostBySoul,
  openSession,
  bumpSessionPrompt,
  recordSessionMessage,
  recordExecution,
  logger,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  purgeCredentials,
  resolveTarget,
  recordRouterSelection,
  estimateTokens,
  nextZenApiKey,
} from "@assistente-os/core";
import { maxFindingSeverity, scoreAnswerFaithfulness } from "@assistente-os/memory";
import { recordRagEvalRun } from "@assistente-os/core";
import { runLangGraphAgentStream } from "../../langgraph-runner.js";
import { routeFromPrompt, type ExecutionMode } from "../../orchestrator/router.js";
import {
  escalationConfig,
  shouldEscalate,
  shouldRunJudge,
  judgeAnswer,
  nextEscalationTier,
  looksLikeRefusal,
  canEscalateSession,
  recordSessionEscalation,
} from "../../orchestrator/escalation.js";
import { sendJson, parseBody, optionalTrimmedString, makeLocalFallbackProbe, type RequestContext } from "../shared.js";
import { getRequestAccountId } from "../accountAuth.js";
import { chatRequests, chatLatency, tokensTotal, routerEscalation, ollamaPrefillSeconds, ollamaPromptEvalTokens } from "../../observability/metrics.js";
import { ollamaChat, handleChatDegraded, preparePromptContext, type ExecUsage } from "../../promptPipeline.js";

const TIMEOUT_RANGE_MSG = "timeoutSeconds deve ser um inteiro entre 1 e 600";

const PostChatSchema = z.object({
  prompt: z.string().refine((v) => v.trim().length > 0, { message: "prompt é obrigatório" }),
  timeoutSeconds: z.number().int(TIMEOUT_RANGE_MSG).min(1, TIMEOUT_RANGE_MSG).max(600, TIMEOUT_RANGE_MSG).optional().default(300),
  model: optionalTrimmedString(),
  tier: optionalTrimmedString(),
  mode: z.enum(["fast", "pro"]).optional(),
  langgraphMode: z.string().optional(),
  memorizar: z.boolean().optional().default(false),
});

export async function handlePostChat(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub } = context;
  const chatMatch = path.match(/^\/souls\/([^/]+)\/chat$/);
  if (!chatMatch || req.method !== "POST") return false;
  const parsed = await parseBody(req, PostChatSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const { prompt, timeoutSeconds, langgraphMode, memorizar } = parsed.data;
  const requestedModel = parsed.data.model ?? undefined;
  const requestedTier = parsed.data.tier ?? undefined;
  const explicitMode: ExecutionMode | undefined = parsed.data.mode;
  const soul = getSoul(home, decodeURIComponent(chatMatch[1]!));
  if (!soul) {
    sendJson(res, 404, { error: "soul não encontrada" });
    return true;
  }
  const accountId = getRequestAccountId(req);
  if (accountId != null && soul.config.ownerAccountId !== accountId) {
    sendJson(res, 403, { error: "soul não pertence a esta conta" });
    return true;
  }
  const config = await loadConfig({ home });
  const pool = getPool(config.databaseUrl);

  // SPEC-HR1: sonda antes de entrar em preparePromptContext (que lançaria
  // na primeira query, sumCostBySoul) — degrada pra Markdown-only em vez
  // de devolver 500 sem registro nenhum da troca.
  if (!(await isDbHealthy(pool))) {
    return handleChatDegraded(res, soul, prompt, home, config);
  }

  const prepared = await preparePromptContext({
    req,
    pool,
    home,
    config,
    soul,
    prompt,
    createStepSink: (traceId) => (module, message, level) => {
      try {
        hub.broadcast(
          { type: "chat.step", soul: soul.id, ts: Date.now(), module, message, level, traceId },
          { accountId: soul.config.ownerAccountId ?? null },
        );
      } catch {
        /* ws opcional */
      }
    },
  });
  if (!prepared.ok) {
    sendJson(res, prepared.status, prepared.body);
    return true;
  }
  try {
    res.setHeader("x-trace-id", prepared.context.traceId);
  } catch {
    /* headers já enviados — ignora */
  }
  const { session, promptsUsed, dailyLimit, spentToday, maxTurns, promptSanitized, history, built, traceId, traceStartedAt, emitStep } =
    prepared.context;
  // SPEC-HR2: sanitizeUserPrompt/sanitizeLLMResponse guardam segredos detectados
  // no temp-vault sob taskId=session.id (zero-persistência prometida em
  // temp-vault.ts). Nada no sistema lê esse valor de volta — o vault só existe
  // pra não deixar o segredo em claro em memória além do necessário. `finally`
  // garante a purga mesmo se a execução abaixo lançar/der timeout.
  try {
    // route() sonda cada degrau (sem executar o prompt) e cai para o próximo se o
    // degrau local não responder; a execução real acontece uma única vez, abaixo,
    // no degrau vencedor.
    const orchDecision = await routeFromPrompt(pool, config, soul, promptSanitized.sanitized, makeLocalFallbackProbe(config.ollamaUrl), explicitMode);
    // tier "langgraph" pedido explicitamente pela UI/API força o degrau —
    // o roteador automático (routeFromPrompt) nunca escolhe "langgraph"
    // sozinho (não é um dos tiers configurados em config.routerTiers), então
    // sem este override o pedido do usuário era ignorado e a resposta ainda
    // rodava no degrau normal (ollama/zen/soul).
    let decision = orchDecision.route;
    if (requestedTier === "langgraph") {
      const forcedTarget = resolveTarget(config, soul, "langgraph");
      await recordRouterSelection(pool, { soul, target: forcedTarget, reason: "tier explícito do usuário: langgraph" });
      decision = { target: forcedTarget };
    }
    let model = requestedModel ?? orchDecision.model;
    let tier = requestedTier ?? decision.target.tier;
    emitStep(
      "router",
      `tier selecionado: ${tier} → ${decision.target.provider}/${model} (${decision.reason ?? `modo ${orchDecision.mode}`})`,
    );
    const startedAt = Date.now();
    let result: { code: number; stdout: string; stderr: string; timedOut: boolean; toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }> };
    // E1/FinOps: uso de tokens da execução vencedora. Preenchido por cada branch
    // quando o provider expõe a contagem; senão fica undefined e cai no estimate.
    let execUsage: ExecUsage | undefined;
    if (decision.target.provider === "ollama") {
      let baseUrl = config.ollamaUrl;
      if (baseUrl.includes("host.docker.internal")) {
        baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
      }

      // resolveTarget() (core/router.ts) prefixa o model com "ollama/" de
      // propósito — é a sintaxe que o opencode espera pro provider "ollama"
      // customizado no opencode.jsonc. Mas aqui a chamada é direta pro
      // /api/chat do Ollama via fetch, sem passar pelo opencode — Ollama
      // não entende esse prefixo (nem "openai/"), só o nome puro do model.
      const ollamaModel = (requestedModel ?? decision.target.model).replace(/^(ollama|openai)\//, "");
      emitStep("ollama", `chamando Ollama (${ollamaModel}), timeout ${timeoutSeconds}s`);
      const oll = await ollamaChat(
        baseUrl,
        {
          model: ollamaModel,
          messages: [
            { role: "system", content: built.fullPrompt.replace(prompt, "").trim() },
            { role: "user", content: prompt },
          ],
          stream: false,
        },
        timeoutSeconds * 1000,
      );
      result = oll;
      execUsage = oll.usage;
      // Etapa 9: prefill do Ollama. Prompt caching / KV cache reaproveitado →
      // prompt_eval_count e prompt_eval_duration despencam no 2º turno.
      if (oll.prefill) {
        emitStep(
          "ollama",
          `prefill: ${oll.prefill.promptEvalCount} tokens em ${Math.round(oll.prefill.promptEvalMs)}ms`,
        );
        try {
          ollamaPrefillSeconds.observe(oll.prefill.promptEvalMs / 1000);
          ollamaPromptEvalTokens.observe(oll.prefill.promptEvalCount);
        } catch {
          /* métrica opcional */
        }
      }
    } else if (decision.target.provider === "langgraph") {
      emitStep("langgraph", `iniciando execução LangGraph (modo ${langgraphMode ?? "tools"})`);
      const lg = await runLangGraphAgentStream(pool, {
        soul: soul.id,
        prompt: promptSanitized.sanitized,
        timeoutSeconds,
        // threadId estável por sessão — sem isso runLangGraphAgentStream
        // gera um thread novo por chamada (soul-${soul}-${Date.now()}) e o
        // MemorySaver nunca reencontra o turno anterior, mesmo dentro da
        // mesma sessão. Continua in-memory (não sobrevive restart do daemon).
        threadId: `session-${session.id}`,
        // Reidrata o thread a partir do Postgres (session_messages) — o MemorySaver
        // é in-memory e não sobrevive a restart do daemon. seededThreads garante
        // injeção única por processo.
        seedMessages: history,
        useTools: langgraphMode !== "generate",
        onStep: (step: { node: string; iterationCount: number; messageCount: number; lastContent?: string; toolCalls?: { name: string; args: Record<string, unknown> }[] }) => {
          try {
            hub.broadcast(
              {
                type: "graph.step",
                soul: soul.id,
                node: step.node,
                iterationCount: step.iterationCount,
                messageCount: step.messageCount,
                lastContent: step.lastContent,
                toolCalls: step.toolCalls,
              },
              { accountId: soul.config.ownerAccountId ?? null },
            );
          } catch {
            /* ws opcional */
          }
        },
      });
      result = lg;
      // usage_metadata só vem quando o provider LLM devolve — senão fica p/ estimate.
      if (lg.usage && (lg.usage.inputTokens > 0 || lg.usage.outputTokens > 0)) {
        execUsage = { promptTokens: lg.usage.inputTokens, completionTokens: lg.usage.outputTokens, source: "provider" };
      }
    } else {
      emitStep("opencode", `executando via opencode (${model})`);
      const env = { ...(process.env as Record<string, string>) };
      // Tiers zen/soul rodam via `opencode run`, que lê a chave do provider
      // Zen de {env:ZEN_API_KEY}. Injeta a próxima chave do rodízio para
      // espalhar o consumo entre as chaves registradas (round-robin).
      const rotatedZenKey = nextZenApiKey(config);
      if (rotatedZenKey) env.ZEN_API_KEY = rotatedZenKey;
      result = await run!(built.fullPrompt, {
        cwd: soul.dir,
        model,
        timeoutSeconds,
        agent: soul.config.agent ? soul.id : undefined,
        soulId: soul.id,
        env,
      });
    }
    // T3.1 + Etapa 8 — escalonamento por confiança (default off).
    // Só a partir de `local`, sem tier/model fixados, no máx. N por sessão com
    // cooldown, e (default) só em `mode=fast`. Sinal: heurísticas baratas +
    // um juiz LLM local (SIM/NÃO) quando o RAG foi fraco. Inerte quando off.
    const escCfg = escalationConfig();
    if (escCfg.enabled && tier === "local" && !requestedTier && !requestedModel) {
      const localOk = result.code === 0 && !result.timedOut;
      const v = built.verdict as { ok?: boolean; sources?: Array<{ score?: number }> } | null;
      const answerChars = result.stdout.trim().length;
      const refusalLike = looksLikeRefusal(result.stdout);
      const baseSig = {
        localFailed: !localOk,
        ragOk: v?.ok === true,
        ragTopScore: v?.sources?.[0]?.score ?? 0,
        answerChars,
        answerRefusalLike: refusalLike,
        mode: orchDecision.mode,
      };

      // Juiz LLM só quando nenhum sinal barato já decidiu E o RAG foi fraco.
      let judge: "ok" | "weak" | "unknown" | undefined;
      const cheapDecides =
        (escCfg.fastModeOnly && orchDecision.mode !== "fast") ||
        baseSig.localFailed ||
        answerChars < escCfg.minAnswerChars ||
        refusalLike;
      if (!cheapDecides && shouldRunJudge(baseSig, escCfg)) {
        judge = await judgeAnswer(
          {
            pergunta: prompt,
            contexto: built.ragCtx || "(sem contexto)",
            resposta: result.stdout,
          },
          {
            chat: ollamaChat,
            ollamaUrl: config.ollamaUrl,
            model: config.ollamaChatModel,
            timeoutMs: Math.min(timeoutSeconds, 45) * 1000,
          },
        );
        emitStep("router", `juiz de confiança: ${judge}`);
      }

      const verdict = shouldEscalate({ ...baseSig, judge }, escCfg);
      if (verdict.escalate) {
        const gate = canEscalateSession(String(session.id), escCfg);
        if (!gate.ok) {
          emitStep("router", `escalonamento bloqueado (${gate.reason})`);
          try {
            routerEscalation.inc({ reason: gate.reason, to_tier: "-" });
          } catch {
            /* métrica opcional */
          }
        } else {
          const nextTier = nextEscalationTier(config.routerTiers, "local");
          if (nextTier) {
            const escTarget = resolveTarget(config, soul, nextTier);
            emitStep("router", `escalando local → ${nextTier} (${verdict.reason})`);
            try {
              routerEscalation.inc({ reason: verdict.reason, to_tier: nextTier });
            } catch {
              /* métrica opcional */
            }
            const escEnv = { ...(process.env as Record<string, string>) };
            const escKey = nextZenApiKey(config);
            if (escKey) escEnv.ZEN_API_KEY = escKey;
            const escResult = await run!(built.fullPrompt, {
              cwd: soul.dir,
              model: escTarget.model,
              timeoutSeconds,
              agent: soul.config.agent ? soul.id : undefined,
              soulId: soul.id,
              env: escEnv,
            });
            if (escResult.code === 0 && !escResult.timedOut) {
              result = escResult;
              execUsage = undefined; // opencode run não expõe usage → cai no estimate
              decision = { target: escTarget, reason: `escalado de local: ${verdict.reason}` };
              tier = nextTier;
              model = escTarget.model;
              recordSessionEscalation(String(session.id));
            } else {
              emitStep("router", "escalonamento falhou; mantém a resposta do local", "err");
            }
          }
        }
      }
    }

    const succeeded = result.code === 0 && !result.timedOut;
    emitStep(
      decision.target.provider,
      succeeded
        ? `execução concluída em ${Date.now() - startedAt}ms`
        : result.timedOut
          ? `timeout após ${Date.now() - startedAt}ms`
          : `erro na execução (código ${result.code})`,
      succeeded ? undefined : "err",
    );

    // E1/FinOps: uso real do provider quando disponível; senão heurística chars/4
    // sobre o prompt montado + a resposta, marcada como estimativa.
    const finalUsage: ExecUsage = execUsage ?? {
      promptTokens: estimateTokens(built.fullPrompt),
      completionTokens: estimateTokens(result.stdout),
      source: "estimate",
    };
    const totalTokens = finalUsage.promptTokens + finalUsage.completionTokens;

    await recordCostCall(pool, {
      soul: soul.id,
      provider: decision.target.provider,
      model,
      inputTokens: succeeded ? finalUsage.promptTokens : 0,
      outputTokens: succeeded ? finalUsage.completionTokens : 0,
      cost: 0,
      status: succeeded ? "ok" : "failed",
      note: `tier=${tier}; latency_ms=${Date.now() - startedAt}; tokens=${finalUsage.source}`,
    });
    await recordExecution(pool, {
      sessionId: session.id,
      soul: soul.id,
      kind: "chat",
      promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
      model,
      tier: tier,
      filesLoaded: built.files.filter((f) => f.chars > 0).length,
      tokensIn: succeeded ? finalUsage.promptTokens : 0,
      tokensOut: succeeded ? finalUsage.completionTokens : 0,
      contextChars: built.contextChars,
      verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
      status: succeeded ? "ok" : "failed",
      note: `latency_ms=${Date.now() - startedAt}`,
      traceId,
    });
    // SPEC-GR2: rodapé auditável na sessão do dia — telemetria em arquivo,
    // complementar aos registros em Postgres (que rotacionam/expiram).
    // Nunca deve derrubar a resposta do chat por um problema de I/O.
    try {
      appendUsageMetadata(soul.dir, {
        sessionId: session.id,
        promptTokens: succeeded ? finalUsage.promptTokens : 0,
        completionTokens: succeeded ? finalUsage.completionTokens : 0,
        latencyMs: Date.now() - startedAt,
        modelUsed: model,
        executionMode: orchDecision.mode,
      });
    } catch {
      /* fall-through: chat responde mesmo se o rodapé de telemetria falhar */
    }
    // Linha canônica de execução real no router_history (a que getUsageSummary conta).
    // Só em sucesso — falha/timeout deixa apenas as linhas de sonda de route().
    if (succeeded) {
      await recordRouterSelection(pool, {
        soul,
        target: decision.target,
        reason: decision.reason ?? `chat ${tier} (modo ${orchDecision.mode})`,
        status: "executed",
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        totalTokens,
        modelUsed: model,
        executionMode: orchDecision.mode,
        tokenSource: finalUsage.source,
        latencyMs: Date.now() - startedAt,
      });
    }
    emitStep("persistencia", `custo e execução registrados (${totalTokens} tokens, ${finalUsage.source})`);

    // Métricas Prometheus (E6)
    chatRequests.inc({ soul: soul.id, tier, mode: orchDecision.mode, status: succeeded ? "ok" : "failed" });
    chatLatency.observe({ tier }, (Date.now() - startedAt) / 1000);
    if (succeeded) {
      tokensTotal.inc({ soul: soul.id, tier, kind: "prompt", source: finalUsage.source, route: "chat" }, finalUsage.promptTokens);
      tokensTotal.inc({ soul: soul.id, tier, kind: "completion", source: finalUsage.source, route: "chat" }, finalUsage.completionTokens);
    }
    // evento WS de conclusão (fire-and-forget; não bloqueia a resposta)
    try {
      hub.broadcast(
        { type: "chat.done", soul: soul.id, code: result.code, timedOut: result.timedOut, tier: tier },
        { accountId: soul.config.ownerAccountId ?? null },
      );
    } catch {
      /* ws opcional */
    }

    // Write-back opt-in: memorizar=true persiste um resumo da interação na sessão do dia.
    // Nunca grava sobre falhas/timeout (result.code !== 0 || timedOut).
    let memorizado = false;
    if (memorizar && result.code === 0 && !result.timedOut) {
      try {
        anotar(soul.dir, `Interação: ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`);
        memorizado = true;
        emitStep("memoria", "interação memorizada na sessão do dia");
      } catch {
        /* fall-through: chat responde mesmo se o write-back falhar */
      }
    }

    // ---- Sanitização de secrets na resposta do LLM ----
    const responseSanitized = sanitizeLLMResponse(result.stdout, { taskId: String(session.id), soulId: soul.id });
    if (responseSanitized.count > 0) {
      logger.warn(`[content-filter] ${responseSanitized.count} secret(s) detectado(s) na resposta da soul ${soul.id}`);
    }
    const sanitizedStdout = responseSanitized.sanitized;

    // ---- E12b: amostragem online de fidelidade (heurística, sem LLM, sem PII) ----
    // Com prob = AOS_RAG_FAITHFULNESS_SAMPLE (default 0 = off), pontua o quanto
    // da resposta o contexto de RAG sustenta e grava só a métrica.
    const sampleRate = Number(process.env.AOS_RAG_FAITHFULNESS_SAMPLE) || 0;
    const ragV = built.verdict as { ok?: boolean; sources?: Array<{ snippet?: string }> } | null;
    if (
      sampleRate > 0 &&
      Math.random() < sampleRate &&
      result.code === 0 &&
      !result.timedOut &&
      ragV?.ok &&
      (ragV.sources?.length ?? 0) > 0
    ) {
      const snippets = (ragV.sources ?? []).map((s) => s.snippet ?? "");
      const f = scoreAnswerFaithfulness(sanitizedStdout, snippets);
      void recordRagEvalRun(pool, {
        soul: soul.id,
        kind: "online",
        n: snippets.length,
        faithfulnessSupported: f.supported,
        note: `trace=${traceId}; tier=${tier}`,
      }).catch(() => {
        /* amostragem é best-effort */
      });
    }

    // ---- Grava o turno na sessão (memória multi-turno) — nunca sobre falha/timeout ----
    if (result.code === 0 && !result.timedOut) {
      try {
        await recordSessionMessage(pool, session.id, soul.id, "user", promptSanitized.sanitized);
        await recordSessionMessage(pool, session.id, soul.id, "assistant", sanitizedStdout);
      } catch (err) {
        logger.warn(`[sessions] falha ao gravar turno na sessão (non-fatal): ${(err as Error).message}`);
      }
    }

    sendJson(res, 200, {
      ok: result.code === 0 && !result.timedOut,
      soul: soul.id,
      model,
      tier: tier,
      mode: orchDecision.mode,
      code: result.code,
      timedOut: result.timedOut,
      stdout: sanitizedStdout.slice(-2000),
      stderr: result.stderr.slice(-1000),
      routerReason: decision.reason,
      ragVerdict: built.verdict,
      memorizado,
      limit: { dailyLimit: dailyLimit ?? null, spentToday, maxTurns, prompts: promptsUsed },
      contentFilter: responseSanitized.count > 0 ? { detected: responseSanitized.count } : undefined,
      toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
    });
    return true;
  } finally {
    purgeCredentials(String(session.id));
  }
}
