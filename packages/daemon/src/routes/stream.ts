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
  //
  // R3 da re-revisão final: sem o `limit` abaixo, `getThreadMessages` lia a
  // thread INTEIRA do Postgres a cada turno, só pra `trimHistoryToBudget`
  // jogar fora tudo menos os últimos turnos em seguida — o prompt já saía
  // corretamente limitado, mas a QUERY não. `sessionHistoryTurns() * 2`
  // (turnos = pares usuário+assistente) é o mesmo teto que
  // `getRecentSessionMessages` já aplica em SQL (core/sessions.ts) — mesma
  // forma, mesmo resultado pra uma thread dentro do teto (a única diferença
  // possível seria numa thread MAIOR que o teto, e aí é exatamente esse
  // excesso que não precisa ser lido).
  const threadHistory = trimHistoryToBudget(
    (await getThreadMessages(pool, threadId, sessionHistoryTurns() * 2)).map((m) => ({ role: m.role, content: m.content })),
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
      // lookback.
      //
      // R1 da re-revisão final (rodada 1): os 128 chars de lookback, sozinhos,
      // NÃO garantem cobrir todo padrão de DEFAULT_PATTERNS — PRIVATE_KEY (um
      // bloco PEM, ~1700 chars pra RSA-2048) e GENERIC_TOKEN (um JWT tem
      // rotineiramente 300-900 chars) excedem 128 de sobra, e
      // DATABASE_URL/GENERIC_PASSWORD/ENV_VAR são limitados só por espaço em
      // branco, não por tamanho.
      //
      // R1 rodada 2 (achados pelos próprios testes desta rodada, não só pela
      // revisão — cada um confirmado com um probe isolado antes de aceitar a
      // correção como certa, ver scratchpad desta sessão):
      //
      //  a) a 1ª tentativa de clamp por "última palavra do buffer"
      //     (`pending.search(/\s\S*$/)`) só protege a palavra que está SENDO
      //     formada agora — no instante em que texto NOVO chega depois do
      //     segredo (ex.: "...JWT... — mais texto"), o segredo deixa de ser
      //     "a palavra final" e o clamp para de protegê-lo, mesmo que o corte
      //     de 128 chars caia bem no meio dele. O mesmo valia pro clamp de PEM
      //     original: uma vez que "-----END" aparecia EM QUALQUER LUGAR do
      //     buffer, o clamp parava de proteger, mesmo que o corte de 128
      //     chars ainda caísse ANTES do "-----END" de fato, no meio do bloco.
      //  b) corrigido (a) recuando pro início de QUALQUER palavra em risco
      //     (não só a última) — mas aí um 2º problema apareceu: recuar só até
      //     o início da palavra separa o PREFIXO de palavra-chave ("token: ",
      //     "senha: ") do valor que só termina bem mais adiante, porque os
      //     dois viram pedaços emitidos em chamadas SEPARADAS — e
      //     GENERIC_TOKEN/GENERIC_PASSWORD exigem a keyword ADJACENTE ao
      //     valor na MESMA chamada de sanitizeLLMResponse pra casar. Corrigido
      //     recuando mais SANITIZE_LOOKBACK chars ANTES do início da palavra
      //     em risco (não só até ela) — mantém keyword+valor pendentes juntos
      //     até o valor resolver, aí os dois saem sanitizados na MESMA chamada.
      //
      //  c) S1 da re-revisão final (rodada 2): a margem extra de (b)
      //     (`wordStart - SANITIZE_LOOKBACK`) NÃO verificava se a posição
      //     resultante estava, ela própria, dentro de uma sequência sem
      //     espaço. Quando texto comum chega DEPOIS do segredo (>= ~128
      //     chars), a palavra em risco passa a ser esse texto comum e recuar
      //     128 chars a partir do início dela cai exatamente DENTRO do
      //     segredo — o JWT/URL de banco/senha saía cru na SSE enquanto a
      //     cópia persistida ficava redigida (divergência silenciosa de
      //     auditoria). Corrigido arredondando o corte pra BAIXO até uma
      //     fronteira de espaço de verdade e, aí sim, continuando a recuar
      //     palavra a palavra enquanto o head a emitir terminar em uma
      //     palavra-chave de padrão ("token:", "senha:", "Authorization:",
      //     ...) — o que resolve (b) sem reabrir (a). Só arredondar pra
      //     fronteira de espaço NÃO basta: reabre (b) pro caso "token: <JWT>".
      //  d) S2 da re-revisão final (rodada 3), lacuna PRÉ-EXISTENTE (não veio
      //     de (c)): o clamp de PEM usava `lastIndexOf("-----BEGIN")`, ou
      //     seja, protegia SÓ o último bloco do buffer. Com DUAS chaves na
      //     mesma resposta, o 2º "-----BEGIN" roubava o clamp e a 1ª chave
      //     saía quase inteira em texto puro na SSE (10 de 14 linhas de
      //     base64 no repro do revisor) enquanto o banco gravava dois
      //     [REDACTED_PRIVATE_KEY] — a mesma divergência silenciosa de
      //     auditoria de novo. Todo teste de PEM das 4 rodadas anteriores
      //     usava exatamente UM bloco, por isso nunca foi exercitado.
      //     Corrigido varrendo TODOS os "-----BEGIN".
      //
      // O que o código garante de fato (nem mais, nem menos):
      //  1. o corte nunca cai no meio de uma sequência sem espaço de texto
      //     comum — ele sempre pousa EM uma fronteira de espaço em branco;
      //  2. o corte nunca separa uma palavra-chave de padrão do valor que a
      //     segue (recuo palavra a palavra, limitado a 8 iterações pelo
      //     `guard` — uma pilha de mais de 8 palavras-chave consecutivas
      //     antes do valor para de recuar);
      //  3. o corte nunca cai dentro de NENHUM bloco PEM ainda não emitido —
      //     não só o último do buffer (S2), e não só os "abertos": um bloco
      //     JÁ fechado que ainda não saiu inteiro também segura o corte, já
      //     que PRIVATE_KEY exige "-----BEGIN...-----END-----" numa mesma
      //     chamada de sanitizeLLMResponse. Duas ou mais chaves na mesma
      //     resposta são cobertas; o corte cai antes da PRIMEIRA delas que
      //     ainda não passou inteira.
      // O que ele NÃO garante: um stream patológico SEM NENHUM espaço em
      // branco por mais de 64KB. Aí a válvula de segurança
      // (SANITIZE_MAX_PENDING) força o corte pra não bufferizar sem limite, e
      // nesse caso específico um segredo PODE, sim, sair cru na SSE. É uma
      // troca deliberada (memória limitada > cobertura total nesse caso).
      const SANITIZE_LOOKBACK = 128;
      const SANITIZE_MAX_PENDING = 64 * 1024;
      // palavras-chave que os padrões de DEFAULT_PATTERNS exigem ADJACENTES ao
      // valor (GENERIC_TOKEN, GENERIC_PASSWORD, AWS_SECRET_KEY, ENV_VAR).
      const SANITIZE_KEYWORD_TAIL =
        /(?:token|bearer|authorization|password|passwd|pwd|senha|secret|api_key|credential|aws_secret_access_key|secret_key)['":\s]*$/i;
      let sanitizePending = "";
      const emitSanitizedToken = (chunk: string, flush = false): void => {
        sanitizePending += chunk;
        let cut = Math.max(0, sanitizePending.length - SANITIZE_LOOKBACK);

        // nunca corta no meio de QUALQUER sequência sem espaço (não só a
        // última) — recua pra ANTES do início dela, com uma margem extra de
        // SANITIZE_LOOKBACK chars pra manter um possível prefixo de
        // palavra-chave ("token:", "senha:", ...) junto do valor; e então
        // arredonda esse recuo pra baixo até uma fronteira de espaço REAL
        // (S1: a margem extra, sozinha, podia pousar dentro do segredo).
        if (cut > 0 && cut < sanitizePending.length) {
          const lastWsBefore = (p: number): number => {
            for (let i = p - 1; i >= 0; i--) {
              if (/\s/.test(sanitizePending[i]!)) return i;
            }
            return -1;
          };
          const wordStart = lastWsBefore(cut) + 1;
          cut = Math.max(0, wordStart - SANITIZE_LOOKBACK);
          // pousa EM uma fronteira de palavra, nunca no meio de uma
          if (cut > 0) cut = lastWsBefore(cut) + 1;
          // e nunca emite uma palavra-chave sem o valor que vem depois dela
          let guard = 0;
          while (cut > 0 && guard++ < 8 && SANITIZE_KEYWORD_TAIL.test(sanitizePending.slice(0, cut))) {
            cut = lastWsBefore(cut - 1) + 1;
          }
        }

        // nunca corta dentro de NENHUM bloco PEM ainda não emitido. S2: usar
        // lastIndexOf("-----BEGIN") protegia SÓ o último bloco do buffer —
        // com duas chaves na mesma resposta, a chegada do 2º "-----BEGIN"
        // fazia o clamp pular pra ele e a 1ª chave saía picada (nenhum dos
        // pedaços casa PRIVATE_KEY, que exige BEGIN...END na mesma string).
        // Agora varre TODOS os "-----BEGIN" da frente pra trás e para no
        // primeiro bloco cujo fim seguro ainda esteja além do corte.
        let pemSearchFrom = 0;
        for (;;) {
          const pemStart = sanitizePending.indexOf("-----BEGIN", pemSearchFrom);
          if (pemStart === -1 || pemStart >= cut) break;
          const endIdx = sanitizePending.indexOf("-----END", pemStart);
          let pemSafeEnd = Number.POSITIVE_INFINITY;
          if (endIdx !== -1) {
            const closeDash = sanitizePending.indexOf("-----", endIdx + "-----END".length);
            pemSafeEnd = closeDash === -1 ? Number.POSITIVE_INFINITY : closeDash + 5;
          }
          // esse bloco ainda não passou inteiro — corta ANTES dele
          if (cut < pemSafeEnd) {
            cut = pemStart;
            break;
          }
          // esse bloco já sai inteiro nesta emissão — olha o próximo
          pemSearchFrom = pemSafeEnd;
        }

        // válvula de segurança: nada de espaço/fechamento por 64KB — força o corte
        // mesmo que isso corte no meio de algo (pathológico, sem espaços nunca).
        if (sanitizePending.length > SANITIZE_MAX_PENDING) cut = Math.max(cut, sanitizePending.length - SANITIZE_MAX_PENDING);
        if (flush) cut = sanitizePending.length;
        if (cut <= 0) return;
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

    // N5 (corrigido na re-revisão final — R2: a 1ª tentativa checava só
    // `stdout.trim().length > 0`, mas `ollamaChatStream` (e o ramo langgraph)
    // caem pro literal "(sem resposta)" quando o provider não emite conteúdo
    // real, e essa string tem 14 chars — passava pelo guard de qualquer
    // jeito. Sem o `body !== "(sem resposta)"` abaixo, um provider que fecha
    // o stream sem nenhum token real ainda virava uma mensagem de assistente
    // sintética, permanente, na transcrição da thread.
    const responseBody = stdout.trim();
    const succeeded = code === 0 && !timedOut && responseBody.length > 0 && responseBody !== "(sem resposta)";
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
