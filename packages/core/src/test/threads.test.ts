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
    // não o fluxo de criação de sessão em si. `sessions.started_at` é
    // NOT NULL sem default (ver CREATE TABLE original em migrations.ts) —
    // por isso vai explícito aqui, além de soul/client_key.
    const { rows: sessionRows } = await testDb.pool.query(
      "INSERT INTO sessions (soul, client_key, started_at) VALUES ($1, $2, now()) RETURNING id",
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
