# Threads Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `threads` data model — migration + CRUD module + account-isolation tests in `packages/core` — as the first, component-independent backend slice of sub-project B (threads + streaming redesign). Nothing downstream (REST routes, streaming protocol, `packages/web`) exists yet; this plan produces a complete, independently-testable unit on its own: a real Postgres table plus a typed module other backend work can build on next.

**Architecture:** One new table (`threads`) with a nullable `account_id` FK (`NULL` = operator/admin thread, opened with the single admin token — not a customer account), one new nullable `thread_id` column on the existing `session_messages` table (so `/chat` without a thread keeps working unchanged), and a thin CRUD module (`packages/core/src/threads.ts`) following this repo's existing `accounts.ts` conventions exactly: `Pool`-parameterized functions, a `rowTo*` mapper, `AssistenteOsError` for the one real failure mode, and every account-scoped query filtering by `account_id` in the SQL itself (`IS NOT DISTINCT FROM`, which correctly matches `NULL = NULL` unlike plain `=`) rather than in application code after the fact — the same anti-frail-isolation posture the spec calls out explicitly.

**Tech Stack:** TypeScript, `pg` (`Pool`), the existing migration runner (`packages/core/src/db.ts`'s `runMigrations`), `node:test` + `node:assert/strict` against a real Postgres instance via `pgTestHelper.ts`'s per-test schema isolation (no mocking — this repo doesn't mock Postgres, per `pgTestHelper.ts`'s own comment).

**Spec:** `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md` §2 ("Modelo de dados: `threads`") describes the target shape. This plan's SQL and TypeScript **deviate from that spec's literal draft syntax** to match this codebase's real, already-established conventions — see Global Constraints below for the specific deviations and why they're not optional.

## Global Constraints

- **Primary keys use `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, not `BIGSERIAL`.** The spec's draft SQL uses `BIGSERIAL`; every existing table in `packages/core/src/migrations.ts` (`accounts`, `account_sessions`, `session_messages`, etc.) uses `GENERATED ALWAYS AS IDENTITY`. Match the real codebase, not the spec's draft — `BIGSERIAL` would be the one table in this schema that doesn't match.
- **Account isolation is enforced in SQL with `IS NOT DISTINCT FROM`, never a plain `=`.** `account_id` is `NULL` for operator/admin threads (opened with `ASSISTENTE_OS_DAEMON_TOKEN`, not a customer account) — `WHERE account_id = $2` silently returns zero rows whenever `$2` is `NULL` in Postgres (NULL is never `=` to anything, including itself), which would make every operator-owned thread invisible to itself. `IS NOT DISTINCT FROM` is NULL-safe equality and is what every account-scoped query in this module must use.
- Migration id is `0020_threads` — confirmed to be the next free id (`packages/core/src/migrations.ts` currently ends at `0019_friendly_allowlist`). If another migration lands first and takes `0020`, renumber to the next free id; do not silently reuse a taken one.
- Deletion is a hard delete (`DELETE ... WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2`), cascading to `session_messages` via the FK's `ON DELETE CASCADE` — threads are not retention-governed personal data like `familias` (LGPD-scoped elsewhere in this schema); no soft-delete, no retention window.
- Follow `accounts.ts`'s exact file conventions: a `rowTo*(row: Record<string, unknown>): T` mapper function, `Pool` imported as `import type { Pool } from "pg"`, timestamps via `nowIso()` from `./costs.js` only where the code constructs a timestamp value itself (most of this module lets Postgres's own `DEFAULT now()` do that — don't call `nowIso()` where the SQL already defaults it).
- Tests go in `packages/core/src/test/threads.test.ts`, using `node:test`/`node:assert/strict` and `createTestSchema()`/`testDb.cleanup()` from `./pgTestHelper.js` — the exact pattern in `packages/core/src/test/accounts.test.ts`. This requires a real, reachable Postgres (already confirmed running at `postgres://assistente_os:assistente_os@127.0.0.1:5432/assistente_os`, matching this repo's `.env` and `pgTestHelper.ts`'s fallback) — there is no mock path.
- `packages/core`'s test script runs **compiled output**, not source: `"test": "node --test \"dist/test/**/*.test.js\""`. Run `npm run build` (`tsc -b`) before `npm test` — a source-only edit followed by `npm test` will silently run the *previous* build's stale JS.
- No new npm dependencies — everything needed (`pg`, `node:crypto` if any hashing were needed, which it isn't here) is already a `packages/core` dependency.

---

## File Structure

- `packages/core/src/migrations.ts` — append migration `0020_threads` (new table + `session_messages.thread_id` column + two indexes).
- `packages/core/src/threads.ts` — new module: `Thread` interface + `createThread`/`listThreads`/`renameThread`/`deleteThread`/`touchThread`.
- `packages/core/src/test/threads.test.ts` — new test file: CRUD behavior + account-isolation + cascade-delete + the `NULL`-account (operator thread) case.

---

## Task 1: `threads` migration + CRUD module + tests

**Files:**
- Modify: `packages/core/src/migrations.ts` (append one migration entry)
- Create: `packages/core/src/threads.ts`
- Create: `packages/core/src/test/threads.test.ts`

**Interfaces:**
- Produces: `export interface Thread { id: number; soul: string; accountId: number | null; title: string; createdAt: string; lastMessageAt: string }` and the five functions listed above. Nothing in this plan consumes them — this is the first slice of a larger backend piece (REST routes) that isn't part of this plan.

- [ ] **Step 1: Add the migration**

Open `packages/core/src/migrations.ts` and find the array's last entry (currently `id: "0019_friendly_allowlist"`). Append a new entry immediately after it, before the closing `];`:

```typescript
  {
    // Sub-projeto B (threads + streaming) — primeira fatia de backend, sem
    // nenhuma dependência de componente de front-end. `account_id` NULL =
    // thread do operador (token admin ASSISTENTE_OS_DAEMON_TOKEN), não uma
    // conta de cliente — o padrão já usado por outras tabelas escopadas por
    // conta desde 0018_accounts. `thread_id` em session_messages é nullable
    // de propósito: o /chat sem thread (uso direto via API/integrações,
    // comportamento atual) continua funcionando sem thread nenhuma.
    id: "0020_threads",
    sql: `
      CREATE TABLE IF NOT EXISTS threads (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        soul TEXT NOT NULL,
        account_id BIGINT REFERENCES accounts (id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_threads_soul_account ON threads (soul, account_id, last_message_at DESC);

      ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES threads (id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_session_messages_thread ON session_messages (thread_id);
    `,
  },
```

- [ ] **Step 2: Write the failing tests**

```typescript
// packages/core/src/test/threads.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createThread, listThreads, renameThread, deleteThread, touchThread } from "../threads.js";
import { createAccount } from "../accounts.js";
import { createTestSchema } from "./pgTestHelper.js";

test("createThread + listThreads: fluxo feliz, título default vazio", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threads1@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);
    assert.equal(thread.soul, "fiscal");
    assert.equal(thread.accountId, account.id);
    assert.equal(thread.title, "");
    assert.ok(thread.id > 0);

    const listed = await listThreads(testDb.pool, "fiscal", account.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, thread.id);
  } finally {
    await testDb.cleanup();
  }
});

test("createThread: aceita título explícito", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threads2@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id, "Fechamento de julho");
    assert.equal(thread.title, "Fechamento de julho");
  } finally {
    await testDb.cleanup();
  }
});

test("createThread: accountId null cria thread de operador", async () => {
  const testDb = await createTestSchema();
  try {
    const thread = await createThread(testDb.pool, "fiscal", null);
    assert.equal(thread.accountId, null);

    const listed = await listThreads(testDb.pool, "fiscal", null);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, thread.id);
  } finally {
    await testDb.cleanup();
  }
});

test("listThreads: ordena por last_message_at desc", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threads3@exemplo.com", "senha-forte-123");
    const older = await createThread(testDb.pool, "fiscal", account.id, "mais antiga");
    const newer = await createThread(testDb.pool, "fiscal", account.id, "mais nova");
    await touchThread(testDb.pool, newer.id);

    const listed = await listThreads(testDb.pool, "fiscal", account.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.id, newer.id);
    assert.equal(listed[1]!.id, older.id);
  } finally {
    await testDb.cleanup();
  }
});

test("touchThread: atualiza last_message_at", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threads4@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);
    const before = thread.lastMessageAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    await touchThread(testDb.pool, thread.id);

    const [after] = await listThreads(testDb.pool, "fiscal", account.id);
    assert.ok(new Date(after!.lastMessageAt).getTime() > new Date(before).getTime());
  } finally {
    await testDb.cleanup();
  }
});

test("renameThread: renomeia quando o accountId bate", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threads5@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id, "original");
    const renamed = await renameThread(testDb.pool, thread.id, account.id, "novo título");
    assert.equal(renamed?.title, "novo título");
  } finally {
    await testDb.cleanup();
  }
});

test("renameThread: devolve null quando o accountId não bate (isolamento)", async () => {
  const testDb = await createTestSchema();
  try {
    const accountA = await createAccount(testDb.pool, "threadsA@exemplo.com", "senha-forte-123");
    const accountB = await createAccount(testDb.pool, "threadsB@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", accountA.id, "da conta A");

    const result = await renameThread(testDb.pool, thread.id, accountB.id, "tentativa de invasão");
    assert.equal(result, null);

    const stillOriginal = await listThreads(testDb.pool, "fiscal", accountA.id);
    assert.equal(stillOriginal[0]!.title, "da conta A");
  } finally {
    await testDb.cleanup();
  }
});

test("listThreads: thread da conta A não aparece pra conta B", async () => {
  const testDb = await createTestSchema();
  try {
    const accountA = await createAccount(testDb.pool, "threadsC@exemplo.com", "senha-forte-123");
    const accountB = await createAccount(testDb.pool, "threadsD@exemplo.com", "senha-forte-123");
    await createThread(testDb.pool, "fiscal", accountA.id, "privada da A");

    const listedByB = await listThreads(testDb.pool, "fiscal", accountB.id);
    assert.equal(listedByB.length, 0);
  } finally {
    await testDb.cleanup();
  }
});

test("deleteThread: apaga quando o accountId bate, devolve false quando não bate", async () => {
  const testDb = await createTestSchema();
  try {
    const accountA = await createAccount(testDb.pool, "threadsE@exemplo.com", "senha-forte-123");
    const accountB = await createAccount(testDb.pool, "threadsF@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", accountA.id);

    assert.equal(await deleteThread(testDb.pool, thread.id, accountB.id), false);
    assert.equal((await listThreads(testDb.pool, "fiscal", accountA.id)).length, 1);

    assert.equal(await deleteThread(testDb.pool, thread.id, accountA.id), true);
    assert.equal((await listThreads(testDb.pool, "fiscal", accountA.id)).length, 0);
  } finally {
    await testDb.cleanup();
  }
});

test("deleteThread: cascata apaga session_messages vinculadas", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "threadsG@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);

    // Insere uma sessão + mensagem vinculada à thread diretamente via SQL —
    // sessions.ts tem sua própria API, mas o que este teste precisa provar é
    // só o comportamento do FK ON DELETE CASCADE de session_messages.thread_id,
    // não o fluxo de criação de sessão em si.
    const { rows: sessionRows } = await testDb.pool.query(
      "INSERT INTO sessions (soul, client_key) VALUES ($1, $2) RETURNING id",
      ["fiscal", "test-client"],
    );
    const sessionId = sessionRows[0].id;
    await testDb.pool.query(
      "INSERT INTO session_messages (session_id, soul, role, content, thread_id) VALUES ($1, $2, $3, $4, $5)",
      [sessionId, "fiscal", "user", "oi", thread.id],
    );

    const before = await testDb.pool.query("SELECT count(*) FROM session_messages WHERE thread_id = $1", [thread.id]);
    assert.equal(Number(before.rows[0].count), 1);

    await deleteThread(testDb.pool, thread.id, account.id);

    const after = await testDb.pool.query("SELECT count(*) FROM session_messages WHERE thread_id = $1", [thread.id]);
    assert.equal(Number(after.rows[0].count), 0);
  } finally {
    await testDb.cleanup();
  }
});
```

Note: the cascade test inserts directly into `sessions` with `(soul, client_key)` — check `packages/core/src/migrations.ts`'s original `sessions` table definition (migration `0002` or wherever `sessions` was first created) for that table's exact non-nullable columns before running this; if `sessions` requires additional NOT NULL columns beyond `soul`/`client_key`, add them to the `INSERT` with reasonable literal values. Don't guess — read the actual `CREATE TABLE sessions` SQL in `migrations.ts` first.

- [ ] **Step 3: Build and run the tests to verify they fail**

```bash
cd packages/core
npm run build
npm test -- --test-name-pattern="threads"
```

Expected: FAIL — `threads.js` does not exist (`Cannot find module '../threads.js'`), or the migration doesn't exist yet so `createTestSchema()` fails.

- [ ] **Step 4: Implement `threads.ts`**

```typescript
// packages/core/src/threads.ts
import type { Pool } from "pg";

/**
 * Threads (conversas nomeadas) — sub-projeto B. `accountId: null` é thread
 * do operador (token admin), não uma conta de cliente — mesmo padrão de
 * `account_id` nullable já usado desde a Fase 0 do modo amigável.
 */

export interface Thread {
  id: number;
  soul: string;
  accountId: number | null;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

function rowToThread(row: Record<string, unknown>): Thread {
  return {
    id: Number(row.id),
    soul: String(row.soul),
    accountId: row.account_id === null ? null : Number(row.account_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    lastMessageAt: String(row.last_message_at),
  };
}

export async function createThread(
  pool: Pool,
  soul: string,
  accountId: number | null,
  title?: string,
): Promise<Thread> {
  const { rows } = await pool.query(
    "INSERT INTO threads (soul, account_id, title) VALUES ($1, $2, $3) RETURNING *",
    [soul, accountId, title ?? ""],
  );
  return rowToThread(rows[0]);
}

/** Mais recente primeiro (por last_message_at). */
export async function listThreads(pool: Pool, soul: string, accountId: number | null): Promise<Thread[]> {
  const { rows } = await pool.query(
    "SELECT * FROM threads WHERE soul = $1 AND account_id IS NOT DISTINCT FROM $2 ORDER BY last_message_at DESC",
    [soul, accountId],
  );
  return rows.map(rowToThread);
}

/** null = thread não existe ou não pertence a este accountId (as duas situações se parecem de propósito — não vaza qual é qual). */
export async function renameThread(
  pool: Pool,
  threadId: number,
  accountId: number | null,
  title: string,
): Promise<Thread | null> {
  const { rows } = await pool.query(
    "UPDATE threads SET title = $1 WHERE id = $2 AND account_id IS NOT DISTINCT FROM $3 RETURNING *",
    [title, threadId, accountId],
  );
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** false = thread não existe ou não pertence a este accountId. */
export async function deleteThread(pool: Pool, threadId: number, accountId: number | null): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2",
    [threadId, accountId],
  );
  return (rowCount ?? 0) > 0;
}

/** Não valida posse por accountId de propósito — chamado no caminho quente de gravar uma mensagem, onde a posse já foi checada antes (na rota). */
export async function touchThread(pool: Pool, threadId: number): Promise<void> {
  await pool.query("UPDATE threads SET last_message_at = now() WHERE id = $1", [threadId]);
}
```

- [ ] **Step 5: Build and run the tests to verify they pass**

```bash
cd packages/core
npm run build
npm test -- --test-name-pattern="threads"
```

Expected: PASS (10/10 — adjust the count if you added or split any test above based on `sessions`'s real schema).

- [ ] **Step 6: Run the full package test suite and typecheck**

```bash
cd packages/core
npm run typecheck
npm test
```

Expected: all green — confirm nothing in the rest of `packages/core`'s suite broke (in particular, any existing test that runs the full migration list end-to-end via `runMigrations`).

- [ ] **Step 7: Commit**

```bash
git add src/migrations.ts src/threads.ts src/test/threads.test.ts
git commit -m "feat(core): threads data model — migration, CRUD, account isolation"
```

(Run `git add` from `packages/core/`, or prefix each path with `packages/core/` if committing from the repo root — confirm your cwd with `git status --porcelain` before staging.)

---

## Self-Review Notes

- **Spec coverage:** implements spec B §2 in full (table, `session_messages.thread_id`, all five `threads.ts` functions with the exact signatures the spec specifies) — adjusted for this codebase's real SQL/testing conventions (documented as Global Constraints, not silent deviations). The rest of §2/§3/§4 (REST routes, streaming protocol, `packages/web`) is explicitly out of scope for this plan — this is the first of several slices spec B's own effort breakdown anticipates.
- **Type consistency:** `Thread`'s shape and all five function signatures match verbatim between this plan's Interfaces block and the Step 4 implementation — nothing invented mid-task.
- **No placeholders:** every step ships literal code, not descriptions.
- **Isolation coverage:** every account-scoped function (`listThreads`, `renameThread`, `deleteThread`) has a dedicated cross-account test proving thread A is invisible/unmodifiable/undeletable from account B's perspective — this is the property the spec calls out as the reason `account_id` is a real column with a real FK, not something derived from `soul.config.ownerAccountId` at request time.
