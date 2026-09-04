# Streaming Endpoint (Ollama tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `POST /souls/:id/threads/:threadId/messages/stream` — real token-by-token SSE streaming for the `ollama` tier, with a functional (single-shot, non-streaming) fallback for `zen`/`soul`/`langgraph` tiers so the endpoint is end-to-end usable today. Real progressive streaming for the other tiers is explicitly deferred to follow-up slices — this is the first, smallest complete vertical slice of spec B's streaming work (spec's own effort estimate for the whole streaming piece: L).

**Architecture:** Five independent-ish pieces composed by one route handler:
1. An SSE protocol module (`packages/daemon/src/routes/sse.ts`) — the `StreamEvent` wire type, header/write/heartbeat helpers. No dependency on anything else in this plan.
2. `preparePromptContext` (already extracted, `main`) gains one small, backward-compatible change: instead of building its own hub-broadcasting step notifier internally, it accepts a `createStepSink` factory from the caller. `/chat` passes one that reproduces today's exact hub-broadcast behavior (zero behavior change there); `/stream` passes one that writes SSE `step` events instead — and, per the spec's own resolved decision, `/stream` never touches `hub.broadcast` at all (the hub broadcasts unscoped to every connected client of any account — an explicitly rejected channel for stream content).
3. `recordSessionMessage` (core) gains an optional `threadId` parameter and returns the inserted row's id — needed so `GET /threads/:id/messages` (already shipped, currently has no producer) starts actually returning data, and so the stream's `done` event can report a real `messageId`.
4. `ollamaChat` (daemon) gains a streaming sibling that sets `stream: true` against Ollama's real streaming API and forwards each token as it arrives via a callback, while still returning the same aggregate shape (`code`/`stdout`/`stderr`/`timedOut`/`usage`) the existing blocking call returns — so everything downstream of "I have the final text" stays identical to `/chat`'s pattern.
5. The route handler itself: resolves the thread (ownership via the already-shipped `getThread`), opens a **thread-scoped session** (a session per thread, not per client — see Global Constraints for why this is free given the existing schema), calls `preparePromptContext`, routes via the existing `routeFromPrompt`, dispatches (real streaming for `ollama`, one blocking call formatted as a single `token` event for everything else), persists the turn, and closes the SSE stream with `done`.

**Tech Stack:** TypeScript, Node's raw `http`/SSE (`text/event-stream`, no library — matches this daemon's existing no-framework style), `node:test` + real Postgres + real HTTP daemon integration tests (`startDaemon()`), matching every other daemon plan today.

**Spec:** `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md` §3 (protocol, endpoint) and its "Decisão: heartbeat do `/stream`" section (SSE comment ping, never the hub — already resolved in the spec itself, not a new decision this plan makes).

## Global Constraints

- **Thread-scoped sessions, not shared-per-client sessions.** `openSession(pool, soul, maxTurns, budgetCap, clientKey)` already enforces one open session per `(soul, client_key)` (`sessions.ts:116`, `ON CONFLICT (soul, client_key) WHERE ended_at IS NULL`). The stream route derives `clientKey = \`thread-${threadId}\`` instead of the header/token-derived key `/chat` uses. This is a **zero-schema-change** fix for the cross-thread history/turn-budget contamination the prior final review flagged: every thread gets its own session, its own turn counter, its own history, for free, via code already shipped and tested. Do not add a `threadId` parameter to `openSession`/`getRecentSessionMessages` — it is not needed with this approach, and adding one would be solving an already-solved problem with more surface area.
- **`session_messages.thread_id` must be populated on write** — `GET /threads/:id/messages` (already shipped in `main`, via `getThreadMessages`) filters by `thread_id` and currently always returns `[]` in production because nothing writes that column. This plan's persistence step is what makes that endpoint start working, not a separate concern.
- **Stream content (steps, tokens) never goes through `hub.broadcast`.** This is the spec's own resolved decision (`docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md`, "Decisão: heartbeat do `/stream`" section) — the hub broadcasts unscoped to every connected client of any account, which the spec calls out as unacceptable for a multi-tenant surface. `/chat`'s existing hub-broadcast behavior is untouched by this plan.
- **Heartbeat is an SSE comment line (`: ping\n\n`) on the stream's own connection**, sent periodically starting immediately after headers — not the WS hub, not a separate mechanism. Per the same spec decision: a WS connection being alive proves nothing about whether the `/stream` HTTP connection itself is still alive (separate TCP connections; a proxy/timeout/backgrounded tab can kill one without the other noticing).
- **Confidence-based escalation is out of scope**, same exclusion as `preparePromptContext`'s own boundary (spec's prose lists it as part of streaming; the actual code shows it depends on a first execution result, so it cannot run before dispatch — already corrected once this session, not re-litigated here).
- **Real progressive streaming is `ollama`-tier only in this plan.** If `routeFromPrompt` selects `zen`, `soul`, or `langgraph`, the handler still produces a fully functional response — it calls the existing blocking executor once, then emits the whole result as a single `{type:"token"}` event followed by `{type:"done"}`. This is not a stub: the endpoint is genuinely usable end-to-end for every tier today, it just doesn't *feel* incremental except on `ollama`. A later plan replaces this fallback with real per-tier streaming.
- No new npm dependencies.
- Run `npm run build && npm run typecheck && npm test` in both `packages/core` and `packages/daemon` (whichever a task touches) before every commit.

---

## File Structure

- `packages/daemon/src/routes/sse.ts` — new: `StreamEvent` type, `startSSE`/`writeSSEEvent`/`startHeartbeat`.
- `packages/daemon/src/routes/chat.ts` — modify: `preparePromptContext` takes `createStepSink` instead of building its notifier internally; `handleChat`'s call site updated to match (zero behavior change).
- `packages/core/src/sessions.ts` — modify: `recordSessionMessage` gains optional `threadId`, returns the inserted id.
- `packages/daemon/src/routes/chat.ts` — modify: `ollamaChat` gains a streaming sibling `ollamaChatStream`.
- `packages/daemon/src/routes/stream.ts` — new: `handleStream` (`RouteHandler`), the actual endpoint.
- `packages/daemon/src/server.ts` — register `handleStream`.
- Tests: `packages/core/src/test/sessions.test.ts` (extend, if it exists — check first) or a new focused test file for the `recordSessionMessage` change; `packages/daemon/src/test/stream-routes.test.ts` (new, HTTP-level, real daemon).

---

## Task 1: SSE protocol module

**Files:**
- Create: `packages/daemon/src/routes/sse.ts`
- Create: `packages/daemon/src/test/sse.test.ts`

**Interfaces:**
- Produces: `export type StreamEvent = { type: "step"; step: string; message?: string; tool?: string } | { type: "token"; text: string } | { type: "done"; messageId: number; usage: { promptTokens: number; completionTokens: number; source: "provider" | "estimate" }; sources?: Array<{ title: string; url?: string; snippet?: string }> } | { type: "error"; message: string }`, `export function startSSE(res: ServerResponse): void`, `export function writeSSEEvent(res: ServerResponse, event: StreamEvent): void`, `export function startHeartbeat(res: ServerResponse, intervalMs: number): () => void`. Consumed by Task 5.

Note on `StreamEvent.step`: the spec's literal draft is `{ type: "step"; step: string; tool?: string }` with no free-text field — but `preparePromptContext`'s `emitStep` calls always carry a human-readable `message` (e.g. "RAG: contexto relevante encontrado (2 fonte(s))"), which is exactly what a UI step indicator needs and the spec's minimal shape has no room for. This plan adds `message?: string` to the type as a deliberate, additive correction — same category of spec-vs-code reconciliation as `preparePromptContext`'s own confidence/escalation exclusion earlier this session.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/daemon/src/test/sse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import { startSSE, writeSSEEvent, startHeartbeat } from "../routes/sse.js";

function fakeRes(): { res: ServerResponse; chunks: string[]; headers: { status?: number; headers?: Record<string, string> } } {
  const chunks: string[] = [];
  const headers: { status?: number; headers?: Record<string, string> } = {};
  const stream = new PassThrough();
  stream.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
  const res = {
    writeHead: (status: number, hdrs: Record<string, string>) => {
      headers.status = status;
      headers.headers = hdrs;
    },
    write: (chunk: string) => {
      stream.write(chunk);
      return true;
    },
    end: () => stream.end(),
  } as unknown as ServerResponse;
  return { res, chunks, headers };
}

test("startSSE: envia headers corretos pra event-stream", () => {
  const { res, headers } = fakeRes();
  startSSE(res);
  assert.equal(headers.status, 200);
  assert.equal(headers.headers?.["content-type"], "text/event-stream");
  assert.equal(headers.headers?.["cache-control"], "no-cache");
  assert.equal(headers.headers?.["connection"], "keep-alive");
});

test("writeSSEEvent: formata como 'data: <json>\\n\\n'", () => {
  const { res, chunks } = fakeRes();
  writeSSEEvent(res, { type: "token", text: "olá" });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], `data: ${JSON.stringify({ type: "token", text: "olá" })}\n\n`);
});

test("writeSSEEvent: cada tipo de evento serializa os campos certos", () => {
  const { res, chunks } = fakeRes();
  writeSSEEvent(res, { type: "step", step: "rag", message: "contexto encontrado" });
  writeSSEEvent(res, { type: "done", messageId: 42, usage: { promptTokens: 10, completionTokens: 5, source: "provider" } });
  writeSSEEvent(res, { type: "error", message: "falhou" });
  assert.equal(chunks.length, 3);
  assert.deepEqual(JSON.parse(chunks[0]!.slice("data: ".length, -2)), { type: "step", step: "rag", message: "contexto encontrado" });
  assert.deepEqual(JSON.parse(chunks[1]!.slice("data: ".length, -2)), {
    type: "done",
    messageId: 42,
    usage: { promptTokens: 10, completionTokens: 5, source: "provider" },
  });
  assert.deepEqual(JSON.parse(chunks[2]!.slice("data: ".length, -2)), { type: "error", message: "falhou" });
});

test("startHeartbeat: escreve um comentário SSE periodicamente até ser parado", async () => {
  const { res, chunks } = fakeRes();
  const stop = startHeartbeat(res, 20);
  await new Promise((resolve) => setTimeout(resolve, 65));
  stop();
  const countAfterStop = chunks.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(chunks.length, countAfterStop, "não deve escrever mais nada depois de stop()");
  assert.ok(countAfterStop >= 2, `esperava pelo menos 2 heartbeats em 65ms com intervalo 20ms, teve ${countAfterStop}`);
  for (const c of chunks) assert.equal(c, ": ping\n\n");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && npm run build && npm test -- 2>&1 | grep -A5 sse.test`
Expected: FAIL — `../routes/sse.js` does not exist.

- [ ] **Step 3: Implement `sse.ts`**

```typescript
// packages/daemon/src/routes/sse.ts
import type { ServerResponse } from "node:http";

export type StreamEvent =
  | { type: "step"; step: string; message?: string; tool?: string }
  | { type: "token"; text: string }
  | {
      type: "done";
      messageId: number;
      usage: { promptTokens: number; completionTokens: number; source: "provider" | "estimate" };
      sources?: Array<{ title: string; url?: string; snippet?: string }>;
    }
  | { type: "error"; message: string };

/** Cabeçalhos de resposta SSE. Chamar uma única vez, antes de qualquer writeSSEEvent/heartbeat. */
export function startSSE(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    // Desliga buffering de proxies reversos (nginx) que, por padrão, esperam
    // a resposta fechar antes de repassar bytes — quebraria streaming de verdade.
    "x-accel-buffering": "no",
  });
}

export function writeSSEEvent(res: ServerResponse, event: StreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Comentário SSE periódico (`: ping\n\n`) na PRÓPRIA conexão do /stream — não
 * o hub WS (decisão já resolvida na spec: WS vivo não prova que esta conexão
 * segue viva; proxy/timeout/aba em background podem matar uma sem a outra notar).
 * Devolve uma função de parada; chamador é responsável por chamá-la quando o
 * stream terminar (sucesso ou erro), senão o interval vaza.
 */
export function startHeartbeat(res: ServerResponse, intervalMs: number): () => void {
  const id = setInterval(() => {
    res.write(": ping\n\n");
  }, intervalMs);
  return () => clearInterval(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/daemon && npm run build && npm test`
Expected: all green, including the 4 new `sse.test.ts` tests.

- [ ] **Step 5: Commit**

```bash
cd packages/daemon
git add src/routes/sse.ts src/test/sse.test.ts
git commit -m "feat(daemon): SSE protocol module — StreamEvent, headers, heartbeat"
```

---

## Task 2: `preparePromptContext` accepts an injectable step-notification sink

**Files:**
- Modify: `packages/daemon/src/routes/chat.ts`

**Interfaces:**
- Produces: updated `preparePromptContext` signature — `createStepSink: (traceId: string) => (module: string, message: string, level?: "err") => void` replaces the internal hub-broadcast construction. `PreparedPromptContext`'s shape is otherwise unchanged. Consumed by Task 5 (the new `/stream` route) and by `handleChat` itself (updated in this task to preserve exact current behavior).

- [ ] **Step 1: Write the failing test**

Append to `packages/daemon/src/test/rag-injection-chat.test.ts` (it already exercises `POST /chat` end-to-end and is the closest existing coverage of `emitStep`-driven behavior) — or, if you'd rather keep this isolated, create `packages/daemon/src/test/prepare-prompt-context-sink.test.ts`; either is fine, pick whichever reads more naturally once you're looking at the actual file. The test itself:

```typescript
// A minimal direct test of the sink injection, independent of full HTTP
// plumbing — proves the factory receives traceId and that emitStep routes
// through it (not through any hardcoded hub call) without needing a live daemon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePromptContext } from "../routes/chat.js";
import { createTestSchema } from "./pgTestHelper.js";
import { createSoul } from "@assistente-os/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("preparePromptContext: createStepSink recebe o traceId real e emitStep passa por ele", async () => {
  const testDb = await createTestSchema();
  const home = mkdtempSync(join(tmpdir(), "aos-sink-"));
  try {
    createSoul(home, "soul-sink-test", { name: "soul-sink-test" });
    const soul = { id: "soul-sink-test", dir: join(home, "souls", "soul-sink-test"), config: { name: "soul-sink-test" } };
    const received: Array<{ module: string; message: string; level?: string; traceId: string }> = [];
    let capturedTraceId: string | undefined;

    const config = { defaultMaxTurns: 10, databaseUrl: "", ollamaUrl: "http://127.0.0.1:11434" } as any;
    const req = { headers: {} } as any;
    const fakeHub = { broadcast: () => {} } as any;

    const result = await preparePromptContext({
      req,
      pool: testDb.pool,
      hub: fakeHub,
      home,
      config,
      soul: soul as any,
      prompt: "teste de sink",
      createStepSink: (traceId: string) => {
        capturedTraceId = traceId;
        return (module: string, message: string, level?: "err") => {
          received.push({ module, message, level, traceId });
        };
      },
    });

    assert.ok(result.ok, "esperava sucesso na preparação");
    assert.ok(capturedTraceId, "createStepSink deveria ter recebido um traceId");
    assert.ok(received.length > 0, "emitStep deveria ter chamado o sink pelo menos uma vez");
    for (const r of received) assert.equal(r.traceId, capturedTraceId, "todo evento deve carregar o mesmo traceId");
    if (result.ok) assert.equal(result.context.traceId, capturedTraceId, "o traceId devolvido no contexto deve ser o mesmo passado ao sink");
  } finally {
    await testDb.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/daemon && npm run build`
Expected: FAIL to compile — `preparePromptContext`'s params type doesn't have `createStepSink` yet (TS2353/TS2345 depending on exact call shape).

- [ ] **Step 3: Implement the change**

In `packages/daemon/src/routes/chat.ts`, inside `preparePromptContext`'s params type, replace `hub: WsHub;` with keeping `hub: WsHub` (still needed — nothing else changes about the parameter list) but change how the step notifier is built. Find:

```typescript
export async function preparePromptContext(params: {
  req: IncomingMessage;
  pool: Pool;
  hub: WsHub;
  home: string;
  config: AssistenteOsConfig;
  soul: Soul;
  prompt: string;
}): Promise<PreparePromptContextResult> {
  const { req, pool, hub, home, config, soul, prompt } = params;

  // Trace unificado (Onda 2): ...
  const traceId = randomUUID();
  const traceStartedAt = Date.now();
  let traceSeq = 0;
  let traceSessionId: number | null = null;

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
```

Replace with:

```typescript
export async function preparePromptContext(params: {
  req: IncomingMessage;
  pool: Pool;
  hub: WsHub;
  home: string;
  config: AssistenteOsConfig;
  soul: Soul;
  prompt: string;
  /**
   * Fábrica do sink de notificação "ao vivo" pra cada `emitStep` — recebe o
   * traceId real (gerado aqui dentro) e devolve a função que efetivamente
   * notifica. `/chat` passa uma que reproduz o hub.broadcast de sempre;
   * `/stream` passa uma que escreve eventos SSE — NUNCA o hub (decisão da
   * spec: hub faz broadcast sem escopo de conta, inaceitável pra conteúdo de
   * stream). A persistência em `execution_spans` abaixo roda sempre, pros
   * dois casos — é diagnóstico interno, não é o que a spec restringe.
   */
  createStepSink: (traceId: string) => (module: string, message: string, level?: "err") => void;
}): Promise<PreparePromptContextResult> {
  const { req, pool, hub, home, config, soul, prompt, createStepSink } = params;

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
```

Note `hub` is still destructured from `params` even though `emitStep` no longer uses it directly inside `preparePromptContext` — it stays in the parameter list because `handleChat`'s `createStepSink` implementation (next) needs `hub` from its own closure, not from inside `preparePromptContext`; keeping `hub: WsHub` in the type is harmless (TypeScript won't complain about an unused destructured variable without `noUnusedLocals`, already confirmed off in this repo) and avoids a signature churn beyond what's needed. If you prefer, you may drop `hub` from `preparePromptContext`'s parameter type entirely since it's genuinely unused inside the function body now — either is acceptable; if you drop it, remove `hub` from the destructure too and don't pass it from `handleChat`'s call either, for consistency.

In `handleChat`, find the call site:

```typescript
    const prepared = await preparePromptContext({ req, pool, hub, home, config, soul, prompt });
```

Replace with:

```typescript
    const prepared = await preparePromptContext({
      req,
      pool,
      hub,
      home,
      config,
      soul,
      prompt,
      createStepSink: (traceId) => (module, message, level) => {
        try {
          hub.broadcast({ type: "chat.step", soul: soul.id, ts: Date.now(), module, message, level, traceId });
        } catch {
          /* ws opcional */
        }
      },
    });
```

This reproduces the exact original hub-broadcast call — same event shape, same fields, same swallow-on-error — just moved to the call site instead of being hardcoded inside `preparePromptContext`. `/chat`'s behavior does not change.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/daemon
npm run build
npm test
```

Expected: all green, including the new sink test and every pre-existing test (176+ from before, plus this task's addition) — this is a behavior-preserving change for `/chat`, same discipline as the original extraction. Specifically re-confirm the 5 HTTP-level `/chat` test files still pass, same as every prior task touching this file today.

- [ ] **Step 5: Commit**

```bash
cd packages/daemon
git add src/routes/chat.ts src/test/*.test.ts
git commit -m "refactor(daemon): preparePromptContext accepts injectable step sink, no behavior change to /chat"
```

---

## Task 3: `recordSessionMessage` gains `threadId` + returns the inserted id

**Files:**
- Modify: `packages/core/src/sessions.ts`
- Modify: `packages/core/src/test/sessions.test.ts` if it exists (check `packages/core/src/test/` first — if no such file exists, create `packages/core/src/test/sessions-thread-id.test.ts`)

**Interfaces:**
- Produces: `recordSessionMessage(pool: Pool, sessionId: number, soul: string, role: SessionMessage["role"], content: string, threadId?: number): Promise<number>` (return type changes from `Promise<void>` to `Promise<number>` — the inserted row's id). Every existing caller (in `handleChat`, unrelated to this plan's own changes) ignores the return value already, so this is source-compatible; only the type signature is technically different. Consumed by Task 5.

- [ ] **Step 1: Check for an existing test file and write the failing test**

```bash
ls packages/core/src/test/ | grep -i session
```

If `sessions.test.ts` (or similarly named) exists, read it first and add the test below in its established style/imports. Otherwise create `packages/core/src/test/sessions-thread-id.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSession, recordSessionMessage } from "../sessions.js";
import { createThread } from "../threads.js";
import { createAccount } from "../accounts.js";
import { createTestSchema } from "./pgTestHelper.js";

test("recordSessionMessage: grava thread_id quando informado e devolve o id da mensagem", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "recmsg@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);
    const session = await openSession(testDb.pool, "fiscal", 10, undefined, `thread-${thread.id}`);

    const messageId = await recordSessionMessage(testDb.pool, session.id, "fiscal", "user", "oi", thread.id);
    assert.ok(Number.isInteger(messageId) && messageId > 0);

    const { rows } = await testDb.pool.query("SELECT thread_id, content FROM session_messages WHERE id = $1", [messageId]);
    assert.equal(Number(rows[0].thread_id), thread.id);
    assert.equal(rows[0].content, "oi");
  } finally {
    await testDb.cleanup();
  }
});

test("recordSessionMessage: sem threadId continua funcionando (thread_id fica NULL) — compatibilidade com /chat", async () => {
  const testDb = await createTestSchema();
  try {
    const session = await openSession(testDb.pool, "fiscal", 10, undefined, "default");
    const messageId = await recordSessionMessage(testDb.pool, session.id, "fiscal", "assistant", "resposta sem thread");
    const { rows } = await testDb.pool.query("SELECT thread_id FROM session_messages WHERE id = $1", [messageId]);
    assert.equal(rows[0].thread_id, null);
  } finally {
    await testDb.cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core
npm run build
npm test
```

Expected: FAIL — `recordSessionMessage` doesn't accept a 6th argument yet / doesn't return a usable id.

- [ ] **Step 3: Implement the change**

In `packages/core/src/sessions.ts`, replace:

```typescript
export async function recordSessionMessage(
  pool: Pool,
  sessionId: number,
  soul: string,
  role: SessionMessage["role"],
  content: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO session_messages (session_id, soul, role, content, ts) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, soul, role, content, nowIso()],
  );
}
```

with:

```typescript
/** threadId opcional — quando informado, grava em session_messages.thread_id (é o que GET .../threads/:id/messages lê). Devolve o id da mensagem gravada. */
export async function recordSessionMessage(
  pool: Pool,
  sessionId: number,
  soul: string,
  role: SessionMessage["role"],
  content: string,
  threadId?: number,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO session_messages (session_id, soul, role, content, ts, thread_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [sessionId, soul, role, content, nowIso(), threadId ?? null],
  );
  return Number(rows[0]!.id);
}
```

- [ ] **Step 4: Check and fix existing callers**

```bash
grep -rn "recordSessionMessage(" packages/*/src --include="*.ts" | grep -v test | grep -v "\.d\.ts"
```

Every existing call site (there should be exactly the two in `handleChat`'s tail, `packages/daemon/src/routes/chat.ts`, recording the user turn and the assistant turn on the blocking `/chat` path) calls this with 5 arguments and doesn't use the return value — that remains valid TypeScript (an optional 6th parameter, an unused return value) and needs no code change. Confirm this by running the daemon's own build in the next step; if it doesn't compile, you'll see exactly where.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/core
npm run build
npm test
```

Expected: all green, including the 2 new tests.

Then confirm the daemon package (which calls this function) still compiles against the new signature:

```bash
cd ../daemon
npm run build
npm run typecheck
```

Expected: clean (per Step 4's reasoning, no code change needed there, just confirming).

- [ ] **Step 6: Commit**

```bash
cd packages/core
git add src/sessions.ts src/test/
git commit -m "feat(core): recordSessionMessage accepts optional threadId, returns inserted message id"
```

---

## Task 4: `ollamaChat` gains a real streaming sibling

**Files:**
- Modify: `packages/daemon/src/routes/chat.ts`
- Create: `packages/daemon/src/test/ollama-chat-stream.test.ts`

**Interfaces:**
- Produces: `export function ollamaChatStream(baseUrl: string, payload: { model: string; messages: Array<{ role: string; content: string }> }, timeoutMs: number, onToken: (text: string) => void): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; usage?: ExecUsage }>`. Consumed by Task 5. Does not touch or rename the existing `ollamaChat` (still used by `/chat`, unchanged).

- [ ] **Step 1: Write the failing tests**

Ollama's real `/api/chat` endpoint isn't available in this test environment as a mockable HTTP server without real infrastructure — test this against a **local fake HTTP server** you stand up in the test itself (not a mock of `ollamaChatStream`'s internals — a real `http.createServer` that speaks Ollama's actual NDJSON streaming wire format), so the test proves the real parsing/forwarding logic, not a mocked shortcut.

```typescript
// packages/daemon/src/test/ollama-chat-stream.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ollamaChatStream } from "../routes/chat.js";

function startFakeOllama(chunks: object[], opts?: { statusCode?: number }): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (opts?.statusCode && opts.statusCode >= 400) {
        res.writeHead(opts.statusCode);
        res.end("erro simulado");
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      let i = 0;
      const sendNext = () => {
        if (i >= chunks.length) {
          res.end();
          return;
        }
        res.write(JSON.stringify(chunks[i]) + "\n");
        i++;
        setTimeout(sendNext, 5);
      };
      sendNext();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("ollamaChatStream: encaminha cada token via onToken e acumula o texto final", async () => {
  const fake = await startFakeOllama([
    { message: { content: "Olá" } },
    { message: { content: ", " } },
    { message: { content: "mundo!" } },
    { done: true, prompt_eval_count: 12, eval_count: 4 },
  ]);
  try {
    const tokens: string[] = [];
    const result = await ollamaChatStream(fake.url, { model: "test-model", messages: [{ role: "user", content: "oi" }] }, 5000, (t) =>
      tokens.push(t),
    );
    assert.deepEqual(tokens, ["Olá", ", ", "mundo!"]);
    assert.equal(result.stdout, "Olá, mundo!");
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.usage?.promptTokens, 12);
    assert.equal(result.usage?.completionTokens, 4);
    assert.equal(result.usage?.source, "provider");
  } finally {
    await fake.close();
  }
});

test("ollamaChatStream: HTTP de erro devolve code!=0 sem lançar", async () => {
  const fake = await startFakeOllama([], { statusCode: 500 });
  try {
    const result = await ollamaChatStream(fake.url, { model: "x", messages: [] }, 5000, () => {});
    assert.notEqual(result.code, 0);
    assert.equal(result.timedOut, false);
  } finally {
    await fake.close();
  }
});

test("ollamaChatStream: timeout devolve timedOut=true", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    // nunca escreve nada nem fecha — força o timeout.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const result = await ollamaChatStream(`http://127.0.0.1:${port}`, { model: "x", messages: [] }, 50, () => {});
    assert.equal(result.timedOut, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/daemon && npm run build`
Expected: FAIL — `ollamaChatStream` is not exported yet.

- [ ] **Step 3: Implement `ollamaChatStream`**

Add this function in `packages/daemon/src/routes/chat.ts`, immediately after the existing `ollamaChat` function (same file, same neighborhood — they share the `ExecUsage` type already defined above `ollamaChat`):

```typescript
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
      resolvePromise(result);
    };

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/daemon
npm run build
npm test
```

Expected: all green, including the 3 new `ollama-chat-stream.test.ts` tests.

- [ ] **Step 5: Commit**

```bash
cd packages/daemon
git add src/routes/chat.ts src/test/ollama-chat-stream.test.ts
git commit -m "feat(daemon): ollamaChatStream — real token-by-token Ollama streaming"
```

---

## Task 5: The `/stream` route

**Files:**
- Create: `packages/daemon/src/routes/stream.ts`
- Modify: `packages/daemon/src/server.ts`
- Create: `packages/daemon/src/test/stream-routes.test.ts`

**Interfaces:**
- Consumes: `StreamEvent`/`startSSE`/`writeSSEEvent`/`startHeartbeat` (Task 1), `preparePromptContext` with `createStepSink` (Task 2), `recordSessionMessage(...,threadId)` returning a message id (Task 3), `ollamaChatStream` (Task 4), and already-shipped `@assistente-os/core` exports: `getThread`, `touchThread`, `getSoul`, `loadConfig`, `getPool`, `sanitizeLLMResponse`, `recordCostCall`, `recordExecution`, `recordRouterSelection`, `estimateTokens`, `nextZenApiKey`, `resolveTarget`. Also `routeFromPrompt`/`makeLocalFallbackProbe` (daemon-local, same imports `chat.ts` already has), and `run` (the opencode executor, from `RequestContext`).
- Produces: `handleStream: RouteHandler`, registered in `server.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/daemon/src/test/stream-routes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-stream-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-stream-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return { accountId: body.account.id, token: body.token };
}

async function createThreadViaApi(base: string, soulId: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`${base}/souls/${soulId}/threads`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ title: "teste" }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.id;
}

/** Lê um response SSE inteiro e devolve os StreamEvents parseados, na ordem. */
async function readAllSSEEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) {
        events.push(JSON.parse(chunk.slice("data: ".length)));
      }
      // linhas ": ping" (heartbeat) são ignoradas de propósito — não são "data:"
    }
  }
  return events;
}

test("stream: soul inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/nao-existe/threads/1/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), false);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: thread inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream1@exemplo.com");
    createSoul(home, "soul-stream1", { name: "soul-stream1", ownerAccountId: alice.accountId });
    const res = await fetch(`${base}/souls/soul-stream1/threads/999999/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: sem prompt devolve 400 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream2@exemplo.com");
    createSoul(home, "soul-stream2", { name: "soul-stream2", ownerAccountId: alice.accountId });
    const headers = { authorization: `Bearer ${alice.token}` };
    const threadId = await createThreadViaApi(base, "soul-stream2", headers);
    const res = await fetch(`${base}/souls/soul-stream2/threads/${threadId}/messages/stream`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: emite step/token/done pra um provider ollama indisponível, e a mensagem fica gravada por thread_id", async () => {
  const { home, cleanup } = await tempHome();
  // Sem Ollama real disponível neste ambiente de teste: o roteador cai pro
  // fallback local configurado; se resultar em falha de execução (código != 0),
  // o stream ainda deve completar corretamente com um evento `done` (ok:false
  // implícito, sem token de conteúdo real) — não travar, não 500. O objetivo
  // deste teste é a MECÂNICA do protocolo (step→...→done, thread_id gravado),
  // não a qualidade de uma resposta real de LLM.
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream3@exemplo.com");
    createSoul(home, "soul-stream3", { name: "soul-stream3", ownerAccountId: alice.accountId });
    const headers = { authorization: `Bearer ${alice.token}` };
    const threadId = await createThreadViaApi(base, "soul-stream3", headers);

    const res = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages/stream`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "diga oi" }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

    const events = await readAllSSEEvents(res);
    assert.ok(events.length > 0, "esperava pelo menos um evento");
    assert.ok(events.some((e) => e.type === "step"), "esperava ao menos um evento de step (preparação)");
    const doneEvent = events.find((e) => e.type === "done");
    assert.ok(doneEvent, "esperava um evento done ao final");

    // GET .../threads/:id/messages agora deve refletir o turno gravado com thread_id —
    // prova de que Task 3's threadId-write funciona ponta a ponta pelo endpoint real.
    const messagesRes = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages`, { headers });
    const messages = await messagesRes.json();
    assert.ok(Array.isArray(messages) && messages.length >= 1, "esperava ao menos a mensagem do usuário gravada");
    assert.ok(messages.some((m: { role: string; content: string }) => m.role === "user" && m.content === "diga oi"));
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: threads diferentes do mesmo cliente não compartilham histórico (sessão por thread)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream4@exemplo.com");
    createSoul(home, "soul-stream4", { name: "soul-stream4", ownerAccountId: alice.accountId });
    const headers = { authorization: `Bearer ${alice.token}` };
    const threadA = await createThreadViaApi(base, "soul-stream4", headers);
    const threadB = await createThreadViaApi(base, "soul-stream4", headers);

    await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages/stream`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "mensagem só da thread A" }),
    }).then((r) => readAllSSEEvents(r));

    const messagesA = await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages`, { headers }).then((r) => r.json());
    const messagesB = await fetch(`${base}/souls/soul-stream4/threads/${threadB}/messages`, { headers }).then((r) => r.json());

    assert.ok(messagesA.length >= 1);
    assert.equal(messagesB.length, 0, "thread B não deve ver a mensagem gravada só na thread A");
  } finally {
    await daemon.close();
    await cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/daemon
npm run build
npm test
```

Expected: FAIL — the route doesn't exist, everything 404s from the generic fallback.

- [ ] **Step 3: Implement `handleStream`**

```typescript
// packages/daemon/src/routes/stream.ts
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

  const prepared = await preparePromptContext({
    req: { ...req, headers: { ...req.headers, "x-client-id": threadClientKey } } as IncomingMessage,
    pool,
    hub,
    home,
    config,
    soul,
    prompt,
    createStepSink: () => (module, message, level) => {
      writeSSEEvent(res, { type: "step", step: module, message, ...(level ? {} : {}) });
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
```

Note: `req: { ...req, headers: {...} } as IncomingMessage` in the `preparePromptContext` call above is how the thread-scoped `clientKey` gets derived — `preparePromptContext`'s internal `clientKey` derivation reads `req.headers["x-client-id"]` first, before falling back to the auth-header hash. Overriding that header on a shallow-cloned request object (not mutating the real `req`) forces the thread-scoped key without needing any change to `preparePromptContext`'s own clientKey logic. If this shallow-clone approach causes any TypeScript friction (spreading `IncomingMessage`, a class instance, doesn't preserve prototype methods), use this equivalent instead, which is more verbose but avoids spreading a class instance:

```typescript
  const reqWithThreadClientKey = Object.create(req, { headers: { value: { ...req.headers, "x-client-id": threadClientKey } } }) as IncomingMessage;
```

Use whichever compiles cleanly; functionally both achieve the same thing — `preparePromptContext` sees a request whose `x-client-id` header is the thread-scoped key, without `handleStream` needing to know or duplicate `preparePromptContext`'s internal `clientKey` derivation logic.

- [ ] **Step 4: Register the route**

In `packages/daemon/src/server.ts`, add the import near the other route imports (after `handleThreads`):

```typescript
import { handleStream } from "./routes/stream.js";
```

Add `handleStream` to `ROUTE_HANDLERS`, right after `handleThreads`:

```typescript
const ROUTE_HANDLERS: RouteHandler[] = [
  handleSouls,
  handleFamilias,
  handleChat,
  handleEvents,
  handleWhatsapp,
  handleTelegram,
  handleMonitors,
  handleAgenda,
  handleInfra,
  handleMemory,
  handleThreads,
  handleStream,
  handleVoice,
  ...
```

(Read the actual current file to place this correctly if the array's contents have shifted since this plan was written — insert right after `handleThreads`.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/daemon
npm run build
npm run typecheck
npm test
```

Expected: all green, including the 5 new `stream-routes.test.ts` tests, and every pre-existing test in the package.

- [ ] **Step 6: Commit**

```bash
cd packages/daemon
git add src/routes/stream.ts src/server.ts src/test/stream-routes.test.ts
git commit -m "feat(daemon): POST /souls/:id/threads/:threadId/messages/stream — Ollama real streaming, functional fallback for other tiers"
```

---

## Self-Review Notes

- **Spec coverage:** implements the streaming endpoint's wire protocol and the `ollama` tier fully; `zen`/`soul`/`langgraph` get a working-but-non-progressive fallback, explicitly named as deferred (Global Constraints), not silently missing. Heartbeat matches the spec's already-resolved decision (SSE comment, own connection, never the hub). Confidence/escalation exclusion matches `preparePromptContext`'s own established boundary.
- **Thread isolation solved without schema change:** the `thread-${threadId}` clientKey trick reuses `openSession`'s existing `(soul, client_key)` uniqueness — verified this is genuinely how the existing function behaves (read `sessions.ts` before writing this plan, not assumed) rather than adding a new `threadId` parameter to session functions.
- **`GET /threads/:id/messages` (already shipped, `main`) starts working as a side effect of Task 3** — its lack of any producer was explicitly called out in the prior plan's final review; this plan is that producer, not a coincidence.
- **Type consistency:** `StreamEvent`, `preparePromptContext`'s new `createStepSink` param, `recordSessionMessage`'s new signature, and `ollamaChatStream`'s return shape are used identically across every task that touches them — checked cross-task, not just within each task's own code block.
- **No placeholders:** every step ships literal code, not descriptions. Where a plan-time uncertainty existed (the `req` header-override approach for thread-scoped `clientKey` in Task 5), two concrete alternative implementations are given rather than a vague instruction to "figure it out."
- **Cross-task dependencies:** Task 5 depends on all of Tasks 1–4. Tasks 1–4 are independent of each other and could be reordered, though the plan sequences them 1→4 for increasing complexity, matching today's established pattern.
