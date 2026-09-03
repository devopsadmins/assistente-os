import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadConfig,
  getPool,
  getSoul,
  getThread,
  touchThread,
  sanitizeLLMResponse,
  recordCostCall,
  recordExecution,
  recordRouterSelection,
  recordSessionMessage,
  estimateTokens,
  nextZenApiKey,
  resolveTarget,
  logger,
} from "@assistente-os/core";
import { readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { preparePromptContext, ollamaChatStream, type ExecUsage } from "./chat.js";
import { routeFromPrompt } from "../orchestrator/router.js";
import { runLangGraphAgentStream } from "../langgraph-runner.js";
import { startSSE, writeSSEEvent, startHeartbeat, type StreamEvent } from "./sse.js";

const HEARTBEAT_MS = 15_000;

export async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub } = context;

  const match = path.match(/^\/souls\/([^/]+)\/threads\/(\d+)\/messages\/stream$/);
  if (!match || req.method !== "POST") return false;

  const soul = getSoul(home, decodeURIComponent(match[1]!));
  if (!soul) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "soul não encontrada" }));
    return true;
  }

  const threadId = Number(match[2]);
  if (!Number.isSafeInteger(threadId) || threadId < 1) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "thread não encontrada" }));
    return true;
  }

  const config = await loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const requestAccountId = getRequestAccountId(req);

  const thread = await getThread(pool, threadId, requestAccountId, soul.id);
  if (!thread) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "thread não encontrada" }));
    return true;
  }

  const parsed = await readJson(req);
  if (parsed.error === "too_large") {
    res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "body excede 1 MB" }));
    return true;
  }
  if (parsed.error === "invalid") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "JSON inválido" }));
    return true;
  }
  const prompt = parsed.body && typeof parsed.body.prompt === "string" ? parsed.body.prompt : "";
  if (!prompt.trim()) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "prompt é obrigatório" }));
    return true;
  }

  // Sessão POR THREAD (não por cliente) — cada thread tem seu próprio
  // client_key sintético, então openSession/getRecentSessionMessages (já
  // usados por preparePromptContext) isolam turno/histórico por thread de
  // graça, sem mudar nada no schema ou nessas funções.
  const threadClientKey = `thread-${threadId}`;
  const reqWithThreadClientKey = Object.create(req, {
    headers: { value: { ...req.headers, "x-client-id": threadClientKey } },
  }) as IncomingMessage;

  // preparePromptContext (validação de teto/turnos, sanitização, RAG) roda
  // ANTES de sabermos se o pedido será aceito — chamar writeSSEEvent(res,...)
  // direto no sink, aqui dentro, chamaria res.write() antes de startSSE()
  // definir os headers explicitamente. Node manda um cabeçalho implícito
  // (200, sem content-type text/event-stream) no primeiro write(), e o
  // startSSE() de depois quebraria com ERR_HTTP_HEADERS_SENT — tanto no
  // sucesso (sempre, já que preparePromptContext sempre emite step) quanto
  // no erro (nunca deveríamos ter escrito nada num 400/404 JSON). Por isso os
  // eventos de "step" só são enfileirados aqui; só viram bytes reais depois
  // que sabemos prepared.ok === true e startSSE() já rodou.
  const pendingSteps: StreamEvent[] = [];

  const prepared = await preparePromptContext({
    req: reqWithThreadClientKey,
    pool,
    hub,
    home,
    config,
    soul,
    prompt,
    createStepSink: () => (module, message, level) => {
      pendingSteps.push({ type: "step", step: module, message, ...(level ? {} : {}) });
    },
  });

  if (!prepared.ok) {
    res.writeHead(prepared.status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(prepared.body));
    return true;
  }

  // A partir daqui a resposta já é SSE — nenhum erro subsequente pode virar
  // um status HTTP diferente; erros vão como StreamEvent{type:"error"}.
  startSSE(res);
  for (const step of pendingSteps) writeSSEEvent(res, step);
  const stopHeartbeat = startHeartbeat(res, HEARTBEAT_MS);

  const { session, built, promptSanitized } = prepared.context;

  try {
    const orchDecision = await routeFromPrompt(pool, config, soul, promptSanitized.sanitized, makeLocalFallbackProbe(config.ollamaUrl), undefined);
    const decision = orchDecision.route;
    const model = orchDecision.model;
    const tier = decision.target.tier;

    const startedAt = Date.now();
    let stdout = "";
    let code = 0;
    let timedOut = false;
    let execUsage: ExecUsage | undefined;

    if (decision.target.provider === "ollama") {
      let baseUrl = config.ollamaUrl;
      if (baseUrl.includes("host.docker.internal")) {
        baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
      }
      const ollamaModel = (decision.target.model ?? model).replace(/^(ollama|openai)\//, "");
      const result = await ollamaChatStream(
        baseUrl,
        {
          model: ollamaModel,
          messages: [
            { role: "system", content: built.fullPrompt.replace(promptSanitized.sanitized, "").trim() },
            { role: "user", content: promptSanitized.sanitized },
          ],
        },
        300_000,
        (token) => writeSSEEvent(res, { type: "token", text: token }),
      );
      stdout = result.stdout;
      code = result.code;
      timedOut = result.timedOut;
      execUsage = result.usage;
    } else {
      // Fallback funcional (não-progressivo) pros outros tiers — streaming
      // de verdade pra zen/soul/langgraph fica pra uma próxima fatia.
      let result: { code: number; stdout: string; stderr: string; timedOut: boolean };
      if (decision.target.provider === "langgraph") {
        result = await runLangGraphAgentStream(pool, {
          soul: soul.id,
          prompt: promptSanitized.sanitized,
          timeoutSeconds: 300,
          threadId: `stream-thread-${threadId}`,
          seedMessages: prepared.context.history,
          useTools: true,
        });
      } else {
        const env = { ...(process.env as Record<string, string>) };
        const rotatedZenKey = nextZenApiKey(config);
        if (rotatedZenKey) env.ZEN_API_KEY = rotatedZenKey;
        result = await run!(built.fullPrompt, {
          cwd: soul.dir,
          model,
          timeoutSeconds: 300,
          agent: soul.config.agent ? soul.id : undefined,
          soulId: soul.id,
          env,
        });
      }
      stdout = result.stdout;
      code = result.code;
      timedOut = result.timedOut;
      if (stdout) writeSSEEvent(res, { type: "token", text: stdout });
    }

    const succeeded = code === 0 && !timedOut;
    const finalUsage: ExecUsage = execUsage ?? {
      promptTokens: estimateTokens(built.fullPrompt),
      completionTokens: estimateTokens(stdout),
      source: "estimate",
    };

    await recordCostCall(pool, {
      soul: soul.id,
      provider: decision.target.provider,
      model,
      inputTokens: succeeded ? finalUsage.promptTokens : 0,
      outputTokens: succeeded ? finalUsage.completionTokens : 0,
      cost: 0,
      status: succeeded ? "ok" : "failed",
      note: `tier=${tier}; latency_ms=${Date.now() - startedAt}; tokens=${finalUsage.source}; via=/stream`,
    });
    await recordExecution(pool, {
      sessionId: session.id,
      soul: soul.id,
      kind: "chat",
      model,
      tier,
      filesLoaded: built.files.filter((f) => f.chars > 0).length,
      tokensIn: succeeded ? finalUsage.promptTokens : 0,
      tokensOut: succeeded ? finalUsage.completionTokens : 0,
      contextChars: built.contextChars,
      verdict: built.verdict == null ? undefined : JSON.stringify(built.verdict),
      status: succeeded ? "ok" : "failed",
      note: `latency_ms=${Date.now() - startedAt}; via=/stream`,
      traceId: prepared.context.traceId,
    });
    if (succeeded) {
      await recordRouterSelection(pool, {
        soul,
        target: decision.target,
        reason: decision.reason ?? `stream ${tier} (modo ${orchDecision.mode})`,
        status: "executed",
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        totalTokens: finalUsage.promptTokens + finalUsage.completionTokens,
        modelUsed: model,
        executionMode: orchDecision.mode,
        tokenSource: finalUsage.source,
        latencyMs: Date.now() - startedAt,
      });
    }

    const responseSanitized = sanitizeLLMResponse(stdout, { taskId: String(session.id), soulId: soul.id });
    if (responseSanitized.count > 0) {
      logger.warn(`[content-filter] ${responseSanitized.count} secret(s) detectado(s) na resposta da soul ${soul.id} (via /stream)`);
    }
    const sanitizedStdout = responseSanitized.sanitized;

    let messageId = 0;
    if (succeeded) {
      await recordSessionMessage(pool, session.id, soul.id, "user", promptSanitized.sanitized, threadId);
      messageId = await recordSessionMessage(pool, session.id, soul.id, "assistant", sanitizedStdout, threadId);
      await touchThread(pool, threadId);
    }

    const sources =
      built.verdict && typeof built.verdict === "object" && "sources" in built.verdict
        ? ((built.verdict as { sources?: Array<{ doc: string; path: string; snippet: string }> }).sources ?? []).map((s) => ({
            title: s.doc,
            url: s.path,
            snippet: s.snippet,
          }))
        : undefined;

    if (succeeded) {
      writeSSEEvent(res, { type: "done", messageId, usage: finalUsage, sources });
    } else {
      writeSSEEvent(res, { type: "error", message: timedOut ? "tempo esgotado" : `execução falhou (código ${code})` });
    }
  } catch (err) {
    writeSSEEvent(res, { type: "error", message: err instanceof Error ? err.message : "erro desconhecido" });
  } finally {
    stopHeartbeat();
    res.end();
  }

  return true;
}
