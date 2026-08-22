import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiteralEmbedder, cosine } from "../embedders.js";
import { chunkText, indexDirectory, search, indexStats, scanTextFiles } from "../indexer.js";
import { upsertEntity, upsertRelation, addObservation, listEntities, listRelations, listObservations, graphStats } from "../graph.js";
import { createTestSchema } from "./pgTestHelper.js";

function tempDir(t: string) {
  return mkdtempSync(join(tmpdir(), "aos-mem-"));
}

function makeDocs(dir: string): void {
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "a.md"), "# Título A\n\nPrimeiro parágrafo do documento A.\n\nSegundo parágrafo sobre arquitetura.\n");
  writeFileSync(join(dir, "docs", "b.md"), "# Título B\n\nConteúdo sobre segurança e chaves de API.\n");
  writeFileSync(join(dir, "docs", "nota.txt"), "Nota solta sobre deploy na VM.\n");
  writeFileSync(join(dir, "docs", "ignored.bin"), "não deve ser indexado");
}

test("chunkText divide em blocos respeitando parágrafos", () => {
  const chunks = chunkText("# Título\n\nUm parágrafo.\n\nOutro parágrafo maior " + "x".repeat(700) + ".", 512);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.some((c) => c.includes("Um parágrafo")));
});

test("scanTextFiles só pega .md/.markdown/.txt", () => {
  const dir = tempDir("scan");
  try {
    makeDocs(dir);
    const files = scanTextFiles(join(dir, "docs"));
    assert.deepEqual(files.map((f) => f.split(/[\\/]/).pop()), ["a.md", "b.md", "nota.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("indexDirectory faz upsert idempotente + busca literal (degradação)", async () => {
  const dir = tempDir("index");
  const testDb = await createTestSchema();
  try {
    makeDocs(dir);
    const embedder = new LiteralEmbedder();
    const n1 = await indexDirectory(testDb.pool, "s1", join(dir, "docs"), embedder);
    assert.ok(n1 > 0);
    const n2 = await indexDirectory(testDb.pool, "s1", join(dir, "docs"), embedder);
    assert.equal(n2, n1, "reindexar é idempotente");
    assert.equal((await indexStats(testDb.pool, "s1")).chunks, n1);
    assert.equal((await indexStats(testDb.pool, "s1")).files, 3);

    const r = await search(testDb.pool, "s1", "segurança", embedder, 5);
    assert.ok(r.length >= 1);
    assert.equal(r[0]?.method, "literal");
    assert.ok(r.some((x) => x.body.includes("segurança")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("grafo: entidades, relações e observações isolados por soul", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "s1", "Everton", "pessoa");
    await upsertEntity(testDb.pool, "s1", "Assistente OS", "projeto");
    await upsertEntity(testDb.pool, "s2", "Outra coisa", "outro");
    await upsertRelation(testDb.pool, "s1", "Everton", "desenvolve", "Assistente OS");
    await addObservation(testDb.pool, "s1", "Assistente OS", "primeira alma migrada");

    const ents = await listEntities(testDb.pool, "s1");
    assert.deepEqual(ents.map((e) => e.name), ["Assistente OS", "Everton"]);
    assert.equal((await listEntities(testDb.pool, "s2")).length, 1);
    assert.equal((await listRelations(testDb.pool, "s1"))[0]?.from, "Everton");
    assert.equal((await listObservations(testDb.pool, "s1", "Assistente OS")).length, 1);
    assert.deepEqual(await graphStats(testDb.pool, "s1"), { entities: 2, relations: 1, observations: 1 });
  } finally {
    await testDb.cleanup();
  }
});

test("addObservation: enfileira extração de entidades (corpo longo o suficiente), retorna o id da observação", async () => {
  const testDb = await createTestSchema();
  try {
    const longBody = "Reunião com a empresa Acme sobre o projeto de migração.";
    const shortBody = "ok";

    const obsId = await addObservation(testDb.pool, "s1", "reuniao", longBody, "whatsapp");
    assert.equal(typeof obsId, "number");
    assert.ok(obsId > 0);

    const { rows: queuedLong } = await testDb.pool.query(
      "SELECT * FROM entity_extraction_queue WHERE soul = $1 AND observation_id = $2",
      ["s1", obsId],
    );
    assert.equal(queuedLong.length, 1);
    assert.equal(queuedLong[0].status, "pending");
    assert.equal(queuedLong[0].body, longBody);

    // Corpo curto demais: não enfileira.
    await addObservation(testDb.pool, "s1", "trivial", shortBody);
    const { rows: countAfterShort } = await testDb.pool.query(
      "SELECT COUNT(*) AS c FROM entity_extraction_queue WHERE soul = $1",
      ["s1"],
    );
    assert.equal(Number(countAfterShort[0].c), 1);

    // enqueueExtraction: false suprime mesmo com corpo longo.
    await addObservation(testDb.pool, "s1", "sem-extracao", longBody, undefined, { enqueueExtraction: false });
    const { rows: countAfterOptOut } = await testDb.pool.query(
      "SELECT COUNT(*) AS c FROM entity_extraction_queue WHERE soul = $1",
      ["s1"],
    );
    assert.equal(Number(countAfterOptOut[0].c), 1);
  } finally {
    await testDb.cleanup();
  }
});

test("cosine retorna 0 para vetores incompatíveis e 1 para idênticos", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1], [1, 2]), 0);
  assert.equal(cosine([], []), 0);
});
