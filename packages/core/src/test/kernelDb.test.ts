import { test } from "node:test";
import assert from "node:assert/strict";
import { addAgendaItem, updateAgendaItem, cancelAgendaItem } from "../kernelDb.js";
import { createTestSchema } from "./pgTestHelper.js";

test("updateAgendaItem: edita título/corpo/due_at de item pending", async () => {
  const testDb = await createTestSchema();
  try {
    const item = await addAgendaItem(testDb.pool, null, "título original", null, null);
    const updated = await updateAgendaItem(testDb.pool, item.id, { title: "título novo", body: "corpo novo" });
    assert.ok(updated);
    assert.equal(updated!.title, "título novo");
    assert.equal(updated!.body, "corpo novo");
    assert.equal(updated!.due_at, null);
  } finally {
    await testDb.cleanup();
  }
});

test("updateAgendaItem: sem campos não muda nada e devolve o item atual", async () => {
  const testDb = await createTestSchema();
  try {
    const item = await addAgendaItem(testDb.pool, null, "título", null, null);
    const result = await updateAgendaItem(testDb.pool, item.id, {});
    assert.ok(result);
    assert.equal(result!.title, "título");
  } finally {
    await testDb.cleanup();
  }
});

test("updateAgendaItem: item que não está mais pending não é editável (devolve null)", async () => {
  const testDb = await createTestSchema();
  try {
    const item = await addAgendaItem(testDb.pool, null, "título", null, null);
    await cancelAgendaItem(testDb.pool, item.id);
    const result = await updateAgendaItem(testDb.pool, item.id, { title: "não deveria aplicar" });
    assert.equal(result, null);
  } finally {
    await testDb.cleanup();
  }
});

test("updateAgendaItem: id inexistente devolve null", async () => {
  const testDb = await createTestSchema();
  try {
    const result = await updateAgendaItem(testDb.pool, 999999, { title: "x" });
    assert.equal(result, null);
  } finally {
    await testDb.cleanup();
  }
});

test("cancelAgendaItem: cancela item pending (status cancelled, done=true)", async () => {
  const testDb = await createTestSchema();
  try {
    const item = await addAgendaItem(testDb.pool, null, "título", null, null);
    const cancelled = await cancelAgendaItem(testDb.pool, item.id);
    assert.ok(cancelled);
    assert.equal(cancelled!.status, "cancelled");
    assert.equal(cancelled!.done, true);
    assert.ok(cancelled!.done_at);
  } finally {
    await testDb.cleanup();
  }
});

test("cancelAgendaItem: item já cancelado não é cancelável de novo (idempotência via null)", async () => {
  const testDb = await createTestSchema();
  try {
    const item = await addAgendaItem(testDb.pool, null, "título", null, null);
    await cancelAgendaItem(testDb.pool, item.id);
    const second = await cancelAgendaItem(testDb.pool, item.id);
    assert.equal(second, null);
  } finally {
    await testDb.cleanup();
  }
});
