import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadConfig,
  getPool,
  getSoul,
  getThread,
  getThreadMessages,
  touchThread,
  sanitizeLLMResponse,
  recordCostCall,
  recordExecution,
  recordRouterSelection,
  recordSessionMessage,
  estimateTokens,
  nextZenApiKey,
  sessionHistoryTurns,
  sessionHistoryMaxChars,
  logger,
} from "@assistente-os/core";
import { readJson, makeLocalFallbackProbe, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { preparePromptContext, ollamaChatStream, type ExecUsage } from "./chat.js";
import { routeFromPrompt } from "../orchestrator/router.js";
import { runLangGraphAgentStream } from "../langgraph-runner.js";
import { startSSE, writeSSEEvent, startHeartbeat, type StreamEvent } from "./sse.js";

const HEARTBEAT_MS = 15_000;

/**
 * Rede de segurança acima do timeout do próprio provider (300s em cada
 * chamada abaixo). F1: `ollamaChatStream` já ganhou handlers de
 * `res.on("aborted"/"error")` pra resolver quando o Ollama derruba o socket
 * no meio do stream, mas isso conserta só ESSE provider — um bug equivalente
 * numa integração futura (langgraph, opencode run, um provider novo) travaria
 * a resposta SSE pra sempre do mesmo jeito: sem "done", sem "error", sem
 * `stopHeartbeat()`. `Promise.race` contra este watchdog garante que a rota
 * sempre estabiliza, mesmo que a chamada do provider nunca resolva sozinha.
 */
const WATCHDOG_MS = 310_000;

interface Watchdog {
  promise: Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; usage?: ExecUsage }>;
  /** N4: limpa o timer quando o provider vence a corrida (o caso normal) — sem isso o timer de 310s fica armado (unref'd, inofensivo, mas sujo) até estourar sozinho. */
  cancel: () => void;
}

function watchdogTimeout(ms: number): Watchdog {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; usage?: ExecUsage }>((resolve) => {
    timer = setTimeout(
      () => resolve({ code: 1, stdout: "", stderr: "watchdog: provider não respondeu dentro do limite de segurança", timedOut: true }),
      ms,
    );
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Mesmo orçamento (turnos/chars) que `preparePromptContext` aplicaria via
 * `getRecentSessionMessages` — reproduzido aqui pra aparar o histórico da
 * THREAD (N3 da revisão final) da mesma forma que o histórico por SESSÃO já
 * era aparado, sem alterar `@assistente-os/core`.
 */
function trimHistoryToBudget(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTurns: number,
  maxChars: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (maxTurns <= 0) return [];
  let msgs = messages.slice(-maxTurns * 2);
  if (!maxChars || maxChars <= 0) return msgs;
  let total = msgs.reduce((sum, m) => sum + m.content.length, 0);
  while (msgs.length > 1 && total > maxChars) {
    total -= msgs[0]!.content.length;
    msgs = msgs.slice(1);
  }
  return msgs;
}

export async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run } = context;

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

  // N3 da revisão final: histórico por THREAD, não por sessão. A sessão por
  // trás do clientKey sintético (`thread-${threadId}`) gira — fecha e reabre —
  // depois de `ASSISTENTE_OS_SESSION_IDLE_MINUTES` (default 120min) ociosa
  // (ver openSession em core/sessions.ts); sem este override, `preparePromptContext`
  // usaria `getRecentSessionMessages(pool, session.id, …)`, que fica vazio
  // após a virada — o modelo "esquece" a conversa inteira enquanto
  // `GET /threads/:id/messages` continua mostrando a transcrição completa.
  // `getThreadMessages` não gira com a sessão, então a história do modelo
  // passa a acompanhar a mesma fonte que o usuário vê.
  const threadHistory = trimHistoryToBudget(
    (await getThreadMessages(pool, threadId)).map((m) => ({ role: m.role, content: m.content })),
    sessionHistoryTurns(),
    sessionHistoryMaxChars(),
  );

  const prepared = await preparePromptContext({
    req: reqWithThreadClientKey,
    pool,
    home,
    config,
    soul,
    prompt,
    historyOverride: threadHistory,
    createStepSink: () => (module, message) => {
      pendingSteps.push({ type: "step", step: module, message });
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

  // N4: um único watchdog por request — cancelado no `finally` de baixo assim
  // que a rota estabiliza (sucesso, falha, ou catch), pra não deixar o timer
  // de 310s armado até estourar sozinho no caso normal (provider responde).
  const watchdog = watchdogTimeout(WATCHDOG_MS);

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

      // N2 da revisão final: os tokens do provider iam direto pro cliente
      // ANTES de sanitizeLLMResponse rodar (essa função só sanitizava a cópia
      // gravada no banco) — um segredo ecoado pelo modelo saía em texto puro
      // na SSE, mesmo com a mensagem persistida corretamente redigida. Como
      // os tokens chegam picados, sanitizar cada um isoladamente deixaria
      // escapar um segredo partido entre dois tokens; por isso um buffer com
      // lookback (128 chars — maior que o maior match de DEFAULT_PATTERNS):
      // só emitimos, sanitizado, tudo MENOS a cauda dos últimos 128 chars, que
      // fica pendente pro próximo token (ou pro flush final).
      const SANITIZE_LOOKBACK = 128;
      let sanitizePending = "";
      const emitSanitizedToken = (chunk: string, flush = false): void => {
        sanitizePending += chunk;
        const cut = flush ? sanitizePending.length : Math.max(0, sanitizePending.length - SANITIZE_LOOKBACK);
        if (cut === 0) return;
        const head = sanitizeLLMResponse(sanitizePending.slice(0, cut), { taskId: String(session.id), soulId: soul.id }).sanitized;
        sanitizePending = sanitizePending.slice(cut);
        if (head) writeSSEEvent(res, { type: "token", text: head });
      };

      const result = await Promise.race([
        ollamaChatStream(
          baseUrl,
          {
            model: ollamaModel,
            messages: [
              { role: "system", content: built.fullPrompt.replace(promptSanitized.sanitized, "").trim() },
              { role: "user", content: promptSanitized.sanitized },
            ],
          },
          300_000,
          (token) => emitSanitizedToken(token),
        ),
        watchdog.promise,
      ]);
      emitSanitizedToken("", true); // flush do que sobrou no buffer de lookback
      stdout = result.stdout;
      code = result.code;
      timedOut = result.timedOut;
      execUsage = result.usage;
    } else {
      // Fallback funcional (não-progressivo) pros outros tiers — streaming
      // de verdade pra zen/soul/langgraph fica pra uma próxima fatia.
      let result: { code: number; stdout: string; stderr: string; timedOut: boolean };
      if (decision.target.provider === "langgraph") {
        result = await Promise.race([
          runLangGraphAgentStream(pool, {
            soul: soul.id,
            prompt: promptSanitized.sanitized,
            timeoutSeconds: 300,
            threadId: `stream-thread-${threadId}`,
            seedMessages: prepared.context.history,
            useTools: true,
          }),
          watchdog.promise,
        ]);
      } else {
        const env = { ...(process.env as Record<string, string>) };
        const rotatedZenKey = nextZenApiKey(config);
        if (rotatedZenKey) env.ZEN_API_KEY = rotatedZenKey;
        result = await Promise.race([
          run!(built.fullPrompt, {
            cwd: soul.dir,
            model,
            timeoutSeconds: 300,
            agent: soul.config.agent ? soul.id : undefined,
            soulId: soul.id,
            env,
          }),
          watchdog.promise,
        ]);
      }
      stdout = result.stdout;
      code = result.code;
      timedOut = result.timedOut;
      // N2: mesma sanitização antes de emitir — este ramo não é progressivo
      // (um blob só), então não precisa de lookback, só sanitizar antes do write.
      if (stdout) {
        const sanitizedForWire = sanitizeLLMResponse(stdout, { taskId: String(session.id), soulId: soul.id }).sanitized;
        writeSSEEvent(res, { type: "token", text: sanitizedForWire });
      }
    }

    // N5: um provider que fecha o stream sem emitir nenhum token real ainda
    // devolve code:0 (ollamaChatStream cai pro placeholder "(sem resposta)")
    // — sem o `stdout.trim()` abaixo isso virava uma mensagem de assistente
    // sintética, permanente, na transcrição da thread.
    const succeeded = code === 0 && !timedOut && stdout.trim().length > 0;
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
      promptHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
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
      writeSSEEvent(res, {
        type: "error",
        message: timedOut
          ? "tempo esgotado"
          : code !== 0
            ? `execução falhou (código ${code})`
            : "resposta vazia do provider",
      });
    }
  } catch (err) {
    writeSSEEvent(res, { type: "error", message: err instanceof Error ? err.message : "erro desconhecido" });
  } finally {
    watchdog.cancel();
    stopHeartbeat();
    res.end();
  }

  return true;
}
