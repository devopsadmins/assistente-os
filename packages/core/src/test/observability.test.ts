import { test } from "node:test";
import assert from "node:assert/strict";
import { signRequest, verifyRequest } from "../webhook.js";
import { addEvent, claimPendingEvents, finishEvent, eventStats, recentEvents } from "../events.js";
import { openSession, bumpSessionPrompt, closeSession, recordExecution, listExecutions } from "../sessions.js";
import { addMonitor, listMonitors, getMonitor, deleteMonitor, updateMonitorResult } from "../monitors.js";
import { createTestSchema } from "./pgTestHelper.js";

test("webhook: assinatura HMAC válida passa, corpo adulterado não", () => {
  const secret = "segredo-teste";
  const body = JSON.stringify({ type: "deploy", payload: { ok: true } });
  const ts = String(Date.now());
  const signature = signRequest(secret, body, ts);
  assert.equal(verifyRequest(secret, body, `sha256=${signature}`, ts).ok, true);
  assert.equal(verifyRequest(secret, `${body}x`, `sha256=${signature}`, ts).ok, false);
  assert.equal(verifyRequest(secret, body, `sha256=${signature}`, String(Date.now() + 400_000)).ok, false);
  assert.equal(verifyRequest(secret, body, `sha256=abc`, ts).ok, false);
  assert.equal(verifyRequest(secret, body, undefined, ts).ok, false);
  assert.equal(verifyRequest(secret, body, `sha256=${signature}`, undefined).ok, false);
});

test("events: addEvent -> claimPendingEvents -> finishEvent + stats", async () => {
  const testDb = await createTestSchema();
  try {
    const ev = await addEvent(testDb.pool, { type: "deploy", payload: { etapa: 1 }, soul: "main", signature: "sig" });
    assert.equal(ev.status, "pending");
    assert.equal(ev.type, "deploy");
    assert.deepEqual(await eventStats(testDb.pool), { pending: 1, processing: 0, completed: 0, failed: 0 });

    const claimed = await claimPendingEvents(testDb.pool, 5);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.id, ev.id);
    assert.equal(claimed[0]!.attempt, 1);
    assert.equal((await eventStats(testDb.pool)).processing, 1);

    await finishEvent(testDb.pool, ev.id, "completed");
    assert.deepEqual(await eventStats(testDb.pool), { pending: 0, processing: 0, completed: 1, failed: 0 });

    await addEvent(testDb.pool, { type: "boom" });
    const failed = (await claimPendingEvents(testDb.pool, 5))[0]!;
    await finishEvent(testDb.pool, failed.id, "failed", "timeout");
    assert.equal((await eventStats(testDb.pool)).failed, 1);

    const recent = await recentEvents(testDb.pool, 10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0]!.status, "failed");
  } finally {
    await testDb.cleanup();
  }
});

test("sessions: abre uma vez, incrementa prompts e registra execution", async () => {
  const testDb = await createTestSchema();
  try {
    const s1 = await openSession(testDb.pool, "main", 3, 10);
    const s2 = await openSession(testDb.pool, "main", 3, 10);
    assert.equal(s2.id, s1.id);
    assert.equal(s1.maxTurns, 3);
    assert.equal(s1.budgetCap, 10);
    assert.equal(await bumpSessionPrompt(testDb.pool, s1.id), 1);
    assert.equal(await bumpSessionPrompt(testDb.pool, s1.id), 2);

    await recordExecution(testDb.pool, { sessionId: s1.id, soul: "main", kind: "chat", contextChars: 500, status: "ok" });
    await recordExecution(testDb.pool, { soul: "main", kind: "event:deploy", contextChars: 100, status: "failed" });
    const execs = await listExecutions(testDb.pool, "main", 10);
    assert.equal(execs.length, 2);
    assert.equal(execs[0]!.kind, "event:deploy");
    assert.equal(execs[1]!.contextChars, 500);

    await closeSession(testDb.pool, s1.id);
    const after = await openSession(testDb.pool, "main", 3, 10);
    assert.notEqual(after.id, s1.id);
  } finally {
    await testDb.cleanup();
  }
});

test("sessions: openSession concorrente não duplica sessão aberta (ON CONFLICT parcial)", async () => {
  const testDb = await createTestSchema();
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => openSession(testDb.pool, "concorrencia", 5, undefined)),
    );
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, "10 chamadas concorrentes devem convergir numa única sessão aberta");
  } finally {
    await testDb.cleanup();
  }
});

test("monitors: CRUD + updateMonitorResult", async () => {
  const testDb = await createTestSchema();
  try {
    const m = await addMonitor(testDb.pool, { name: "portal", url: "https://example.com", expectedCode: 200 });
    assert.equal(m.status, "unknown");
    assert.equal((await getMonitor(testDb.pool, m.id))!.name, "portal");
    assert.equal((await listMonitors(testDb.pool)).length, 1);

    await updateMonitorResult(testDb.pool, m.id, { status: "up", latencyMs: 120, httpCode: 200, lastError: null });
    const updated = (await getMonitor(testDb.pool, m.id))!;
    assert.equal(updated.status, "up");
    assert.equal(updated.httpCode, 200);
    assert.ok(updated.lastCheckedAt);

    assert.equal(await deleteMonitor(testDb.pool, m.id), true);
    assert.equal(await deleteMonitor(testDb.pool, m.id), false);
    assert.equal((await listMonitors(testDb.pool)).length, 0);
  } finally {
    await testDb.cleanup();
  }
});
