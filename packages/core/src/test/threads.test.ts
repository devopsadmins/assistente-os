// packages/core/src/test/threads.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createThread,
  listThreads,
  getThread,
  renameThread,
  deleteThread,
  touchThread,
  getThreadMessages,
} from "../threads.js";
import { createAccount } from "../accounts.js";
import { isAssistenteOsError } from "../errors.js";
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

test("getThread: devolve a thread quando o accountId bate, null quando não bate ou não existe", async () => {
  const testDb = await createTestSchema();
  try {
    const accountA = await createAccount(testDb.pool, "getthread1@exemplo.com", "senha-forte-123");
    const accountB = await createAccount(testDb.pool, "getthread2@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", accountA.id, "minha thread");

    const found = await getThread(testDb.pool, thread.id, accountA.id);
    assert.equal(found?.id, thread.id);

    assert.equal(await getThread(testDb.pool, thread.id, accountB.id), null);
    assert.equal(await getThread(testDb.pool, 999_999, accountA.id), null);
  } finally {
    await testDb.cleanup();
  }
});

test("listThreads: threads de operador (accountId null) e de conta não se misturam", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "opiso@exemplo.com", "senha-forte-123");
    const accountThread = await createThread(testDb.pool, "fiscal", account.id, "da conta");
    const operatorThread = await createThread(testDb.pool, "fiscal", null, "do operador");

    const listedForAccount = await listThreads(testDb.pool, "fiscal", account.id);
    assert.equal(listedForAccount.length, 1);
    assert.equal(listedForAccount[0]!.id, accountThread.id);

    const listedForOperator = await listThreads(testDb.pool, "fiscal", null);
    assert.equal(listedForOperator.length, 1);
    assert.equal(listedForOperator[0]!.id, operatorThread.id);
  } finally {
    await testDb.cleanup();
  }
});

test("renameThread/deleteThread: accountId null não consegue mexer numa thread de conta, e vice-versa", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "opiso2@exemplo.com", "senha-forte-123");
    const accountThread = await createThread(testDb.pool, "fiscal", account.id, "da conta");
    const operatorThread = await createThread(testDb.pool, "fiscal", null, "do operador");

    assert.equal(await renameThread(testDb.pool, accountThread.id, null, "invasão"), null);
    assert.equal(await renameThread(testDb.pool, operatorThread.id, account.id, "invasão"), null);

    assert.equal(await deleteThread(testDb.pool, accountThread.id, null), false);
    assert.equal(await deleteThread(testDb.pool, operatorThread.id, account.id), false);
  } finally {
    await testDb.cleanup();
  }
});

test("renameThread/deleteThread: id inexistente devolve null/false", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "naoexiste@exemplo.com", "senha-forte-123");
    assert.equal(await renameThread(testDb.pool, 999_999, account.id, "x"), null);
    assert.equal(await deleteThread(testDb.pool, 999_999, account.id), false);
  } finally {
    await testDb.cleanup();
  }
});

test("createThread: accountId inexistente rejeita com E_VALIDATION", async () => {
  const testDb = await createTestSchema();
  try {
    await assert.rejects(
      () => createThread(testDb.pool, "fiscal", 999_999),
      (err: unknown) => isAssistenteOsError(err) && err.code === "E_VALIDATION",
    );
  } finally {
    await testDb.cleanup();
  }
});

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
    assert.ok(Number.isInteger(messages[0]!.id) && messages[0]!.id > 0);
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

test("getThreadMessages: limit opcional lê só as últimas N linhas (R3 — sem LIMIT, /stream lia a thread inteira a cada turno)", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "limitmsgs@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id);
    const { rows: sessionRows } = await testDb.pool.query(
      "INSERT INTO sessions (soul, client_key, started_at) VALUES ($1, $2, now()) RETURNING id",
      ["fiscal", "test-client-limit"],
    );
    const sessionId = sessionRows[0].id;
    // 8 linhas, na ordem cronológica.
    for (let i = 0; i < 8; i++) {
      await testDb.pool.query(
        "INSERT INTO session_messages (session_id, soul, role, content, thread_id) VALUES ($1, $2, $3, $4, $5)",
        [sessionId, "fiscal", i % 2 === 0 ? "user" : "assistant", `linha-${i}`, thread.id],
      );
    }

    const all = await getThreadMessages(testDb.pool, thread.id);
    assert.equal(all.length, 8);

    const limited = await getThreadMessages(testDb.pool, thread.id, 4);
    assert.equal(limited.length, 4, "limit=4 deveria devolver só 4 linhas");
    // Mesmo conteúdo e mesma ORDEM cronológica que a cauda da lista sem limite —
    // a query usa ORDER BY id DESC LIMIT + reverse, tem que bater com a cauda
    // do resultado sem limite (o que /stream's trimHistoryToBudget também
    // faria em JS se lesse a thread inteira) — prova que o limite em SQL não
    // muda QUAIS mensagens entram no histórico pra uma thread sob o teto.
    assert.deepEqual(
      limited.map((m) => m.content),
      all.slice(-4).map((m) => m.content),
    );

    // Uma thread DENTRO do teto (limit >= total) devolve tudo, sem diferença.
    const underCap = await getThreadMessages(testDb.pool, thread.id, 100);
    assert.equal(underCap.length, 8);
    assert.deepEqual(
      underCap.map((m) => m.content),
      all.map((m) => m.content),
    );
  } finally {
    await testDb.cleanup();
  }
});

test("getThread/renameThread/deleteThread: soul informado rejeita thread de outra soul", async () => {
  const testDb = await createTestSchema();
  try {
    const account = await createAccount(testDb.pool, "soulcheck@exemplo.com", "senha-forte-123");
    const thread = await createThread(testDb.pool, "fiscal", account.id, "da soul fiscal");

    assert.equal(await getThread(testDb.pool, thread.id, account.id, "outra-soul"), null);
    const foundWithCorrectSoul = await getThread(testDb.pool, thread.id, account.id, "fiscal");
    assert.equal(foundWithCorrectSoul?.id, thread.id);
    assert.equal(await renameThread(testDb.pool, thread.id, account.id, "tentativa", "outra-soul"), null);
    assert.equal(await deleteThread(testDb.pool, thread.id, account.id, "outra-soul"), false);

    // Sem soul informado (chamadas antigas), continua funcionando como antes.
    const found = await getThread(testDb.pool, thread.id, account.id);
    assert.equal(found?.id, thread.id);
  } finally {
    await testDb.cleanup();
  }
});
