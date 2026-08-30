import { test } from "node:test";
import assert from "node:assert/strict";
import { recordRagEvalRun, listRagEvalRuns } from "../rag-eval-runs.js";
import { createTestSchema } from "./pgTestHelper.js";

test("rag_eval_runs (E12b): grava e lê runs; filtra por soul; ordem decrescente", async () => {
  const db = await createTestSchema();
  try {
    await recordRagEvalRun(db.pool, { soul: "a", kind: "offline", n: 20, hitAt1: 0.75, mrr: 0.8, adversarialRefusalRate: 0.9 });
    await recordRagEvalRun(db.pool, { soul: "a", kind: "online", n: 3, faithfulnessSupported: 0.66 });
    await recordRagEvalRun(db.pool, { soul: "b", kind: "offline", n: 10, hitAt1: 0.5 });

    const all = await listRagEvalRuns(db.pool);
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((r) => [r.soul, r.kind]), [["b", "offline"], ["a", "online"], ["a", "offline"]], "id DESC = mais recente primeiro");

    const forA = await listRagEvalRuns(db.pool, "a");
    assert.deepEqual(forA.map((r) => r.kind), ["online", "offline"]);
    const offline = forA.find((r) => r.kind === "offline")!;
    assert.equal(offline.n, 20);
    assert.equal(offline.hitAt1, 0.75);
    assert.equal(offline.adversarialRefusalRate, 0.9);
    assert.equal(offline.faithfulnessSupported, null, "campo ausente vira null");

    assert.equal((await listRagEvalRuns(db.pool, "b")).length, 1);
  } finally {
    await db.cleanup();
  }
});
