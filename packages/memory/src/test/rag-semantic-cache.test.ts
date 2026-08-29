import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cosineSim,
  semanticCacheConfig,
  ragSemanticCacheGet,
  ragSemanticCacheSet,
  __resetRagSemanticCache,
} from "../rag-semantic-cache.js";
import { LiteralEmbedder } from "../embedders.js";
import { indexDirectory } from "../indexer.js";
import { retrieveContext } from "../rag-chain.js";
import { createTestSchema } from "./pgTestHelper.js";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("cosineSim: identidade = 1, ortogonal = 0, dimensões diferentes = 0", () => {
  assert.equal(cosineSim([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSim([1, 0], [0, 1]), 0);
  assert.equal(cosineSim([1, 2, 3], [2, 4, 6]).toFixed(6), "1.000000");
  assert.equal(cosineSim([1, 2], [1, 2, 3]), 0);
  assert.equal(cosineSim([0, 0], [1, 1]), 0);
});

test("semanticCacheConfig: default off; liga com RAG_SEMANTIC_CACHE=on; clampa threshold/ttl", () => {
  withEnv({ RAG_SEMANTIC_CACHE: undefined }, () => assert.equal(semanticCacheConfig().enabled, false));
  withEnv({ RAG_SEMANTIC_CACHE: "on" }, () => {
    const c = semanticCacheConfig();
    assert.equal(c.enabled, true);
    assert.equal(c.threshold, 0.85);
    assert.equal(c.ttlSec, 60);
  });
  withEnv({ RAG_SEMANTIC_CACHE: "on", RAG_SEMANTIC_CACHE_THRESHOLD: "2", RAG_SEMANTIC_CACHE_TTL: "99999" }, () => {
    const c = semanticCacheConfig();
    assert.equal(c.threshold, 0.999);
    assert.equal(c.ttlSec, 3600);
  });
});

test("get/set: hit acima do threshold, miss abaixo", async () => {
  await __resetRagSemanticCache();
  const b = "bucket-A";
  await ragSemanticCacheSet(b, [1, 0, 0], '{"context":"X"}', 60);
  // vetor quase igual → sim alta
  const hit = await ragSemanticCacheGet(b, [0.99, 0.01, 0], 0.85);
  assert.ok(hit);
  assert.equal(hit!.payload, '{"context":"X"}');
  assert.ok(hit!.similarity > 0.9);
  // vetor bem diferente → miss
  assert.equal(await ragSemanticCacheGet(b, [0, 1, 0], 0.85), null);
});

test("get: buckets isolados", async () => {
  await __resetRagSemanticCache();
  await ragSemanticCacheSet("bucket-A", [1, 0], '{"a":1}', 60);
  assert.equal(await ragSemanticCacheGet("bucket-B", [1, 0], 0.5), null);
});

test("get: entrada expirada não retorna (exp por-entrada, mesmo no Map em memória)", async () => {
  await __resetRagSemanticCache();
  await ragSemanticCacheSet("b", [1, 0], '{"a":1}', 0); // exp = agora → filtrada no read
  assert.equal(await ragSemanticCacheGet("b", [1, 0], 0.5), null);
});

test("get: escolhe a entrada de maior similaridade", async () => {
  await __resetRagSemanticCache();
  await ragSemanticCacheSet("b", [1, 0, 0], '{"which":"far"}', 60);
  await ragSemanticCacheSet("b", [0.9, 0.1, 0], '{"which":"near"}', 60);
  const hit = await ragSemanticCacheGet("b", [0.92, 0.08, 0], 0.8);
  assert.equal(hit!.payload, '{"which":"near"}');
});

test("set: cap de 64 entradas por bucket (evicta as mais antigas)", async () => {
  await __resetRagSemanticCache();
  for (let i = 0; i < 70; i++) {
    // vetores ortogonais o suficiente para não casarem entre si no threshold
    const v = [Math.cos(i), Math.sin(i), i * 0.001];
    await ragSemanticCacheSet("b", v, `{"i":${i}}`, 60);
  }
  // a entrada 0 já deve ter sido evictada; a 69 continua
  assert.equal(await ragSemanticCacheGet("b", [Math.cos(0), Math.sin(0), 0], 0.999), null);
  const last = await ragSemanticCacheGet("b", [Math.cos(69), Math.sin(69), 0.069], 0.999);
  assert.ok(last, "última entrada preservada");
});

test("retrieveContext: cache exato marca cacheHit='exact'; default (semantic off) inalterado", async () => {
  const prev = process.env.RAG_SEMANTIC_CACHE;
  delete process.env.RAG_SEMANTIC_CACHE;
  const dir = mkdtempSync(join(tmpdir(), "aos-semcache-"));
  const db = await createTestSchema();
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "a.md"), "# pm2\n\ncomo configurar o pm2 no servidor\n");
    await indexDirectory(db.pool, "sc1", join(dir, "docs"), new LiteralEmbedder());

    const first = await retrieveContext(db.pool, "sc1", "pm2", 5);
    assert.equal(first.cacheHit, undefined, "primeira chamada não é hit");
    const second = await retrieveContext(db.pool, "sc1", "pm2", 5);
    assert.equal(second.cacheHit, "exact", "segunda chamada idêntica vem do cache exato");
    assert.equal(second.context, first.context);
  } finally {
    if (prev === undefined) delete process.env.RAG_SEMANTIC_CACHE;
    else process.env.RAG_SEMANTIC_CACHE = prev;
    rmSync(dir, { recursive: true, force: true });
    await db.cleanup();
  }
});

test("retrieveContext: { semanticCache: false } nunca consulta/preenche o cache semântico", async () => {
  const prev = process.env.RAG_SEMANTIC_CACHE;
  process.env.RAG_SEMANTIC_CACHE = "on";
  await __resetRagSemanticCache();
  const dir = mkdtempSync(join(tmpdir(), "aos-semcache-off-"));
  const db = await createTestSchema();
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "a.md"), "# tema\n\nconteúdo sobre backup e restauração\n");
    await indexDirectory(db.pool, "sc2", join(dir, "docs"), new LiteralEmbedder());

    // duas chamadas com opt-out: a 2ª não pode vir do cache semântico
    const a = await retrieveContext(db.pool, "sc2", "backup", 5, { semanticCache: false });
    const b = await retrieveContext(db.pool, "sc2", "backup restauração", 5, { semanticCache: false });
    assert.equal(a.cacheHit, undefined);
    assert.notEqual(b.cacheHit, "semantic");
  } finally {
    if (prev === undefined) delete process.env.RAG_SEMANTIC_CACHE;
    else process.env.RAG_SEMANTIC_CACHE = prev;
    await __resetRagSemanticCache();
    rmSync(dir, { recursive: true, force: true });
    await db.cleanup();
  }
});

test("get/set: uma entrada semântica ronda a viagem de serialização via cache", async () => {
  await __resetRagSemanticCache();
  const payload = JSON.stringify({ context: "ctx", sources: [], hasRelevantDocs: true });
  await ragSemanticCacheSet("bkt", [0.6, 0.8], payload, 60);
  const hit = await ragSemanticCacheGet("bkt", [0.61, 0.79], 0.9);
  assert.ok(hit);
  assert.equal(hit!.payload, payload);
});
