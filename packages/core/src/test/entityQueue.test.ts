import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueueEntityExtraction, claimEntityExtractionJobs, finishEntityExtractionJob } from "../entityQueue.js";
import { createTestSchema } from "./pgTestHelper.js";

test("entityQueue: enqueue -> claim (atômico, incrementa attempt) -> finish", async () => {
  const testDb = await createTestSchema();
  try {
    const job = await enqueueEntityExtraction(testDb.pool, "s1", "cliente-x", "Reunião com a empresa Acme sobre o projeto Y.", "whatsapp", 42);
    assert.equal(job.status, "pending");
    assert.equal(job.soul, "s1");
    assert.equal(job.observationId, 42);

    const claimed = await claimEntityExtractionJobs(testDb.pool, 5);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.id, job.id);
    assert.equal(claimed[0]!.attempt, 1);
    assert.equal(claimed[0]!.status, "processing");

    // Já reivindicado — uma segunda claim não deve pegar o mesmo job de novo.
    assert.deepEqual(await claimEntityExtractionJobs(testDb.pool, 5), []);

    await finishEntityExtractionJob(testDb.pool, job.id, "completed");
  } finally {
    await testDb.cleanup();
  }
});

test("entityQueue: finish com status failed grava last_error", async () => {
  const testDb = await createTestSchema();
  try {
    const job = await enqueueEntityExtraction(testDb.pool, "s1", "t", "corpo qualquer bem longo o suficiente");
    await claimEntityExtractionJobs(testDb.pool, 5);
    await finishEntityExtractionJob(testDb.pool, job.id, "failed", "Ollama respondeu HTTP 500");

    const { rows } = await testDb.pool.query("SELECT status, last_error, processed_at FROM entity_extraction_queue WHERE id = $1", [job.id]);
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].last_error, "Ollama respondeu HTTP 500");
    assert.ok(rows[0].processed_at);
  } finally {
    await testDb.cleanup();
  }
});

test("entityQueue: claim ignora jobs de outra soul só se filtrado — aqui confirma soul é preservado no job", async () => {
  const testDb = await createTestSchema();
  try {
    await enqueueEntityExtraction(testDb.pool, "soul-a", "e", "corpo de teste com tamanho suficiente para o teste");
    await enqueueEntityExtraction(testDb.pool, "soul-b", "e", "outro corpo de teste com tamanho suficiente também");
    const claimed = await claimEntityExtractionJobs(testDb.pool, 10);
    const souls = claimed.map((j) => j.soul).sort();
    assert.deepEqual(souls, ["soul-a", "soul-b"]);
  } finally {
    await testDb.cleanup();
  }
});
