import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openSession,
  bumpSessionPrompt,
  recordSessionMessage,
  getRecentSessionMessages,
} from "../sessions.js";
import { createTestSchema } from "./pgTestHelper.js";

/** Roda `fn` com ASSISTENTE_OS_SESSION_IDLE_MINUTES setada, restaurando o valor original depois. */
async function withIdleTimeoutMinutes<T>(minutes: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES;
  process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES = minutes;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES;
    else process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES = prev;
  }
}

test("openSession: reaproveita a sessão aberta enquanto está ativa (dentro do timeout)", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 10);
    const s2 = await openSession(testDb.pool, "main", 10);
    assert.equal(s2.id, s1.id);
  } finally {
    await testDb.cleanup();
  }
});

test("openSession: sessão inativa há mais que o timeout é fechada e uma nova é aberta (corrige o lockout permanente)", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 3);
    await bumpSessionPrompt(testDb.pool, s1.id);
    await bumpSessionPrompt(testDb.pool, s1.id);
    await bumpSessionPrompt(testDb.pool, s1.id);
    // Sessão "esgotada" (prompt_count == maxTurns) — sem rotação por
    // inatividade, isso travaria a soul pra sempre (closeSession() nunca é
    // chamado em produção).
    const stuck = await withIdleTimeoutMinutes("999999", () => openSession(testDb.pool, "main", 3));
    assert.equal(stuck.id, s1.id);
    assert.equal(stuck.promptCount, 3);

    // Timeout=0: qualquer inatividade (mesmo microssegundos) conta como expirada.
    const fresh = await withIdleTimeoutMinutes("0", () => openSession(testDb.pool, "main", 3));
    assert.notEqual(fresh.id, s1.id);
    assert.equal(fresh.promptCount, 0);

    const { rows } = await testDb.pool.query("SELECT ended_at FROM sessions WHERE id = $1", [s1.id]);
    assert.ok(rows[0]?.ended_at, "sessão antiga deveria ter sido fechada (ended_at preenchido)");
  } finally {
    await testDb.cleanup();
  }
});

test("bumpSessionPrompt: atualiza last_activity_at", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 10);
    const { rows: before } = await testDb.pool.query("SELECT last_activity_at FROM sessions WHERE id = $1", [s1.id]);

    await new Promise((r) => setTimeout(r, 10));
    await bumpSessionPrompt(testDb.pool, s1.id);

    const { rows: after } = await testDb.pool.query("SELECT last_activity_at FROM sessions WHERE id = $1", [s1.id]);
    assert.ok(new Date(after[0]!.last_activity_at).getTime() > new Date(before[0]!.last_activity_at).getTime());
  } finally {
    await testDb.cleanup();
  }
});

test("recordSessionMessage + getRecentSessionMessages: ordem cronológica e limite por turnos", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 10);
    for (let i = 1; i <= 4; i++) {
      await recordSessionMessage(testDb.pool, s1.id, "main", "user", `pergunta ${i}`);
      await recordSessionMessage(testDb.pool, s1.id, "main", "assistant", `resposta ${i}`);
    }

    const all = await getRecentSessionMessages(testDb.pool, s1.id, 10);
    assert.equal(all.length, 8);
    assert.deepEqual(all[0], { role: "user", content: "pergunta 1" });
    assert.deepEqual(all[7], { role: "assistant", content: "resposta 4" });

    const last2 = await getRecentSessionMessages(testDb.pool, s1.id, 2);
    assert.equal(last2.length, 4);
    assert.deepEqual(last2[0], { role: "user", content: "pergunta 3" });
    assert.deepEqual(last2[3], { role: "assistant", content: "resposta 4" });

    assert.deepEqual(await getRecentSessionMessages(testDb.pool, s1.id, 0), []);
  } finally {
    await testDb.cleanup();
  }
});

test("getRecentSessionMessages: maxChars corta os turnos mais antigos primeiro, preserva o mais recente", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 10);
    // 6 mensagens de 100 chars cada = 600 chars no total.
    for (let i = 1; i <= 6; i++) {
      await recordSessionMessage(testDb.pool, s1.id, "main", i % 2 ? "user" : "assistant", `${i}`.repeat(100));
    }

    // Sem teto: todas as 6.
    assert.equal((await getRecentSessionMessages(testDb.pool, s1.id, { maxTurns: 10 })).length, 6);

    // Teto de 250 chars: cabem só as 2 últimas (200 chars); a 3ª estouraria.
    const budgeted = await getRecentSessionMessages(testDb.pool, s1.id, { maxTurns: 10, maxChars: 250 });
    assert.equal(budgeted.length, 2);
    assert.equal(budgeted[0]!.content, "5".repeat(100));
    assert.equal(budgeted[1]!.content, "6".repeat(100));

    // Teto menor que uma única mensagem: mantém pelo menos a última (nunca vazio se maxTurns>0).
    const one = await getRecentSessionMessages(testDb.pool, s1.id, { maxTurns: 10, maxChars: 10 });
    assert.equal(one.length, 1);
    assert.equal(one[0]!.content, "6".repeat(100));

    // maxChars 0 = sem corte.
    assert.equal((await getRecentSessionMessages(testDb.pool, s1.id, { maxTurns: 10, maxChars: 0 })).length, 6);
  } finally {
    await testDb.cleanup();
  }
});

test("openSession: client_key separa sessões da mesma soul (E2)", async () => {
  const testDb = await createTestSchema();
  try {
    const web = await openSession(testDb.pool, "main", 10, undefined, "web");
    const mobile = await openSession(testDb.pool, "main", 10, undefined, "mobile");
    assert.notEqual(web.id, mobile.id, "clientes diferentes → sessões diferentes");
    assert.equal(web.clientKey, "web");
    assert.equal(mobile.clientKey, "mobile");

    // Reabrir com o mesmo client_key reaproveita.
    const web2 = await openSession(testDb.pool, "main", 10, undefined, "web");
    assert.equal(web2.id, web.id);

    // Histórico não vaza entre clientes.
    await recordSessionMessage(testDb.pool, web.id, "main", "user", "segredo do web");
    const mobileHist = await getRecentSessionMessages(testDb.pool, mobile.id, 10);
    assert.equal(mobileHist.length, 0);

    // Sem client_key = 'default', comportamento single-user preservado.
    const def = await openSession(testDb.pool, "main", 10);
    assert.equal(def.clientKey, "default");
    assert.notEqual(def.id, web.id);
  } finally {
    await testDb.cleanup();
  }
});

test("getRecentSessionMessages: isolamento entre sessões diferentes", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "soul-a", 10);
    const s2 = await openSession(testDb.pool, "soul-b", 10);
    await recordSessionMessage(testDb.pool, s1.id, "soul-a", "user", "mensagem da soul-a");
    await recordSessionMessage(testDb.pool, s2.id, "soul-b", "user", "mensagem da soul-b");

    const historyA = await getRecentSessionMessages(testDb.pool, s1.id, 10);
    const historyB = await getRecentSessionMessages(testDb.pool, s2.id, 10);
    assert.equal(historyA.length, 1);
    assert.equal(historyA[0]!.content, "mensagem da soul-a");
    assert.equal(historyB.length, 1);
    assert.equal(historyB[0]!.content, "mensagem da soul-b");
  } finally {
    await testDb.cleanup();
  }
});
