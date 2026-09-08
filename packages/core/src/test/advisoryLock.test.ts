import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireSharedLock, isBackfillRunning } from "../advisoryLock.js";
import { createTestSchema } from "./pgTestHelper.js";

test("isBackfillRunning: false quando nenhum shared lock está preso", async () => {
  const testDb = await createTestSchema();
  try {
    assert.equal(await isBackfillRunning(testDb.pool), false);
  } finally {
    await testDb.cleanup();
  }
});

test("isBackfillRunning: true enquanto um shared lock está preso; false depois do release", async () => {
  const testDb = await createTestSchema();
  try {
    const lock = await acquireSharedLock(testDb.pool);
    try {
      assert.equal(await isBackfillRunning(testDb.pool), true);
    } finally {
      await lock.release();
    }
    assert.equal(await isBackfillRunning(testDb.pool), false);
  } finally {
    await testDb.cleanup();
  }
});

test("acquireSharedLock: duas chamadas concorrentes convivem sem bloquear (shared, não exclusivo)", async () => {
  const testDb = await createTestSchema();
  try {
    const lockA = await acquireSharedLock(testDb.pool);
    const lockB = await acquireSharedLock(testDb.pool);
    assert.equal(await isBackfillRunning(testDb.pool), true);
    await lockA.release();
    assert.equal(await isBackfillRunning(testDb.pool), true, "lockB ainda preso");
    await lockB.release();
    assert.equal(await isBackfillRunning(testDb.pool), false);
  } finally {
    await testDb.cleanup();
  }
});

test("acquireSharedLock: release é idempotente (chamar duas vezes não lança)", async () => {
  const testDb = await createTestSchema();
  try {
    const lock = await acquireSharedLock(testDb.pool);
    await lock.release();
    await assert.doesNotReject(() => lock.release());
  } finally {
    await testDb.cleanup();
  }
});
