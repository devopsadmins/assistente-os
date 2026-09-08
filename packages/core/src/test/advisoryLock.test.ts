import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireSharedLock, isBackfillRunning } from "../advisoryLock.js";
import { createTestSchema } from "./pgTestHelper.js";

/**
 * Chave dedicada aos testes, DIFERENTE de ENTITY_EXTRACTION_BACKFILL_LOCK —
 * advisory locks são globais ao banco (não isolados por schema como o
 * pgTestHelper isola tabelas), então usar a chave de produção faria os
 * testes colidirem com um `os memory backfill-entities` de verdade rodando
 * ao mesmo tempo (achado ao vivo: aconteceu exatamente isso 2026-09-08).
 */
const TEST_LOCK = { classId: 7825, objId: 999 };

test("isBackfillRunning: false quando nenhum shared lock está preso", async () => {
  const testDb = await createTestSchema();
  try {
    assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), false);
  } finally {
    await testDb.cleanup();
  }
});

test("isBackfillRunning: true enquanto um shared lock está preso; false depois do release", async () => {
  const testDb = await createTestSchema();
  try {
    const lock = await acquireSharedLock(testDb.pool, TEST_LOCK);
    try {
      assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), true);
    } finally {
      await lock.release();
    }
    assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), false);
  } finally {
    await testDb.cleanup();
  }
});

test("acquireSharedLock: duas chamadas concorrentes convivem sem bloquear (shared, não exclusivo)", async () => {
  const testDb = await createTestSchema();
  try {
    const lockA = await acquireSharedLock(testDb.pool, TEST_LOCK);
    const lockB = await acquireSharedLock(testDb.pool, TEST_LOCK);
    assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), true);
    await lockA.release();
    assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), true, "lockB ainda preso");
    await lockB.release();
    assert.equal(await isBackfillRunning(testDb.pool, TEST_LOCK), false);
  } finally {
    await testDb.cleanup();
  }
});

test("acquireSharedLock: release é idempotente (chamar duas vezes não lança)", async () => {
  const testDb = await createTestSchema();
  try {
    const lock = await acquireSharedLock(testDb.pool, TEST_LOCK);
    await lock.release();
    await assert.doesNotReject(() => lock.release());
  } finally {
    await testDb.cleanup();
  }
});
