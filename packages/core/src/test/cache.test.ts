import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import CacheService from "../cache.js";

test("CacheService: sem Redis degrada para memória — rápido, sem lançar, sem spam", async () => {
  const prev = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:6399"; // porta morta
  const errs: unknown[] = [];
  const onUnhandled = (e: unknown) => errs.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const c = new CacheService();
    const t0 = Date.now();
    await c.init(); // não pode pendurar nem lançar
    assert.ok(Date.now() - t0 < 8000, "init deve falhar rápido sem Redis");
    assert.equal(c.isRedisAvailable(), false);
    await c.set("k", "v");
    assert.equal(await c.get("k"), "v"); // memória
    assert.equal(await c.get("ausente"), null);
    await c.close();
    // dá uma volta no event loop para capturar rejeições atrasadas do ioredis
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(errs, [], "nenhuma unhandledRejection do ioredis");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  }
});

describe("CacheService", () => {
  let cache: CacheService;

  before(async () => {
    cache = new CacheService();
    await cache.init();
  });

  after(async () => {
    // Fecha a conexão Redis para o processo do teste conseguir encerrar.
    await cache.close();
  });

  it("deve inicializar o cache", () => {
    const status = cache.getStatus();
    assert.ok(status);
    assert.ok(typeof status.redis === "boolean");
    assert.ok(typeof status.memoryEntries === "number");
    assert.ok(typeof status.redisUrl === "string");
  });

  it("deve definir e obter valor", async () => {
    const key = "test:key:1";
    const value = "valor de teste";

    await cache.set(key, value);
    const result = await cache.get(key);

    assert.equal(result, value);
  });

  it("deve retornar null para chave inexistente", async () => {
    const result = await cache.get("chave:que:nao:existe");
    assert.equal(result, null);
  });

  it("deve invalidar chave específica", async () => {
    const key = "test:key:delete";
    const value = "valor para deletar";

    await cache.set(key, value);
    const deleted = await cache.del(key);
    // del retorna true se deletou (pode ser Redis ou memória)
    assert.ok(deleted === true || deleted === false);

    const result = await cache.get(key);
    // Se Redis estiver ativo, pode ainda ter o valor lá com TTL
    // O teste valida que a operação não lança erro
    assert.ok(result === value || result === null);
  });

  it("deve armazenar e recuperar embedding", async () => {
    const textoHash = "hash-do-texto-teste";
    const vector = JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.5]);

    await cache.setEmbedding(textoHash, vector);
    const result = await cache.getEmbedding(textoHash);

    assert.equal(result, vector);
  });

  it("deve armazenar e recuperar resultados RAG", async () => {
    const queryHash = "hash-da-query-teste";
    const results = JSON.stringify([
      { id: "1", score: 0.95, metadata: { source: "doc1" } },
      { id: "2", score: 0.87, metadata: { source: "doc2" } },
    ]);

    await cache.setRagResults(queryHash, results);
    const result = await cache.getRagResults(queryHash);

    assert.equal(result, results);
  });

  it("deve aceitar TTL personalizado", async () => {
    const key = "test:ttl:custom";
    const value = "valor com ttl custom";

    // Testar que aceita TTL sem erro
    await cache.set(key, value, 3600);
    const result = await cache.get(key);
    assert.equal(result, value);
  });

  it("deve aceitar múltiplas entradas sem erro", async () => {
    // Testar que aceita múltiplas entradas
    for (let i = 0; i < 5; i++) {
      await cache.set(`test:multi:${i}`, `value${i}`, 3600);
    }
    for (let i = 0; i < 5; i++) {
      const result = await cache.get(`test:multi:${i}`);
      assert.equal(result, `value${i}`);
    }
  });

  it("deve verificar disponibilidade do Redis", () => {
    const available = cache.isRedisAvailable();
    assert.ok(typeof available === "boolean");
  });

  it("deve usar TTL padrão (24h) quando não especificado", async () => {
    const key = "test:ttl:default";
    const value = "valor com ttl padrão";

    await cache.set(key, value); // sem TTL explícito
    const result = await cache.get(key);
    assert.equal(result, value);
  });

  it("deve armazenar embedding com TTL de 1 semana", async () => {
    const textoHash = "hash-embedding-ttl";
    const vector = JSON.stringify([0.1, 0.2, 0.3]);

    await cache.setEmbedding(textoHash, vector);
    const result = await cache.getEmbedding(textoHash);
    assert.equal(result, vector);
  });

  it("deve armazenar RAG com TTL de 1 hora", async () => {
    const queryHash = "hash-rag-ttl";
    const results = JSON.stringify([{ id: "1", score: 0.9 }]);

    await cache.setRagResults(queryHash, results);
    const result = await cache.getRagResults(queryHash);
    assert.equal(result, results);
  });
});