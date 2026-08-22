import { createHash } from "node:crypto";
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
  recordExecution,
  logger,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  resolveTarget,
  recordRouterSelection,
} from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { runLangGraphAgentStream } from "../langgraph-runner.js";
import { routeFromPrompt, type ExecutionMode } from "../orchestrator/router.js";
import { sendJson, readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";

/**
 * Chama o /api/chat do Ollama via node:http. O fetch() do Node (undici) aborta
 * com "fetch failed" após 300s aguardando os headers da resposta — tempo que um
 * modelo local em CPU pode exceder só no prompt eval. Aqui o único limite é o
 * timeoutMs do chamador (o timeoutSeconds da requisição de chat).
 */
function ollamaChat(
  baseUrl: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
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
            const parsed = JSON.parse(data) as { message?: { content?: string } };
            resolvePromise({ code: 0, stdout: parsed.message?.content || "(sem resposta)", stderr: "", timedOut: false });
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
    // Passos do pipeline de chat, transmitidos ao vivo pro painel "Log de
    // execução" da UI (consumido em app.js via WS, evento "chat.step").
    const emitStep = (module: string, message: string, level?: "err") => {
      try {
        hub.broadcast({ type: "chat.step", soul: soul.id, ts: Date.now(), module, message, level });
      } catch {
        /* ws opcional */
      }
    };

    const config = await loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    {
      // ---- Limites: teto diário de custo e turnos por sessão ----
      const dailyLimit = soul.config.dailyLimit;
      const maxTurns = soul.config.agent?.guardrails?.maxTurns ?? soul.config.maxTurns ?? config.defaultMaxTurns;
      const spentToday = await sumCostBySoul(pool, soul.id, todayISODate());
      if (dailyLimit !== undefined && spentToday >= dailyLimit) {
        sendJson(res, 429, { error: "teto diário de gastos atingido", limit: dailyLimit, spent: spentToday });
        return true;
      }
      const session = await openSession(pool, soul.id, maxTurns, dailyLimit);
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

      // ---- Buffer da soul: contexto persistente + RAG com gate de relevância ----
      const built = await buildPrompt({ home, soul, prompt: promptSanitized.sanitized, config });
      {
        const verdict = built.verdict as { ok: boolean; sources?: unknown[]; motivo?: string } | null;
        const filesLoaded = built.files.filter((f) => f.chars > 0).length;
        const ragMsg =
          verdict == null
            ? "RAG não avaliado"
            : verdict.ok
              ? `RAG: contexto relevante encontrado (${verdict.sources?.length ?? 0} fonte(s))`
              : `RAG: ${verdict.motivo ?? "sem contexto relevante"}`;
        emitStep("rag", `${ragMsg}; ${filesLoaded} arquivo(s) de contexto persistente carregado(s)`);
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
        await recordRouterSelection(pool, soul, forcedTarget, "tier explícito do usuário: langgraph");
        decision = { target: forcedTarget };
      }
      const model = requestedModel ?? orchDecision.model;
      const tier = requestedTier ?? decision.target.tier;
      emitStep(
        "router",
        `tier selecionado: ${tier} → ${decision.target.provider}/${model} (${decision.reason ?? `modo ${orchDecision.mode}`})`,
      );
      const startedAt = Date.now();
      let result: { code: number; stdout: string; stderr: string; timedOut: boolean; toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: string }> };
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
        result = await ollamaChat(
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
      } else if (decision.target.provider === "langgraph") {
        emitStep("langgraph", `iniciando execução LangGraph (modo ${langgraphMode ?? "tools"})`);
        result = await runLangGraphAgentStream(pool, {
          soul: soul.id,
          prompt: promptSanitized.sanitized,
          timeoutSeconds,
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
      } else {
        emitStep("opencode", `executando via opencode (${model})`);
        const env = { ...(process.env as Record<string, string>) };
        result = await run!(built.fullPrompt, {
          cwd: soul.dir,
          model,
          timeoutSeconds,
          agent: soul.config.agent ? soul.id : undefined,
          soulId: soul.id,
          env,
        });
      }
      emitStep(
        decision.target.provider,
        result.code === 0 && !result.timedOut
          ? `execução concluída em ${Date.now() - startedAt}ms`
          : result.timedOut
            ? `timeout após ${Date.now() - startedAt}ms`
            : `erro na execução (código ${result.code})`,
        result.code === 0 && !result.timedOut ? undefined : "err",
      );
      await recordCostCall(pool, {
        soul: soul.id,
        provider: decision.target.provider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `tier=${tier}; latency_ms=${Date.now() - startedAt}`,
      });
      await recordExecution(pool, {
        sessionId: session.id,
        soul: soul.id,
        kind: "chat",
        promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
        model,
        tier: tier,
        filesLoaded: built.files.filter((f) => f.chars > 0).length,
        contextChars: built.contextChars,
        verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
        status: result.code === 0 && !result.timedOut ? "ok" : "failed",
        note: `latency_ms=${Date.now() - startedAt}`,
      });
      emitStep("persistencia", "custo e execução registrados");
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
