import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEntitiesWithOllama, processExtractionJob } from "../entity-extraction.js";
import { listEntities } from "../graph.js";
import { createTestSchema } from "./pgTestHelper.js";

function mockFetchOnce(response: { ok: boolean; status?: number; body?: unknown }): void {
  (globalThis as any).fetch = async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body,
  });
}

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  (globalThis as any).fetch = originalFetch;
}

test("extractEntitiesWithOllama: lança erro em resposta HTTP não-2xx (não degrada em silêncio)", async () => {
  try {
    mockFetchOnce({ ok: false, status: 500 });
    await assert.rejects(() => extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo"));
  } finally {
    restoreFetch();
  }
});

test("extractEntitiesWithOllama: lança erro em JSON inválido no conteúdo da resposta", async () => {
  try {
    mockFetchOnce({ ok: true, body: { message: { content: "isto não é JSON" } } });
    await assert.rejects(() => extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo"));
  } finally {
    restoreFetch();
  }
});

test("extractEntitiesWithOllama: aceita JSON envolto em cerca de código markdown (```json ... ```)", async () => {
  try {
    mockFetchOnce({
      ok: true,
      body: {
        message: {
          content: '```json\n{"entities": [{"name": "Acme", "kind": "organization"}], "relations": []}\n```',
        },
      },
    });
    const result = await extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo");
    assert.deepEqual(result.entities, [{ name: "Acme", kind: "organization" }]);
  } finally {
    restoreFetch();
  }
});

test("extractEntitiesWithOllama: retorna vazio de verdade quando o LLM genuinamente não encontra nada", async () => {
  try {
    mockFetchOnce({ ok: true, body: { message: { content: JSON.stringify({ entities: [], relations: [] }) } } });
    const result = await extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo");
    assert.deepEqual(result, { entities: [], relations: [] });
  } finally {
    restoreFetch();
  }
});

test("extractEntitiesWithOllama: normaliza nomes, força kind desconhecido pra 'other'", async () => {
  try {
    mockFetchOnce({
      ok: true,
      body: {
        message: {
          content: JSON.stringify({
            entities: [
              { name: "  João Silva.  ", kind: "PERSON" },
              { name: "Acme Corp", kind: "empresa-inexistente" },
            ],
            relations: [],
          }),
        },
      },
    });
    const result = await extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo");
    assert.deepEqual(result.entities, [
      { name: "João Silva", kind: "person" },
      { name: "Acme Corp", kind: "other" },
    ]);
  } finally {
    restoreFetch();
  }
});

test("extractEntitiesWithOllama: relação com endpoint fora de entities ganha entidade 'other' de preenchimento", async () => {
  try {
    mockFetchOnce({
      ok: true,
      body: {
        message: {
          content: JSON.stringify({
            entities: [{ name: "João", kind: "person" }],
            relations: [{ from: "João", rel: "trabalha_em", to: "Empresa Não Listada" }],
          }),
        },
      },
    });
    const result = await extractEntitiesWithOllama("texto qualquer bem longo o suficiente", "http://x", "modelo");
    assert.equal(result.relations.length, 1);
    const names = result.entities.map((e) => e.name);
    assert.ok(names.includes("João"));
    assert.ok(names.includes("Empresa Não Listada"));
    const backfilled = result.entities.find((e) => e.name === "Empresa Não Listada");
    assert.equal(backfilled?.kind, "other");
  } finally {
    restoreFetch();
  }
});

test("processExtractionJob: canonicalNameCache compartilhado evita nova resolução — usa o canônico já em cache", async () => {
  const testDb = await createTestSchema();
  try {
    mockFetchOnce({
      ok: true,
      body: { message: { content: JSON.stringify({ entities: [{ name: "Acme", kind: "organization" }], relations: [] }) } },
    });
    // Pré-popula o cache com um canônico diferente do nome extraído — se
    // processExtractionJob usar o cache (em vez de resolver contra o banco,
    // que não tem nada ainda), a entidade criada deve ter o nome do cache.
    const canonicalNameCache = new Map<string, string>([["Acme", "Acme Canonical"]]);
    await processExtractionJob(
      testDb.pool,
      { soul: "s-cache", body: "texto qualquer bem longo o suficiente" },
      { ollamaUrl: "http://x", chatModel: "modelo", canonicalNameCache },
    );

    const entities = await listEntities(testDb.pool, "s-cache");
    assert.deepEqual(
      entities.map((e) => e.name),
      ["Acme Canonical"],
      "deveria ter usado o canônico do cache, não criado 'Acme' consultando o banco",
    );
  } finally {
    restoreFetch();
    await testDb.cleanup();
  }
});

test("processExtractionJob: sem canonicalNameCache, cria um Map novo por chamada (comportamento do poller do daemon, inalterado)", async () => {
  const testDb = await createTestSchema();
  try {
    mockFetchOnce({
      ok: true,
      body: { message: { content: JSON.stringify({ entities: [{ name: "Acme", kind: "organization" }], relations: [] }) } },
    });
    await processExtractionJob(
      testDb.pool,
      { soul: "s-nocache", body: "texto qualquer bem longo o suficiente" },
      { ollamaUrl: "http://x", chatModel: "modelo" },
    );

    const entities = await listEntities(testDb.pool, "s-nocache");
    assert.deepEqual(entities.map((e) => e.name), ["Acme"]);
  } finally {
    restoreFetch();
    await testDb.cleanup();
  }
});
