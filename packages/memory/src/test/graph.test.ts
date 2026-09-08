import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Embedder } from "../embedders.js";
import {
  upsertEntity,
  upsertRelation,
  getEntityHistory,
  findDuplicateEntityByName,
  findSimilarEntity,
  resolveCanonicalEntityName,
  walkGraph,
} from "../graph.js";
import { createTestSchema } from "./pgTestHelper.js";

/** Embedder determinístico (hash → vetor 768d), só pra teste — sem depender de Ollama/Xenova. */
class DeterministicEmbedder implements Embedder {
  dims(): number {
    return 768;
  }
  async embed(text: string): Promise<number[] | null> {
    const vec: number[] = [];
    let seed = createHash("sha256").update(text).digest();
    while (vec.length < 768) {
      seed = createHash("sha256").update(seed).digest();
      for (let i = 0; i < seed.length && vec.length < 768; i++) vec.push(seed[i]! / 255 - 0.5);
    }
    return vec;
  }
}

test("upsertEntity: grava em entity_history quando kind/properties mudam", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g1", "Acme", "organization", null, "manual");
    await upsertEntity(testDb.pool, "g1", "Acme", "person", { nota: "corrigido" }, "entity_extraction");

    const history = await getEntityHistory(testDb.pool, "g1", "Acme");
    assert.equal(history.length, 1, "só a mudança real deveria ter gravado histórico");
    assert.equal(history[0]?.kind, "organization", "histórico guarda o valor ANTERIOR à mudança");
    assert.equal(history[0]?.replacedBy, "entity_extraction");
  } finally {
    await testDb.cleanup();
  }
});

test("upsertEntity: upsert idempotente (mesmo valor repetido) não gera ruído no histórico", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g2", "Acme", "organization", null, "manual");
    await upsertEntity(testDb.pool, "g2", "Acme", "organization", null, "manual");

    const history = await getEntityHistory(testDb.pool, "g2", "Acme");
    assert.equal(history.length, 0);
  } finally {
    await testDb.cleanup();
  }
});

test("upsertRelation: grava em relation_history só quando properties mudam", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g3", "João", "person");
    await upsertEntity(testDb.pool, "g3", "Acme", "organization");
    await upsertRelation(testDb.pool, "g3", "João", "trabalha_em", "Acme", null, "manual");
    await upsertRelation(testDb.pool, "g3", "João", "trabalha_em", "Acme", { cargo: "CTO" }, "manual");
    await upsertRelation(testDb.pool, "g3", "João", "trabalha_em", "Acme", { cargo: "CTO" }, "manual");

    const { rows } = await testDb.pool.query<{ c: string }>(
      "SELECT COUNT(*) AS c FROM relation_history WHERE soul = $1",
      ["g3"],
    );
    assert.equal(Number(rows[0]?.c), 1, "só a mudança real (null → {cargo}) deveria ter gravado histórico");
  } finally {
    await testDb.cleanup();
  }
});

test("findDuplicateEntityByName: acha por fold (case-insensitive)", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g4", "Everton", "person");
    const found = await findDuplicateEntityByName(testDb.pool, "g4", "everton");
    assert.equal(found?.name, "Everton");
  } finally {
    await testDb.cleanup();
  }
});

test("findDuplicateEntityByName: não acha entidade de outra soul", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g5a", "Everton", "person");
    const found = await findDuplicateEntityByName(testDb.pool, "g5b", "everton");
    assert.equal(found, null);
  } finally {
    await testDb.cleanup();
  }
});

test("findSimilarEntity: casa acima do threshold via embedding (nome diferente, mesmo vetor)", async () => {
  const testDb = await createTestSchema();
  const embedder = new DeterministicEmbedder();
  try {
    // findSimilarEntity exclui match por nome exato (name <> $3) de propósito
    // — só entra em jogo quando o nome buscado é diferente do existente mas
    // "aponta pro mesmo conceito". Simulamos isso gravando em "ACME Corp" o
    // embedding de "ACME Corporation" (a forma que será buscada).
    await upsertEntity(testDb.pool, "g6", "ACME Corp", "organization");
    const vec = await embedder.embed("ACME Corporation");
    await testDb.pool.query("UPDATE entities SET embedding = $1::vector WHERE soul = $2 AND name = $3", [
      JSON.stringify(vec),
      "g6",
      "ACME Corp",
    ]);

    const similar = await findSimilarEntity(testDb.pool, "g6", "ACME Corporation", embedder, 0.99);
    assert.equal(similar?.name, "ACME Corp");

    const noMatch = await findSimilarEntity(testDb.pool, "g6", "Empresa Completamente Diferente", embedder, 0.99);
    assert.equal(noMatch, null);
  } finally {
    await testDb.cleanup();
  }
});

test("resolveCanonicalEntityName: exato > fold > embedding, nunca cria nada", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g7", "Everton Lima", "person");

    const exact = await resolveCanonicalEntityName(testDb.pool, "g7", "Everton Lima");
    assert.deepEqual(exact, { canonical: "Everton Lima", matchedBy: "exact" });

    const fold = await resolveCanonicalEntityName(testDb.pool, "g7", "everton lima");
    assert.deepEqual(fold, { canonical: "Everton Lima", matchedBy: "fold" });

    const none = await resolveCanonicalEntityName(testDb.pool, "g7", "Pessoa Totalmente Nova");
    assert.deepEqual(none, { canonical: "Pessoa Totalmente Nova", matchedBy: null });

    const { rows } = await testDb.pool.query<{ c: string }>("SELECT COUNT(*) AS c FROM entities WHERE soul = $1", ["g7"]);
    assert.equal(Number(rows[0]?.c), 1, "resolveCanonicalEntityName não deveria criar entidades");
  } finally {
    await testDb.cleanup();
  }
});

test("walkGraph: respeita maxHops (não inclui nó 2 saltos além do limite)", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertRelation(testDb.pool, "g8", "A", "liga_a", "B");
    await upsertRelation(testDb.pool, "g8", "B", "liga_a", "C");
    await upsertRelation(testDb.pool, "g8", "C", "liga_a", "D");

    const result = await walkGraph(testDb.pool, "g8", "A", { maxHops: 2 });
    const names = result.nodes.map((n) => n.name).sort();
    assert.deepEqual(names, ["A", "B", "C"]);
    assert.ok(!names.includes("D"));
  } finally {
    await testDb.cleanup();
  }
});

test("walkGraph: relTypes filtra corretamente", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertRelation(testDb.pool, "g9", "A", "amigo_de", "B");
    await upsertRelation(testDb.pool, "g9", "A", "trabalha_com", "C");

    const result = await walkGraph(testDb.pool, "g9", "A", { maxHops: 2, relTypes: ["amigo_de"] });
    const names = result.nodes.map((n) => n.name).sort();
    assert.deepEqual(names, ["A", "B"]);
  } finally {
    await testDb.cleanup();
  }
});

test("walkGraph: nó isolado sem relações retorna só o nó de partida", async () => {
  const testDb = await createTestSchema();
  try {
    await upsertEntity(testDb.pool, "g10", "Solitário", "person");
    const result = await walkGraph(testDb.pool, "g10", "Solitário", { maxHops: 2 });
    assert.deepEqual(result.nodes, [{ name: "Solitário", kind: "person", depth: 0 }]);
    assert.deepEqual(result.edges, []);
  } finally {
    await testDb.cleanup();
  }
});
