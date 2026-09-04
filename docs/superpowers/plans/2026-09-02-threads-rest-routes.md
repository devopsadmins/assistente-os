# Threads REST Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the REST CRUD surface for threads — `GET/POST /souls/:id/threads`, `PATCH/DELETE /souls/:id/threads/:threadId`, `GET /souls/:id/threads/:threadId/messages` — wired into the daemon, on top of the `threads` data model already in `main` (`packages/core/src/threads.ts`). This is the second backend slice of sub-project B; the streaming endpoint (`POST .../messages/stream`) and `preparePromptContext` extraction are explicitly out of scope — much bigger (spec's own effort estimate: L), and this CRUD surface doesn't need either.

**Architecture:** Task 1 extends `threads.ts`'s account-scoped functions to also accept `accountId === undefined` as "no filter" (distinct from `null`, which stays "operator-only bucket") — this is what lets the admin token see and manage every thread across every account, per project decision, while account-token requests keep their existing scoped behavior unchanged. Task 2 is a new `packages/daemon/src/routes/threads.ts` following this codebase's established `RouteHandler` pattern (`memory.ts`/`souls.ts` are the templates), registered in `server.ts`'s `ROUTE_HANDLERS`. Per-soul ownership is **already enforced centrally** in `server.ts` (the "Guarda de posse CENTRALIZADA" comment block) for every `/souls/:id/*` path — these new routes do not need, and must not add, a redundant per-route soul-ownership check (that pattern is legacy from before the central guard existed).

**Tech Stack:** TypeScript, `pg`, existing daemon routing (`node:http`, no framework). Tests: `packages/core` additions use `node:test` + `pgTestHelper.ts`'s `createTestSchema` (unit-level, direct function calls). `packages/daemon` additions use `node:test` + `startDaemon()` + real `fetch()` against a real running daemon instance + `pgTestHelper.ts`'s `tempDaemonHome` (full HTTP-level integration tests) — this is the established pattern in `packages/daemon/src/test/account-isolation.test.ts`, not a new one invented for this plan.

**Spec:** `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md` §3 (endpoint table) for the target routes; §2 for `threads.ts`'s existing shape. **Deviates from spec §3 in scope only** — the spec's endpoint table also lists `POST .../messages/stream`, which this plan does not implement (see Goal).

## Global Constraints

- **Project decision (already made, not open for re-litigation in this plan):** the admin token (`ASSISTENTE_OS_DAEMON_TOKEN`) sees and can manage threads across **every** account for a soul, matching the established precedent elsewhere in this codebase (`souls.ts:34`, `chat.ts:217-219`, `memory.ts` — admin never loses access to anything). `getRequestAccountId(req)` returns `number | undefined`; `undefined` means admin (or an unauthenticated route, not relevant here since these routes always require auth via the existing central gate).
- **Do not add a per-route soul-ownership check.** `server.ts`'s central guard (search for "Guarda de posse CENTRALIZADA") already 403s any account-token request to a `/souls/:id/*` path for a soul it doesn't own, before any route handler runs. By the time a threads route handler executes, the caller is *either* the admin token *or* an account request already confirmed to own this soul.
- **`accountId === undefined` vs `accountId === null` are different things, and mixing them up is the main way to get this plan wrong:**
  - `undefined` (admin token) → **no account filter at all** on reads/updates/deletes — every thread on the soul, regardless of who created it.
  - `null` → the existing "operator-only bucket" from the prior slice — threads created with no customer account attached.
  - **On CREATE specifically**, a new row needs a concrete `account_id` value to store — never `undefined`. When the caller is admin, the row is created with `account_id = null` (an admin-created thread), exactly like before this plan. Convert with `getRequestAccountId(req) ?? null` **only** at the create call site — every other call site (list/get/rename/delete) passes `getRequestAccountId(req)` through unchanged, preserving `undefined` where it occurs.
- Thread IDs in URL path segments are validated as positive integers before use (`/threads/abc` or `/threads/-1` → 400, not a Postgres type error surfacing as a 500).
- No new npm dependencies.
- Run `npm run build && npm run typecheck && npm test` in **both** `packages/core` and `packages/daemon` before every commit that touches either package (they're independently built/tested).

---

## File Structure

- `packages/core/src/threads.ts` — extend `listThreads`/`getThread`/`renameThread`/`deleteThread` to accept `accountId: number | null | undefined`; add `getThreadMessages`.
- `packages/core/src/test/threads.test.ts` — add tests for the `undefined` (unrestricted) branch.
- `packages/daemon/src/routes/threads.ts` — new: `handleThreads` (`RouteHandler`), the 5 endpoints.
- `packages/daemon/src/server.ts` — import + register `handleThreads` in `ROUTE_HANDLERS`.
- `packages/daemon/src/test/threads-routes.test.ts` — new: HTTP-level tests via `startDaemon`.

---

## Task 1: Extend `threads.ts` for admin-unrestricted access + thread messages

**Files:**
- Modify: `packages/core/src/threads.ts`
- Modify: `packages/core/src/test/threads.test.ts`

**Interfaces:**
- Produces: updated signatures `listThreads(pool, soul, accountId: number | null | undefined): Promise<Thread[]>`, `getThread(pool, threadId, accountId: number | null | undefined): Promise<Thread | null>`, `renameThread(pool, threadId, accountId: number | null | undefined, title): Promise<Thread | null>`, `deleteThread(pool, threadId, accountId: number | null | undefined): Promise<boolean>` (all backward-compatible — existing callers passing `number | null` are unaffected). New: `export interface ThreadMessage { role: "user" | "assistant"; content: string; ts: string }` and `getThreadMessages(pool, threadId): Promise<ThreadMessage[]>`. Consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/test/threads.test.ts` (keep every existing test — these are additions):

```typescript
test("listThreads: accountId undefined (admin) vê threads de todas as contas e do operador", async () => {
  const testDb = await createTestSchema();
  try {
    const accountA = await createAccount(testDb.pool, "admin1@exemplo.com", "senha-forte-123");
    const accountB = await createAccount(testDb.pool, "admin2@exemplo.com", "senha-forte-123");
    const threadA = await createThread(testDb.pool, "fiscal", accountA.id, "da conta A");
    const threadB = await createThread(testDb.pool, "fiscal", accountB.id, "da conta B");
    const threadOp = await createThread(testDb.pool, "fiscal", null, "do operador");

    const asAdmin = await listThreads(testDb.pool, "fiscal", undefined);
    assert.deepEqual(
      asAdmin.map((t) => t.id).sort((a, b) => a - b),
      [threadA.id, threadB.id, threadOp.id].sort((a, b) => a - b),
    );

    // Contas continuam vendo só as próprias — sem regressão.
    assert.equal((await listThreads(testDb.pool, "fiscal", accountA.id)).length, 1);
  } finally {
    await testDb.cleanup();
  }
});

test("getThread/renameThread/deleteThread: accountId undefined (admin) alcança qualquer thread", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "admin3@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id, "da conta");

    const found = await getThread(testDb.pool, thread.id, undefined);
    assert.equal(found?.id, thread.id);

    const renamed = await renameThread(testDb.pool, thread.id, undefined, "renomeada pelo admin");
    assert.equal(renamed?.title, "renomeada pelo admin");

    assert.equal(await deleteThread(testDb.pool, thread.id, undefined), true);
    assert.equal(await getThread(testDb.pool, thread.id, undefined), null);
  } finally {
    await testDb.cleanup();
  }
});

test("getThreadMessages: devolve as mensagens da thread em ordem cronológica", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "msgs@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);

    const { rows: sessionRows } = await testDb.pool.query(
      "INSERT INTO sessions (soul, client_key, started_at) VALUES ($1, $2, now()) RETURNING id",
      ["fiscal", "test-client"],
    );
    const sessionId = sessionRows[0].id;
    await testDb.pool.query(
      "INSERT INTO session_messages (session_id, soul, role, content, thread_id) VALUES ($1, $2, $3, $4, $5)",
      [sessionId, "fiscal", "user", "primeira pergunta", thread.id],
    );
    await testDb.pool.query(
      "INSERT INTO session_messages (session_id, soul, role, content, thread_id) VALUES ($1, $2, $3, $4, $5)",
      [sessionId, "fiscal", "assistant", "primeira resposta", thread.id],
    );

    const messages = await getThreadMessages(testDb.pool, thread.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, "user");
    assert.equal(messages[0]!.content, "primeira pergunta");
    assert.equal(messages[1]!.role, "assistant");
    assert.ok(messages[0]!.ts);
  } finally {
    await testDb.cleanup();
  }
});

test("getThreadMessages: thread sem mensagens devolve array vazio", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "nomsgs@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);
    assert.deepEqual(await getThreadMessages(testDb.pool, thread.id), []);
  } finally {
    await testDb.cleanup();
  }
});
```

Add `getThreadMessages` to the file's existing `import { ... } from "../threads.js"` line.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/core
npm run build
npm test
```

Expected: build fails (`getThreadMessages` not exported yet) or, if build somehow succeeds, the new tests fail at runtime.

- [ ] **Step 3: Implement the changes**

Replace `listThreads`, `getThread`, `renameThread`, `deleteThread` in `packages/core/src/threads.ts` with:

```typescript
/** Mais recente primeiro (por last_message_at). accountId undefined = sem filtro (token admin, vê tudo). */
export async function listThreads(pool: Pool, soul: string, accountId: number | null | undefined): Promise<Thread[]> {
  if (accountId === undefined) {
    const { rows } = await pool.query(
      "SELECT * FROM threads WHERE soul = $1 ORDER BY last_message_at DESC, id DESC",
      [soul],
    );
    return rows.map(rowToThread);
  }
  const { rows } =
    accountId === null
      ? await pool.query(
          "SELECT * FROM threads WHERE soul = $1 AND account_id IS NULL ORDER BY last_message_at DESC, id DESC",
          [soul],
        )
      : await pool.query(
          "SELECT * FROM threads WHERE soul = $1 AND account_id = $2 ORDER BY last_message_at DESC, id DESC",
          [soul, accountId],
        );
  return rows.map(rowToThread);
}

/** null = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function getThread(pool: Pool, threadId: number, accountId: number | null | undefined): Promise<Thread | null> {
  const { rows } =
    accountId === undefined
      ? await pool.query("SELECT * FROM threads WHERE id = $1", [threadId])
      : await pool.query("SELECT * FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2", [threadId, accountId]);
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** null = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function renameThread(
  pool: Pool,
  threadId: number,
  accountId: number | null | undefined,
  title: string,
): Promise<Thread | null> {
  const cappedTitle = title.slice(0, 200);
  const { rows } =
    accountId === undefined
      ? await pool.query("UPDATE threads SET title = $1 WHERE id = $2 RETURNING *", [cappedTitle, threadId])
      : await pool.query(
          "UPDATE threads SET title = $1 WHERE id = $2 AND account_id IS NOT DISTINCT FROM $3 RETURNING *",
          [cappedTitle, threadId, accountId],
        );
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** false = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function deleteThread(pool: Pool, threadId: number, accountId: number | null | undefined): Promise<boolean> {
  const { rowCount } =
    accountId === undefined
      ? await pool.query("DELETE FROM threads WHERE id = $1", [threadId])
      : await pool.query("DELETE FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2", [threadId, accountId]);
  return (rowCount ?? 0) > 0;
}
```

Add, near `getThreadMessages`'s natural home (after `deleteThread`, before `touchThread`):

```typescript
export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

/** Não checa posse — quem chama já confirmou via getThread antes (mesmo padrão de touchThread). */
export async function getThreadMessages(pool: Pool, threadId: number): Promise<ThreadMessage[]> {
  const { rows } = await pool.query<{ role: string; content: string; ts: unknown }>(
    "SELECT role, content, ts FROM session_messages WHERE thread_id = $1 ORDER BY id ASC",
    [threadId],
  );
  return rows.map((r) => ({ role: r.role as ThreadMessage["role"], content: r.content, ts: String(r.ts) }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/core
npm run build
npm test
```

Expected: all green — the 4 new tests plus every pre-existing test in the package (should be around 315 total; don't be alarmed if the exact count differs slightly from other work landing on `main` in the meantime, just confirm 0 failures).

- [ ] **Step 5: Run typecheck**

```bash
cd packages/core
npm run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/threads.ts src/test/threads.test.ts
git commit -m "feat(core): threads — admin-unrestricted access (accountId undefined) + getThreadMessages"
```

---

## Task 2: REST routes

**Files:**
- Create: `packages/daemon/src/routes/threads.ts`
- Modify: `packages/daemon/src/server.ts` (import + register)
- Create: `packages/daemon/src/test/threads-routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `listThreads`/`createThread`/`getThread`/`renameThread`/`deleteThread`/`getThreadMessages`/`Thread`/`ThreadMessage` from `@assistente-os/core` (all exported from the package barrel already — confirmed in the prior slice). `getRequestAccountId` from `./accountAuth.js`, `sendJson`/`readJson`/`RequestContext`/`RouteHandler` from `./shared.js`, `getSoul` from `@assistente-os/core` (for the 404-if-soul-doesn't-exist check — every existing route does this; soul *ownership* is the central guard's job, soul *existence* is still this route's job, same as `memory.ts`/`chat.ts`).
- Produces: `handleThreads: RouteHandler`, registered in `server.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/daemon/src/test/threads-routes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-threads-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-threads-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const r = await fetchJson(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { accountId: r.body.account.id, token: r.body.token };
}

test("threads REST: CRUD completo por uma conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-threads@exemplo.com");
    createSoul(home, "soul-alice", { name: "soul-alice", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "minha primeira conversa" }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.title, "minha primeira conversa");
    const threadId = created.body.id;

    const listed = await fetchJson(`${base}/souls/soul-alice/threads`, { headers: aliceHeaders });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, threadId);

    const renamed = await fetchJson(`${base}/souls/soul-alice/threads/${threadId}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "renomeada" }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.title, "renomeada");

    const messages = await fetchJson(`${base}/souls/soul-alice/threads/${threadId}/messages`, { headers: aliceHeaders });
    assert.equal(messages.status, 200);
    assert.deepEqual(messages.body, []);

    const deleted = await fetch(`${base}/souls/soul-alice/threads/${threadId}`, {
      method: "DELETE",
      headers: aliceHeaders,
    });
    assert.equal(deleted.status, 204);

    const listedAfter = await fetchJson(`${base}/souls/soul-alice/threads`, { headers: aliceHeaders });
    assert.equal(listedAfter.body.length, 0);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: conta B não alcança thread da conta A (404, não 403 — não confirma existência)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-iso@exemplo.com");
    const bob = await signup(base, "bob-iso@exemplo.com");
    createSoul(home, "soul-alice2", { name: "soul-alice2", ownerAccountId: alice.accountId });
    createSoul(home, "soul-bob2", { name: "soul-bob2", ownerAccountId: bob.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const bobHeaders = { authorization: `Bearer ${bob.token}`, "content-type": "application/json" };

    // Bob tentando acessar a soul da Alice já é barrado pelo guard central (403) —
    // não dá pra nem chegar perto de uma thread da Alice por essa rota.
    const crossSoul = await fetchJson(`${base}/souls/soul-alice2/threads`, { headers: bobHeaders });
    assert.equal(crossSoul.status, 403);

    // Bob dentro da PRÓPRIA soul, mas tentando um threadId inventado: 404.
    const fakeThread = await fetchJson(`${base}/souls/soul-bob2/threads/999999`, { headers: bobHeaders });
    assert.equal(fakeThread.status, 404);

    void aliceHeaders; // Alice headers reservado — cenário de mesma-soul-duas-contas não existe neste modelo (1 soul = 1 conta dona), documentado no plano.
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: token admin vê e gerencia threads de qualquer conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-admin@exemplo.com");
    createSoul(home, "soul-alice3", { name: "soul-alice3", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice3/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "da alice" }),
    });
    const threadId = created.body.id;

    const asAdmin = await fetchJson(`${base}/souls/soul-alice3/threads`, { headers: adminHeaders });
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.length, 1);
    assert.equal(asAdmin.body[0].id, threadId);

    const renamedByAdmin = await fetchJson(`${base}/souls/soul-alice3/threads/${threadId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ title: "renomeada pelo admin" }),
    });
    assert.equal(renamedByAdmin.status, 200);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: POST sem title usa string vazia; PATCH sem title devolve 400", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-validate@exemplo.com");
    createSoul(home, "soul-alice4", { name: "soul-alice4", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice4/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, "");

    const badPatch = await fetchJson(`${base}/souls/soul-alice4/threads/${created.body.id}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(badPatch.status, 400);

    const badId = await fetchJson(`${base}/souls/soul-alice4/threads/not-a-number`, { headers: aliceHeaders });
    assert.equal(badId.status, 404); // não bate a regex de rota com id numérico → cai em 404 genérico, não 500
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: soul inexistente devolve 404", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const r = await fetchJson(`${base}/souls/nao-existe/threads`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(r.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/daemon
npm run build
npm test
```

Expected: FAIL — `handleThreads`/route paths don't exist yet, 404s where 200/201/etc. are expected.

- [ ] **Step 3: Implement the route handler**

```typescript
// packages/daemon/src/routes/threads.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { getPool, loadConfig, getSoul, createThread, listThreads, getThread, renameThread, deleteThread, getThreadMessages } from "@assistente-os/core";
import { sendJson, readJson, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

/**
 * CRUD de threads (conversas nomeadas) por soul:
 *   GET/POST /souls/:id/threads
 *   PATCH/DELETE /souls/:id/threads/:threadId
 *   GET /souls/:id/threads/:threadId/messages
 *
 * Posse de SOUL já é garantida pelo guard central em server.ts antes de
 * qualquer rota rodar — aqui só confirmamos que a soul existe (mesmo padrão
 * de memory.ts/chat.ts) e delegamos posse de THREAD pro próprio módulo
 * threads.ts (accountId undefined = token admin, sem filtro).
 */
export async function handleThreads(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  const listOrCreateMatch = path.match(/^\/souls\/([^/]+)\/threads$/);
  if (listOrCreateMatch && (req.method === "GET" || req.method === "POST")) {
    const soul = getSoul(home, decodeURIComponent(listOrCreateMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    if (req.method === "GET") {
      const threads = await listThreads(pool, soul.id, requestAccountId);
      sendJson(res, 200, threads);
      return true;
    }

    // POST — criação sempre precisa de um account_id concreto pra gravar,
    // nunca "undefined": token admin cria como thread de operador (null).
    const parsed = await readJson(req);
    if (parsed.error === "too_large") {
      sendJson(res, 413, { error: "body excede 1 MB" });
      return true;
    }
    if (parsed.error === "invalid") {
      sendJson(res, 400, { error: "JSON inválido" });
      return true;
    }
    const title = parsed.body && typeof parsed.body.title === "string" ? parsed.body.title : undefined;
    const thread = await createThread(pool, soul.id, requestAccountId ?? null, title);
    sendJson(res, 201, thread);
    return true;
  }

  const threadMatch = path.match(/^\/souls\/([^/]+)\/threads\/(\d+)$/);
  if (threadMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const soul = getSoul(home, decodeURIComponent(threadMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const threadId = Number(threadMatch[2]);
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    if (req.method === "PATCH") {
      const parsed = await readJson(req);
      if (parsed.error === "too_large") {
        sendJson(res, 413, { error: "body excede 1 MB" });
        return true;
      }
      if (parsed.error === "invalid") {
        sendJson(res, 400, { error: "JSON inválido" });
        return true;
      }
      const title = parsed.body && typeof parsed.body.title === "string" ? parsed.body.title : undefined;
      if (title === undefined) {
        sendJson(res, 400, { error: "title é obrigatório" });
        return true;
      }
      const renamed = await renameThread(pool, threadId, requestAccountId, title);
      if (!renamed) {
        sendJson(res, 404, { error: "thread não encontrada" });
        return true;
      }
      sendJson(res, 200, renamed);
      return true;
    }

    // DELETE
    const deleted = await deleteThread(pool, threadId, requestAccountId);
    if (!deleted) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  const messagesMatch = path.match(/^\/souls\/([^/]+)\/threads\/(\d+)\/messages$/);
  if (messagesMatch && req.method === "GET") {
    const soul = getSoul(home, decodeURIComponent(messagesMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const threadId = Number(messagesMatch[2]);
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    const thread = await getThread(pool, threadId, requestAccountId);
    if (!thread) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    const messages = await getThreadMessages(pool, threadId);
    sendJson(res, 200, messages);
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Register the route**

In `packages/daemon/src/server.ts`, find the `handleMemory` import (near the other route imports around line 28) and add, right after it:

```typescript
import { handleThreads } from "./routes/threads.js";
```

Find the `ROUTE_HANDLERS` array (the ordered list starting with `handleSouls, handleFamilias, handleChat, ...`) and add `handleThreads` right after `handleMemory`:

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
  handleVoice,
  handlePipelines,
  handleLlmsTxt,
  handleCapabilities,
  handleWorktree,
  // ... (rest of the array unchanged — only the "handleThreads," line is new)
```

(Read the actual current file to place this correctly if the array's exact contents have shifted since this plan was written — the insertion point is "right after `handleMemory`," not a specific line number.)

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/daemon
npm run build
npm test
```

Expected: PASS — the 6 new tests in `threads-routes.test.ts`, plus every pre-existing daemon test still green (in particular, re-confirm `account-isolation.test.ts` still passes unchanged — this plan doesn't touch anything it depends on, but it's the closest analog and worth a specific look if anything is red).

- [ ] **Step 6: Run typecheck**

```bash
cd packages/daemon
npm run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/routes/threads.ts src/server.ts src/test/threads-routes.test.ts
git commit -m "feat(daemon): REST routes for threads — CRUD + messages, admin-unrestricted"
```

---

## Self-Review Notes

- **Spec coverage:** implements spec §3's endpoint table in full except `POST .../messages/stream` (explicitly out of scope — Goal section names this and why). Every listed endpoint (`GET/POST /threads`, `PATCH/DELETE /threads/:id`, `GET /threads/:id/messages`) has a route and a test.
- **The admin-unrestricted decision is the load-bearing design choice of this whole plan** — Task 1's Global Constraints section spells out the `undefined`-vs-`null` distinction with the one place it's easy to get backwards (CREATE). Task 2's route code follows it exactly: `requestAccountId` (raw, possibly `undefined`) for every read/update/delete call; `requestAccountId ?? null` only at the `createThread` call site.
- **No redundant soul-ownership check** — deliberately not repeating the `accountId != null && soul.config.ownerAccountId !== accountId` pattern from `chat.ts`/`memory.ts` (legacy, superseded by the central guard per `server.ts`'s own comment). Task 2's routes only check soul *existence* (404), matching what the central guard does NOT already cover.
- **Type consistency:** `Thread`/`ThreadMessage` shapes and all six function signatures (four extended, two new) match verbatim between Task 1's Interfaces block and its Step 3 implementation, and match what Task 2's route code actually calls.
- **No placeholders:** every step ships literal code, not descriptions.
- **Cross-task dependency:** Task 2 genuinely depends on Task 1 (imports its new/changed functions) — sequential, not independent. Task 1 has no dependency on Task 2.
