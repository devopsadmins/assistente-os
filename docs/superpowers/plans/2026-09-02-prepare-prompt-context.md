# Extract preparePromptContext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the request-validation-through-RAG-retrieval portion of `handleChat`'s `POST /souls/:id/chat` handler (`packages/daemon/src/routes/chat.ts`) into a standalone, exported `preparePromptContext` function, with **zero behavior change** to the existing `/chat` endpoint. This is prep work for a future streaming endpoint (`POST .../messages/stream`, spec B) — not part of this plan — that will call the same function. This plan does nothing except the extraction and proving it's behavior-preserving.

**Architecture:** `preparePromptContext` covers: daily-cost-limit check, session open + turn-limit check, prompt sanitization, prompt-injection screening (with the "recusar" early-refusal path), conversation history retrieval, and RAG-augmented prompt building (with its own injection screening on retrieved chunks) — everything that produces a *prepared, ready-to-route* prompt. **It deliberately does NOT include routing, execution, or confidence-based escalation** — the spec document's prose lists "confidence checking" as part of this extraction, but reading the actual code shows the escalation logic (`shouldEscalate`/`judgeAnswer`) fundamentally depends on having already executed once (it inspects `result.code`, `result.stdout`) — it cannot run before an executor has been called, so it cannot be "preparation." This plan corrects that inaccuracy rather than propagating it; `handleChat` keeps routing/execution/escalation/recording inline, now operating on the object `preparePromptContext` returns instead of on inline local variables.

**Tech Stack:** TypeScript, no new dependencies, no new tests beyond what proves parity — this plan leans on the 5 existing test files that already exercise `POST /chat` end-to-end (`account-isolation.test.ts`, `daemon.test.ts`, `rag-injection-chat.test.ts`, `kill-switch.test.ts`, `skills-prompt.test.ts`) as the regression proof, since they already cover exactly the code surface being moved (sanitization, RAG, injection detection, session/turn limits, account gating).

**Spec:** `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md` §3 names `preparePromptContext` as the target of this extraction. **This plan narrows its scope** relative to that spec's prose (excluding confidence/escalation, per the Architecture note above) — a deliberate, reasoned deviation, not an oversight.

## Global Constraints

- **This is a mechanical, behavior-preserving extraction. Do not "improve," simplify, reorder, or fix anything you notice while moving this code** — not a typo, not an inconsistent variable name, not a seemingly-redundant try/catch. Any such change, however small, is now unverifiable against the "zero behavior change" requirement this plan exists to satisfy. If you spot a real bug while reading this code, note it in your report; do not fix it here.
- **Capture a baseline before touching any code.** From `packages/daemon`: `npm run build && npm test 2>&1 | tee /tmp/chat-extraction-baseline.txt` (or any path outside the repo). Record the exact `tests`/`pass`/`fail`/`skip` counts. After the extraction, the same command must produce **identical counts** — not "still passing," identical numbers. Any new failure, or any previously-passing assertion now failing, blocks this task; it is not something to explain away.
- `preparePromptContext` and its result types are exported from `packages/daemon/src/routes/chat.ts` (same file — spec's own file-placement choice, and there's no reason to add a new file for one function with no other consumer yet).
- Run `npm run build && npm run typecheck && npm test` in `packages/daemon` before every commit.

---

## File Structure

- `packages/daemon/src/routes/chat.ts` — add `preparePromptContext` (exported), `PreparedPromptContext`/`PreparePromptContextResult` types (exported); modify `handleChat`'s `POST /souls/:id/chat` block to call it.

No test files are created or modified by this plan — the existing suite is the proof.

---

## Task 1: Extract `preparePromptContext`

**Files:**
- Modify: `packages/daemon/src/routes/chat.ts`

**Interfaces:**
- Produces: `export interface PreparedPromptContext { session: Session; promptsUsed: number; dailyLimit: number | undefined; spentToday: number; maxTurns: number; promptSanitized: SanitizedPrompt; history: SessionMessage[]; built: BuiltPrompt; traceId: string; traceStartedAt: number; emitStep: (module: string, message: string, level?: "err") => void }` and `export type PreparePromptContextResult = { ok: true; context: PreparedPromptContext } | { ok: false; status: number; body: Record<string, unknown> }`, plus `export async function preparePromptContext(params: {...}): Promise<PreparePromptContextResult>`. Not consumed by any other task in this plan — the future streaming endpoint (separate, later plan) is the real second consumer.

- [ ] **Step 1: Capture the baseline**

```bash
cd packages/daemon
npm run build
npm test 2>&1 | tee /tmp/chat-extraction-baseline.txt
tail -15 /tmp/chat-extraction-baseline.txt
```

Record the exact `tests N / pass N / fail N / skipped N` line. This is what every later run in this task must match exactly.

- [ ] **Step 2: Add `preparePromptContext` to `packages/daemon/src/routes/chat.ts`**

Insert this new function **immediately after** the existing `ollamaChat` function (i.e., right before the comment `/** Rotas de execução de prompt: ... */` that precedes `handleChat`). Every line of logic inside it is copied verbatim from the existing `handleChat` body (currently lines ~259–440, the block starting at `// ---- Limites: teto diário de custo e turnos por sessão ----` and ending right before `// route() sonda cada degrau...`) — do not retype it from memory or paraphrase; copy the exact existing lines and adapt only the wrapping (function signature, `return` statements replacing `sendJson(...); return true;` early-exit points, and the final `return { ok: true, context: {...} }` replacing the fall-through into the routing code):

```typescript
import type { Pool } from "pg";
import type { AssistenteOsConfig, Soul } from "@assistente-os/core";
import type { WsHub } from "../server.js";

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
  res: ServerResponse;
  pool: Pool;
  hub: WsHub;
  home: string;
  config: AssistenteOsConfig;
  soul: Soul;
  prompt: string;
}): Promise<PreparePromptContextResult> {
  const { req, res, pool, hub, home, config, soul, prompt } = params;

  const traceId = randomUUID();
  const traceStartedAt = Date.now();
  let traceSeq = 0;
  let traceSessionId: number | null = null;
  try {
    res.setHeader("x-trace-id", traceId);
  } catch {
    /* headers já enviados — ignora */
  }

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
    const modo = process.env.PROMPT_INJECTION_MODO || "aviso";
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

  return {
    ok: true,
    context: { session, promptsUsed, dailyLimit, spentToday, maxTurns, promptSanitized, history, built, traceId, traceStartedAt, emitStep },
  };
}
```

The three new top-of-file type imports (`Pool` from `"pg"`, `AssistenteOsConfig`/`Soul` from `"@assistente-os/core"`, `WsHub` from `"../server.js"`) go with the file's existing import block at the top — add them as new `import type { ... }` lines near the existing imports, don't restructure the existing ones. Check whether `Soul`/`AssistenteOsConfig`/`Pool` are already imported under different names anywhere in this file first (e.g. `getSoul`'s return type already implies `Soul` is known to TypeScript via inference elsewhere) — add the explicit type-only imports regardless, since the new function signature needs them named.

- [ ] **Step 3: Rewire `handleChat`'s `POST /souls/:id/chat` block to call it**

Inside the existing `if (chatMatch && req.method === "POST") { ... }` block, find:

```typescript
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
      ...
    };
    {
      // ---- Limites: teto diário de custo e turnos por sessão ----
      ... (everything through the closing of the RAG-injection block) ...

      // route() sonda cada degrau (sem executar o prompt) e cai para o próximo se o
      // degrau local não responder; a execução real acontece uma única vez, abaixo,
      // no degrau vencedor.
      const orchDecision = await routeFromPrompt(pool, config, soul, promptSanitized.sanitized, makeLocalFallbackProbe(config.ollamaUrl), explicitMode);
```

Replace everything from `const traceId = randomUUID();` through (but not including) the `const orchDecision = await routeFromPrompt(...)` line with:

```typescript
    const config = await loadConfig({ home });
    const pool = getPool(config.databaseUrl);

    const prepared = await preparePromptContext({ req, res, pool, hub, home, config, soul, prompt });
    if (!prepared.ok) {
      sendJson(res, prepared.status, prepared.body);
      return true;
    }
    const { session, promptsUsed, dailyLimit, spentToday, maxTurns, promptSanitized, history, built, traceId, traceStartedAt, emitStep } =
      prepared.context;
    {
      // route() sonda cada degrau (sem executar o prompt) e cai para o próximo se o
      // degrau local não responder; a execução real acontece uma única vez, abaixo,
      // no degrau vencedor.
      const orchDecision = await routeFromPrompt(pool, config, soul, promptSanitized.sanitized, makeLocalFallbackProbe(config.ollamaUrl), explicitMode);
```

Everything from `const orchDecision = ...` through the end of the handler (the final `sendJson(res, 200, {...})` and closing braces) stays **exactly as it was** — you are only replacing the "prepare" section above it, not anything after `routeFromPrompt`. Note `history` is now threaded through from `prepared.context` even though the routing/execution code doesn't reference the name `history` directly by that point in the *old* code before this edit — check the existing code further down (around where LangGraph is dispatched) for a `seedMessages: history` reference; if that line exists, it now correctly resolves to the destructured `history` above instead of a local variable that used to be declared inline in the same scope.

- [ ] **Step 4: Build and typecheck**

```bash
cd packages/daemon
npm run build
npm run typecheck
```

Expected: both clean. If TypeScript flags anything about the new function's parameter/return types, resolve it by adjusting the type annotations to match what the actual helper functions (`openSession`, `sanitizeUserPrompt`, `getRecentSessionMessages`, `buildPrompt`) really return — do not silence an error with `any` or a type assertion; the whole point of this exercise is type-checked confidence that nothing changed.

- [ ] **Step 5: Run the full test suite and diff against the baseline**

```bash
cd packages/daemon
npm test 2>&1 | tee /tmp/chat-extraction-after.txt
diff <(tail -15 /tmp/chat-extraction-baseline.txt) <(tail -15 /tmp/chat-extraction-after.txt)
```

Expected: the `diff` shows no difference in the `tests`/`pass`/`fail`/`skipped` counts (timing/duration lines will naturally differ — that's fine, only the counts matter). If anything differs, do not proceed — the extraction introduced a behavior change; find it by comparing your new `preparePromptContext` body against the original code side by side, line by line, rather than guessing.

Additionally, explicitly re-run and read the output of the 5 test files that exercise `POST /chat` via real HTTP, to directly confirm nothing about the actual request/response behavior shifted (not just aggregate counts):

```bash
npx vitest run 2>/dev/null; node --test dist/test/account-isolation.test.js dist/test/daemon.test.js dist/test/rag-injection-chat.test.js dist/test/kill-switch.test.js dist/test/skills-prompt.test.js
```

(This repo's daemon package uses `node:test`, not vitest — the `vitest run` above is a no-op guard in case that's wrong; the real command is the `node --test ...` one. If that exact multi-file invocation doesn't work in this repo's actual `node --test` setup, run each file individually instead — the point is confirming each of these 5 files, specifically, still passes in full.)

- [ ] **Step 6: Commit**

```bash
git add src/routes/chat.ts
git commit -m "refactor(daemon): extract preparePromptContext from handleChat, no behavior change"
```

---

## Self-Review Notes

- **Spec coverage:** implements the extraction spec B names, with one deliberate, explained scope narrowing (excludes confidence/escalation — see Architecture). Routing, execution, and the streaming endpoint itself are explicitly not part of this plan.
- **No placeholders:** the extracted function's code is not paraphrased — every step of this plan instructs copying exact existing lines, and Step 5's baseline-diff is the mechanism that catches it if that instruction wasn't followed precisely.
- **Type consistency:** `PreparedPromptContext`'s fields are exactly the set of "prepare"-phase locals actually referenced after `routeFromPrompt` in the original code (`session`, `promptsUsed`, `dailyLimit`, `spentToday`, `maxTurns`, `promptSanitized`, `history`, `built`, `traceId`, `traceStartedAt`, `emitStep`) — verified by reading the full original function through to its final `sendJson` call before writing this plan, not assumed.
- **This plan's only "test" is proof-of-no-change**, which is the correct shape for a pure refactor of security-sensitive code — new test-writing was deliberately not added, since the existing 5-file HTTP-level suite already exercises exactly this surface (sanitization, RAG, injection detection both directions, session/turn limits, account gating) and is the higher-value signal here.
