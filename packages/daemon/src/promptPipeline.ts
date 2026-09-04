import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { AssistenteOsConfig, Soul } from "@assistente-os/core";
import {
  anotar,
  todayISODate,
  sumCostBySoul,
  openSession,
  bumpSessionPrompt,
  recordSessionMessage,
  getRecentSessionMessages,
  sessionHistoryTurns,
  sessionHistoryMaxChars,
  recordExecutionSpan,
  logger,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  purgeCredentials,
  logFullAuditEntry,
} from "@assistente-os/core";
import type { RagChunk, RagInjectionFinding } from "@assistente-os/memory";
import { maxFindingSeverity } from "@assistente-os/memory";
import { buildPrompt } from "./context.js";
import { routeFromPrompt } from "./orchestrator/router.js";
import { sendJson } from "./routes/shared.js";
import { promptInjectionAlerts, ragRerankSeconds, ragCacheEvents } from "./observability/metrics.js";

/**
 * Chama o /api/chat do Ollama via node:http. O fetch() do Node (undici) aborta
 * com "fetch failed" após 300s aguardando os headers da resposta — tempo que um
 * modelo local em CPU pode exceder só no prompt eval. Aqui o único limite é o
 * timeoutMs do chamador (o timeoutSeconds da requisição de chat).
 */
export interface ExecUsage {
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

export function ollamaChat(
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

/**
 * Igual a `ollamaChat`, mas com `stream: true` real contra o `/api/chat` do
 * Ollama — cada linha da resposta é um objeto NDJSON com `message.content`
 * (um token/fragmento) até a linha final `{done: true, ...}` com as
 * contagens de uso. `onToken` é chamado uma vez por fragmento, na ordem de
 * chegada; o texto acumulado ainda é devolvido inteiro no final (mesmo
 * formato de retorno de `ollamaChat`) — quem chama não precisa reconstruir
 * o texto sozinho a partir dos tokens, tem os dois.
 */
export function ollamaChatStream(
  baseUrl: string,
  payload: { model: string; messages: Array<{ role: string; content: string }> },
  timeoutMs: number,
  onToken: (text: string) => void,
  /**
   * BUG-01: o `/stream` corre esta chamada contra um watchdog externo
   * (`Promise.race`) — se o watchdog vencer, o `Promise.race` resolve mas
   * esta requisição ao Ollama continuava rodando abandonada (ninguém a
   * `destroy()`ava), presa no único slot do Ollama (`-np 1`) até ele mesmo
   * desistir sozinho, minutos depois. Com `signal`, o chamador aborta de
   * verdade assim que decide não esperar mais.
   */
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; usage?: ExecUsage }> {
  return new Promise((resolvePromise) => {
    let url: URL;
    try {
      url = new URL("/api/chat", baseUrl);
    } catch {
      resolvePromise({ code: 1, stdout: "", stderr: `OLLAMA_URL inválida: ${baseUrl}`, timedOut: false });
      return;
    }
    const body = JSON.stringify({ ...payload, stream: true });
    let timedOut = false;
    let settled = false;
    let accumulated = "";
    let usage: ExecUsage | undefined;
    let buffer = "";

    const finish = (result: { code: number; stdout: string; stderr: string; timedOut: boolean; usage?: ExecUsage }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };

    const onAbort = () => {
      timedOut = true;
      req.destroy(new Error("cancelado: watchdog do /stream desistiu, liberando a chamada ao Ollama"));
    };
    if (signal) {
      if (signal.aborted) {
        resolvePromise({ code: 1, stdout: "", stderr: "cancelado antes de iniciar", timedOut: true });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        // Sem isso, um peer que derruba o socket DEPOIS dos headers (restart do
        // container do Ollama, OOM-kill do processo do modelo, NAT/proxy
        // cortando uma conexão ociosa) nunca dispara "end" nem "error" no
        // ClientRequest — só handlers na RESPOSTA veem esse tipo de falha. Sem
        // eles a Promise nunca resolve: quem chama (o /stream) fica com a
        // conexão SSE aberta pra sempre, sem "done" nem "error", vazando o
        // heartbeat interval e a mensagem do turno.
        res.on("aborted", () => finish({ code: 1, stdout: accumulated, stderr: "conexão com Ollama encerrada no meio do stream", timedOut }));
        res.on("error", (err) => finish({ code: 1, stdout: accumulated, stderr: err.message, timedOut }));
        if ((res.statusCode ?? 0) >= 400) {
          let errData = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (errData += chunk));
          res.on("end", () => finish({ code: 1, stdout: "", stderr: `Ollama HTTP ${res.statusCode}: ${errData.slice(0, 300)}`, timedOut: false }));
          return;
        }
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (!line) continue;
            try {
              const parsed = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
                prompt_eval_count?: number;
                eval_count?: number;
              };
              if (parsed.message?.content) {
                accumulated += parsed.message.content;
                onToken(parsed.message.content);
              }
              if (parsed.done && (typeof parsed.prompt_eval_count === "number" || typeof parsed.eval_count === "number")) {
                usage = { promptTokens: parsed.prompt_eval_count ?? 0, completionTokens: parsed.eval_count ?? 0, source: "provider" };
              }
            } catch {
              /* linha NDJSON inválida — ignora, o stream de Ollama pode ter linhas parciais entre reads */
            }
          }
        });
        res.on("end", () => {
          finish({ code: 0, stdout: accumulated || "(sem resposta)", stderr: "", timedOut: false, usage });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy(new Error(`Ollama não respondeu em ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on("error", (err) => finish({ code: 1, stdout: accumulated, stderr: err.message, timedOut }));
    req.end(body);
  });
}

export interface PreparedPromptContext {
  session: Awaited<ReturnType<typeof openSession>>;
  promptsUsed: number;
  dailyLimit: number | undefined;
  spentToday: number;
  maxTurns: number;
  promptSanitized: ReturnType<typeof sanitizeUserPrompt>;
  history: Awaited<ReturnType<typeof getRecentSessionMessages>>;
  built: Awaited<ReturnType<typeof buildPrompt>>;
  traceId: string;
  traceStartedAt: number;
  emitStep: (module: string, message: string, level?: "err") => void;
}

export type PreparePromptContextResult =
  | { ok: true; context: PreparedPromptContext }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Extraído de handleChat (POST /chat): validação de teto/turnos, sanitização,
 * screening de prompt injection, histórico + RAG. Tudo que roda ANTES de
 * rotear pro executor — checagem de confiança/escalonamento fica de fora
 * (depende do resultado da 1ª execução, não é "preparação"). Reaproveitado
 * pelo /stream futuro; a diferença entre os dois é só a etapa de execução
 * (uma chamada vs. transmitir).
 */
export async function preparePromptContext(params: {
  req: IncomingMessage;
  pool: Pool;
  home: string;
  config: AssistenteOsConfig;
  soul: Soul;
  prompt: string;
  /**
   * Fábrica do sink de notificação "ao vivo" pra cada `emitStep` — recebe o
   * traceId real (gerado aqui dentro) e devolve a função que efetivamente
   * notifica. `/chat` passa uma que reproduz o hub.broadcast de sempre;
   * `/stream` passa uma que escreve/enfileira eventos SSE — NUNCA o hub
   * (decisão da spec: hub faz broadcast sem escopo de conta, inaceitável pra
   * conteúdo de stream). Por isso esta função não recebe `hub` — cada
   * chamador já embute o que precisa dentro do próprio sink que fornece. A
   * persistência em `execution_spans` abaixo roda sempre, pros dois casos —
   * é diagnóstico interno, não é o que a spec restringe.
   */
  createStepSink: (traceId: string) => (module: string, message: string, level?: "err") => void;
  /**
   * Histórico a usar no lugar de `getRecentSessionMessages(pool, session.id, …)`
   * (N3 da revisão final do branch): a sessão por trás de `clientKey` gira a
   * cada `ASSISTENTE_OS_SESSION_IDLE_MINUTES` (default 120min) de ociosidade —
   * `openSession` fecha e reabre, e o histórico por SESSÃO fica vazio mesmo
   * que a THREAD (que não gira) continue mostrando a conversa inteira em
   * `GET /threads/:id/messages`. `/stream` passa o histórico da própria
   * thread aqui; `/chat` não passa nada e mantém o comportamento de sempre.
   */
  historyOverride?: Awaited<ReturnType<typeof getRecentSessionMessages>>;
}): Promise<PreparePromptContextResult> {
  const { req, pool, home, config, soul, prompt, createStepSink, historyOverride } = params;

  // Trace unificado (Onda 2): um id por turno. Correlaciona os spans por
  // estágio (`execution_spans`) à linha canônica de `execution_logs` e ao
  // header `x-trace-id` da resposta. `os trace <id>` / `GET /trace/:id`.
  const traceId = randomUUID();
  const traceStartedAt = Date.now();
  let traceSeq = 0;
  let traceSessionId: number | null = null;
  const onStep = createStepSink(traceId);

  // Passos do pipeline de chat: notificados ao chamador via createStepSink E
  // persistidos como spans (diagnóstico — não entram em custo/uso; falha de
  // escrita é ignorada).
  const emitStep = (module: string, message: string, level?: "err") => {
    try {
      onStep(module, message, level);
    } catch {
      /* sink é fornecido pelo chamador; falha lá não deve derrubar o pipeline */
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

  // ---- Limites: teto diário de custo e turnos por sessão ----
  const dailyLimit = soul.config.dailyLimit;
  const maxTurns = soul.config.agent?.guardrails?.maxTurns ?? soul.config.maxTurns ?? config.defaultMaxTurns;
  const spentToday = await sumCostBySoul(pool, soul.id, todayISODate());
  if (dailyLimit !== undefined && spentToday >= dailyLimit) {
    return { ok: false, status: 429, body: { error: "teto diário de gastos atingido", limit: dailyLimit, spent: spentToday } };
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
    return {
      ok: false,
      status: 429,
      body: { error: "limite de turnos da sessão atingido", maxTurns: session.maxTurns, prompts: session.promptCount },
    };
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
    const modo = config.ragInjectionMode;
    if (modo === "recusar" && injection.maxSeverity === "high") {
      return {
        ok: false,
        status: 400,
        body: {
          error: "prompt recusado: padrão de possível prompt injection detectado",
          patterns: injection.matches.map((m) => m.name),
        },
      };
    }
  }
  emitStep(
    "seguranca",
    injection?.detected ? `possível prompt injection detectada (${injection.maxSeverity})` : "nenhum padrão de prompt injection detectado",
  );

  // ---- Histórico da conversa: por thread se historyOverride foi passado
  // (não gira com a sessão), senão pela sessão (comportamento de /chat,
  // inalterado) — memória multi-turno. ----
  const history =
    historyOverride ??
    (await getRecentSessionMessages(pool, session.id, {
      maxTurns: sessionHistoryTurns(),
      maxChars: sessionHistoryMaxChars(),
    }));

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

  return {
    ok: true,
    context: { session, promptsUsed, dailyLimit, spentToday, maxTurns, promptSanitized, history, built, traceId, traceStartedAt, emitStep },
  };
}

/**
 * SPEC-HR1: fatia inicial — só `POST /chat`. Quando o Postgres está fora do
 * ar, `preparePromptContext` lançaria na primeira query (`sumCostBySoul`) e
 * a requisição morreria com 500 (o daemon em si não cai — há try/catch no
 * nível do servidor — mas não há resposta útil nem registro da troca).
 *
 * Aqui: sem sessão, sem teto diário/turnos, sem RAG (tudo isso depende do
 * Postgres/pgvector), sem histórico. Só o essencial local-first: lê
 * perfil/lições/pessoas do disco (`buildPrompt(..., withRag:false)`), chama
 * o Ollama local direto (tier sempre disponível, sem passar pelo roteador —
 * `routeFromPrompt` também consulta `router_history`), e persiste a troca em
 * `sessoes/YYYY-MM-DD.md` via `anotar()` — a mesma fonte que o RAG reindexa
 * depois que o banco volta.
 */
export async function handleChatDegraded(
  res: ServerResponse,
  soul: Soul,
  prompt: string,
  home: string,
  config: AssistenteOsConfig,
): Promise<boolean> {
  const taskId = `degraded-${randomUUID()}`;
  try {
    const promptSanitized = sanitizeUserPrompt(prompt, { taskId, soulId: soul.id });
    if (promptSanitized.count > 0) {
      logger.warn(`[content-filter] ${promptSanitized.count} secret(s) detectado(s) no prompt (modo degradado) da soul ${soul.id}`);
    }
    const built = await buildPrompt({ home, soul, prompt: promptSanitized.sanitized, config, withRag: false });
    const ollamaModel = config.ollamaChatModel;
    // Mesmo replace de host que o fluxo principal faz — Ollama rodando no
    // host, daemon dentro de container, "host.docker.internal" não resolve.
    let baseUrl = config.ollamaUrl;
    if (baseUrl.includes("host.docker.internal")) {
      baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
    }
    const oll = await ollamaChat(
      baseUrl,
      {
        model: ollamaModel,
        messages: [
          { role: "system", content: built.fullPrompt.replace(promptSanitized.sanitized, "").trim() },
          { role: "user", content: promptSanitized.sanitized },
        ],
        // Sem isto o Ollama transmite NDJSON por padrão — ollamaChat() espera
        // um único objeto JSON na resposta e falha ao dar parse no buffer
        // inteiro (achado pelo próprio teste desta correção).
        stream: false,
      },
      60_000,
    );
    if (oll.code !== 0) {
      logger.error({ err: oll.stderr }, `[HR1] modo degradado: Ollama também falhou (soul ${soul.id})`);
      sendJson(res, 503, {
        error: "banco de dados indisponível e o Ollama local também não respondeu",
        degraded: true,
        detail: oll.stderr,
      });
      return true;
    }
    const responseSanitized = sanitizeLLMResponse(oll.stdout, { taskId, soulId: soul.id });
    anotar(
      soul.dir,
      `[MODO DEGRADADO — Postgres indisponível]\n  Usuário: ${promptSanitized.sanitized}\n  Assistente: ${responseSanitized.sanitized}`,
    );
    logger.warn(`[HR1] resposta em modo degradado (Markdown-only) pra soul ${soul.id} — sem sessão/RAG/limites`);
    sendJson(res, 200, {
      response: responseSanitized.sanitized,
      degraded: true,
      reason: "Postgres indisponível — resposta sem histórico/RAG/limites de turno; registrada em sessoes/*.md e será reindexada quando o banco voltar.",
      model: ollamaModel,
    });
    return true;
  } finally {
    purgeCredentials(taskId);
  }
}
