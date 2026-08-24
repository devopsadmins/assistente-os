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
