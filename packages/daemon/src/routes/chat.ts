import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import {
  loadConfig,
  getPool,
  recordCostCall,
  anotar,
  getSoul,
  todayISODate,
  sumCostBySoul,
  openSession,
  bumpSessionPrompt,
  recordSessionMessage,
  getRecentSessionMessages,
  sessionHistoryTurns,
  sessionHistoryMaxChars,
  recordExecution,
  recordExecutionSpan,
  logger,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  resolveTarget,
  recordRouterSelection,
  logFullAuditEntry,
  estimateTokens,
  nextZenApiKey,
} from "@assistente-os/core";
import type { RagChunk, RagInjectionFinding } from "@assistente-os/memory";
import { maxFindingSeverity, scoreAnswerFaithfulness } from "@assistente-os/memory";
import { recordRagEvalRun } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { runLangGraphAgentStream } from "../langgraph-runner.js";
import { routeFromPrompt, type ExecutionMode } from "../orchestrator/router.js";
import {
  escalationConfig,
  shouldEscalate,
  shouldRunJudge,
  judgeAnswer,
  nextEscalationTier,
  looksLikeRefusal,
  canEscalateSession,
  recordSessionEscalation,
} from "../orchestrator/escalation.js";
import { sendJson, readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { chatRequests, chatLatency, tokensTotal, promptInjectionAlerts, ragRerankSeconds, ragCacheEvents, routerEscalation, ollamaPrefillSeconds, ollamaPromptEvalTokens } from "../observability/metrics.js";

/**
 * Chama o /api/chat do Ollama via node:http. O fetch() do Node (undici) aborta
 * com "fetch failed" após 300s aguardando os headers da resposta — tempo que um
 * modelo local em CPU pode exceder só no prompt eval. Aqui o único limite é o
 * timeoutMs do chamador (o timeoutSeconds da requisição de chat).
 */
interface ExecUsage {
  promptTokens: number;
  completionTokens: number;
  source: "provider" | "estimate";
}

interface OllamaPrefill {
  /** Tokens do prompt processados (baixo = KV cache reaproveitou o prefixo). */
  promptEvalCount: number;
  /** Tempo de prefill em ms (`prompt_eval_duration` do Ollama, ns → ms). */
  promptEvalMs: number;
}

function ollamaChat(
  baseUrl: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  usage?: ExecUsage;
  prefill?: OllamaPrefill;
}> {
  return new Promise((resolvePromise) => {
    let url: URL;
    try {
      url = new URL("/api/chat", baseUrl);
    } catch {
      resolvePromise({ code: 1, stdout: "", stderr: `OLLAMA_URL inválida: ${baseUrl}`, timedOut: false });
      return;
    }
    const body = JSON.stringify(payload);
    let timedOut = false;
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            resolvePromise({ code: 1, stdout: "", stderr: `Ollama HTTP ${res.statusCode}: ${data.slice(0, 300)}`, timedOut: false });
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              message?: { content?: string };
              prompt_eval_count?: number;
              eval_count?: number;
              prompt_eval_duration?: number;
            };
            const usage: ExecUsage | undefined =
              typeof parsed.prompt_eval_count === "number" || typeof parsed.eval_count === "number"
                ? {
                    promptTokens: parsed.prompt_eval_count ?? 0,
                    completionTokens: parsed.eval_count ?? 0,
                    source: "provider",
                  }
                : undefined;
            const prefill: OllamaPrefill | undefined =
              typeof parsed.prompt_eval_duration === "number"
                ? {
                    promptEvalCount: parsed.prompt_eval_count ?? 0,
                    promptEvalMs: parsed.prompt_eval_duration / 1e6,
                  }
                : undefined;
            resolvePromise({
              code: 0,
              stdout: parsed.message?.content || "(sem resposta)",
              stderr: "",
              timedOut: false,
              usage,
              prefill,
            });
          } catch {
            resolvePromise({ code: 1, stdout: "", stderr: `resposta inválida do Ollama: ${data.slice(0, 200)}`, timedOut: false });
          }
        });
      },
    );
    // Resposta não-streaming: nenhum byte chega antes da resposta completa,
    // então o timeout de inatividade do socket equivale ao timeout total.
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy(new Error(`Ollama não respondeu em ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on("error", (err) => resolvePromise({ code: 1, stdout: "", stderr: err.message, timedOut }));
    req.end(body);
  });
}

/** Rotas de execução de prompt: GET /souls/:id/buffer, POST /souls/:id/chat, GET /souls/:id/langgraph/status|history */
export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub } = context;

  const bufferMatch = path.match(/^\/souls\/([^/]+)\/buffer$/);
  if (bufferMatch && req.method === "GET") {
    const soul = getSoul(home, decodeURIComponent(bufferMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const prompt = url.searchParams.get("prompt") ?? "";
    const built = await buildPrompt({ home, soul, prompt, config, withRag: prompt.trim().length > 0 });
    sendJson(res, 200, {
      soul: soul.id,
      builtAt: new Date().toISOString(),
      files: built.files,
      contextChars: built.contextChars,
      tokenEstimate: Math.ceil(built.contextChars / 4),
      ragVerdict: built.verdict,
      systemPrompt: built.fullPrompt,
    });
    return true;
  }

  const chatMatch = path.match(/^\/souls\/([^/]+)\/chat$/);
  if (chatMatch && req.method === "POST") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") {
      sendJson(res, 413, { error: "body excede 1 MB" });
      return true;
    }
    if (parsed.error === "invalid") {
      sendJson(res, 400, { error: "JSON inválido" });
      return true;
    }
    const body = parsed.body;
    const prompt = body && typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      sendJson(res, 400, { error: "prompt é obrigatório" });
      return true;
    }
    const timeoutSeconds = body && typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : 300;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) {
      sendJson(res, 400, { error: "timeoutSeconds deve ser um inteiro entre 1 e 600" });
      return true;
    }
    const requestedModel = body && typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const requestedTier = body && typeof body.tier === "string" && body.tier.trim() ? body.tier.trim() : undefined;
    const explicitMode: ExecutionMode | undefined = body?.mode === "fast" || body?.mode === "pro" ? body.mode : undefined;
    const langgraphMode: string | undefined = typeof body?.langgraphMode === "string" ? body.langgraphMode : undefined;
    const memorizar = body && body.memorizar === true;
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

    // Trace unificado (Onda 2): um id por turno. Correlaciona os spans por
    // estágio (`execution_spans`) à linha canônica de `execution_logs` e ao
    // header `x-trace-id` da resposta. `os trace <id>` / `GET /trace/:id`.
    const traceId = randomUUID();
    const traceStartedAt = Date.now();
    let traceSeq = 0;
    let traceSessionId: number | null = null;
    try {
      res.setHeader("x-trace-id", traceId);
    } catch {
      /* headers já enviados — ignora */
    }

    // Passos do pipeline de chat: ao vivo no WS `chat.step` E persistidos como
    // spans (diagnóstico — não entram em custo/uso; falha de escrita é ignorada).
    const emitStep = (module: string, message: string, level?: "err") => {
      try {
        hub.broadcast({ type: "chat.step", soul: soul.id, ts: Date.now(), module, message, level, traceId });
      } catch {
        /* ws opcional */
      }
      void recordExecutionSpan(pool, {
        traceId,
        soul: soul.id,
        sessionId: traceSessionId,
        seq: traceSeq++,
        module,
        message,
        level: level ?? "info",
        elapsedMs: Date.now() - traceStartedAt,
      }).catch(() => {
        /* span é diagnóstico opcional */
      });
    };
    {
      // ---- Limites: teto diário de custo e turnos por sessão ----
      const dailyLimit = soul.config.dailyLimit;
      const maxTurns = soul.config.agent?.guardrails?.maxTurns ?? soul.config.maxTurns ?? config.defaultMaxTurns;
      const spentToday = await sumCostBySoul(pool, soul.id, todayISODate());
      if (dailyLimit !== undefined && spentToday >= dailyLimit) {
        sendJson(res, 429, { error: "teto diário de gastos atingido", limit: dailyLimit, spent: spentToday });
        return true;
      }
      // Isolamento de sessão por cliente: header X-Client-Id se enviado, senão
      // hash do token (separa instalações), senão 'default' (single-user).
      const clientHeader = req.headers["x-client-id"];
      const authHeader = req.headers["authorization"];
      const clientKey =
        (typeof clientHeader === "string" && clientHeader.trim().slice(0, 64)) ||
        (typeof authHeader === "string" && authHeader
          ? "tok-" + createHash("sha256").update(authHeader).digest("hex").slice(0, 12)
          : "default");
      const session = await openSession(pool, soul.id, maxTurns, dailyLimit, clientKey);
      traceSessionId = session.id;
      if (session.promptCount >= session.maxTurns) {
        sendJson(res, 429, { error: "limite de turnos da sessão atingido", maxTurns: session.maxTurns, prompts: session.promptCount });
        return true;
      }
      const promptsUsed = await bumpSessionPrompt(pool, session.id);
      emitStep("chat", `Prompt recebido (turno ${promptsUsed}/${session.maxTurns})`);

      // ---- Sanitização de secrets no prompt do usuário ----
      const promptSanitized = sanitizeUserPrompt(prompt, { taskId: String(session.id), soulId: soul.id });
      if (promptSanitized.count > 0) {
        logger.warn(`[content-filter] ${promptSanitized.count} secret(s) detectado(s) no prompt da soul ${soul.id}`);
      }
      emitStep(
        "seguranca",
        promptSanitized.count > 0 ? `${promptSanitized.count} segredo(s) redigido(s) no prompt` : "nenhum segredo detectado no prompt",
      );

      // ---- Detecção de prompt injection (defesa em profundidade — regex, não bloqueia sozinha) ----
      const injection = promptSanitized.injection;
      if (injection?.detected) {
        logger.warn(
          `[prompt-injection] ${injection.matches.length} padrão(ões) detectado(s) (severidade máx: ${injection.maxSeverity}) no prompt da soul ${soul.id}`,
        );
        logFullAuditEntry({
          ts: new Date().toISOString(),
          sessionId: String(session.id),
          soulId: soul.id,
          intention: `ALERTA: possível prompt injection (severidade ${injection.maxSeverity})`,
          toolsCalled: [],
          params: { patterns: injection.matches.map((m) => m.name) },
        });
        promptInjectionAlerts.inc({ severity: injection.maxSeverity, source: "user_input" });
        const modo = process.env.PROMPT_INJECTION_MODO || "aviso";
        if (modo === "recusar" && injection.maxSeverity === "high") {
          sendJson(res, 400, {
            error: "prompt recusado: padrão de possível prompt injection detectado",
            patterns: injection.matches.map((m) => m.name),
          });
          return true;
        }
      }
      emitStep(
        "seguranca",
        injection?.detected ? `possível prompt injection detectada (${injection.maxSeverity})` : "nenhum padrão de prompt injection detectado",
      );

      // ---- Histórico da conversa (mesma sessão) — memória multi-turno ----
      const history = await getRecentSessionMessages(pool, session.id, {
        maxTurns: sessionHistoryTurns(),
        maxChars: sessionHistoryMaxChars(),
      });

      // ---- Buffer da soul: contexto persistente + RAG com gate de relevância ----
      const built = await buildPrompt({ home, soul, prompt: promptSanitized.sanitized, config, history });

      // ---- Skills por soul: registra quais foram ativadas neste turno ----
      if (built.skills && built.skills.active.length > 0) {
        logFullAuditEntry({
          ts: new Date().toISOString(),
          sessionId: String(session.id),
          soulId: soul.id,
          intention: "skills: ativadas",
          toolsCalled: [],
          params: { active: built.skills.active, available: built.skills.available },
        });
        emitStep("skills", `skill(s) ativada(s): ${built.skills.active.map((s) => s.name).join(", ")}`);
      }
      {
        const verdict = built.verdict as
          | {
              ok: boolean;
              sources?: RagChunk[];
              motivo?: string;
              injection?: RagInjectionFinding[];
              rerank?: { mode: "off" | "cross-encoder" | "llm"; ms?: number };
              cacheHit?: "miss" | "exact" | "semantic";
            }
          | null;
        if (verdict?.cacheHit) {
          try {
            ragCacheEvents.inc({ result: verdict.cacheHit });
          } catch {
            /* métrica opcional */
          }
        }
        const filesLoaded = built.files.filter((f) => f.chars > 0).length;
        const ragMsg =
          verdict == null
            ? "RAG não avaliado"
            : verdict.ok
              ? `RAG: contexto relevante encontrado (${verdict.sources?.length ?? 0} fonte(s))`
              : `RAG: ${verdict.motivo ?? "sem contexto relevante"}`;
        emitStep("rag", `${ragMsg}; ${filesLoaded} arquivo(s) de contexto persistente carregado(s)`);

        // ---- Debug controlado de RAG: method (semantic/literal/hybrid) e score
        // por fonte já existiam no retorno de retrieveContext mas nunca eram
        // persistidos — uma degradação silenciosa pra busca literal (ex.:
        // embedder de indexação incompatível com o de consulta) passava
        // despercebida. Grava no audit trail já existente, sem infra nova.
        if (verdict?.sources && verdict.sources.length > 0) {
          logFullAuditEntry({
            ts: new Date().toISOString(),
            sessionId: String(session.id),
            soulId: soul.id,
            intention: "RAG: retrieval debug",
            toolsCalled: [],
            params: {
              rerankMode: verdict.rerank?.mode ?? "off",
              ...(verdict.rerank?.ms !== undefined ? { rerankMs: verdict.rerank.ms } : {}),
              sources: verdict.sources.map((s) => ({
                doc: s.doc,
                path: s.path,
                method: s.reranked ? "reranked" : s.method,
                score: s.score,
                ...(s.reranked ? { baseMethod: s.method } : {}),
              })),
            },
          });
        }
        if (verdict?.rerank?.ms !== undefined) {
          try {
            ragRerankSeconds.observe({ mode: verdict.rerank.mode }, verdict.rerank.ms / 1000);
          } catch {
            /* métrica opcional */
          }
        }

        // ---- Indirect prompt injection em conteúdo recuperado (RAG) ----
        // O screening rodou dentro de retrieveContext; aqui registramos a origem
        // (`retrieved_chunk`, distinta de `user_input`) no audit trail + métrica.
        const ragInjection = verdict?.injection ?? [];
        if (ragInjection.length > 0) {
          const maxSev = maxFindingSeverity(ragInjection);
          const excluded = ragInjection.filter((f) => f.excluded).length;
          logger.warn(
            `[prompt-injection] ${ragInjection.length} chunk(s) de RAG com padrão de injection (sev. máx ${maxSev}) na soul ${soul.id}`,
          );
          logFullAuditEntry({
            ts: new Date().toISOString(),
            sessionId: String(session.id),
            soulId: soul.id,
            intention: "ALERTA: possível prompt injection em conteúdo recuperado (RAG)",
            toolsCalled: [],
            params: {
              source: "retrieved_chunk",
              findings: ragInjection.map((f) => ({
                doc: f.doc,
                path: f.path,
                severity: f.severity,
                patterns: f.patterns,
                excluded: f.excluded,
              })),
            },
          });
          promptInjectionAlerts.inc({ severity: maxSev, source: "retrieved_chunk" });
          emitStep(
            "seguranca",
            `RAG: ${ragInjection.length} chunk(s) sinalizado(s) por prompt injection` +
              (excluded > 0 ? `, ${excluded} descartado(s)` : ""),
          );
        }
      }

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
          onStep: (step: { node: string; iterationCount: number; messageCount: number; lastContent?: string; toolCalls?: any[] }) => {
            try {
              hub.broadcast({
                type: "graph.step",
                soul: soul.id,
                node: step.node,
                iterationCount: step.iterationCount,
                messageCount: step.messageCount,
                lastContent: step.lastContent,
                toolCalls: step.toolCalls,
              });
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
        hub.broadcast({ type: "chat.done", soul: soul.id, code: result.code, timedOut: result.timedOut, tier: tier });
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
    }
    return true;
  }

  // ----- Endpoints LangGraph ──────────────────────────────────────────
  // /souls/:soul/langgraph/status - status do grafo
  // /souls/:soul/langgraph/history - histórico de execução
  const lgSoulMatch = path.match(/^\/souls\/([^/]+)\/langgraph\//);
  if (lgSoulMatch && (req.url?.includes("/langgraph/status") || req.url?.includes("/langgraph/history"))) {
    const soulId = decodeURIComponent(lgSoulMatch[1]!);
    const lgHome = context.home;
    const { loadConfig: loadConfigDyn } = await import("@assistente-os/core");
    const cfg = loadConfigDyn({ home: lgHome });
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const { probeLangGraph } = await import("../langgraph-runner.js");
    const ollamaUrl = cfg.ollamaUrl || "http://127.0.0.1:11434/v1";
    const probe = await probeLangGraph(ollamaUrl);

    if (req.url?.includes("/langgraph/status")) {
      const soul = getSoulDyn(lgHome, soulId);
      if (!soul) {
        sendJson(res, 404, { error: "Soul não encontrada" });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        soul: soul.id,
        ollamaAvailable: probe.ok,
        mode: soul.config.models?.chat || "auto",
        maxIterations: soul.config.agent?.guardrails?.maxIterations ?? 5,
      });
      return true;
    }

    if (req.url?.includes("/langgraph/history")) {
      // TODO: histórico real seria armazenado em checkpoint do LangGraph
      // Por enquanto retorna dados mockados indicando suporte
      sendJson(res, 200, {
        ok: true,
        soul: soulId,
        steps: [],
        message: "Histórico em breve - requires LangGraph checkpointer persistence",
      });
      return true;
    }
  }

  return false;
}
