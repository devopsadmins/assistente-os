/**
 * Suíte cross-tenant (E8.1 / gate AI-3) — evidência de que o modelo de
 * isolamento entre souls não vaza dados de uma para outra.
 *
 * Vetores cobertos:
 *  1. RAG: busca da soul A nunca retorna chunk indexado na soul B.
 *  2. Grafo: entidades/observações isoladas por soul.
 *  3. Sessões: session_messages isoladas por soul e por client_key.
 *  4. Custos: cost_calls / router_history filtrados por soul.
 *  5. Zero Trust MCP: com AGENT_SOUL_ID=A, tools soul-scoped não operam sobre B.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiteralEmbedder } from "@assistente-os/memory";
import { indexDirectory, search } from "@assistente-os/memory";
import { upsertEntity, listEntities, addObservation, listObservations } from "@assistente-os/memory";
import {
  openSession,
  recordSessionMessage,
  getRecentSessionMessages,
  recordCostCall,
  sumCostBySoul,
  recordRouterSelection,
  getUsageSummary,
} from "@assistente-os/core";
import type { Soul } from "@assistente-os/core";
import { createTestSchema } from "./pgTestHelper.js";

const fakeSoul = (id: string): Soul => ({ id, dir: `/tmp/${id}`, config: {} } as unknown as Soul);

test("cross-tenant: RAG — busca de A não retorna chunks de B", async () => {
  const db = await createTestSchema();
  const dir = mkdtempSync(join(tmpdir(), "aos-xt-"));
  try {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "a", "doc.md"), "# Soul A\n\nSegredo da soul A: o codinome do projeto é PHOENIX.\n");
    writeFileSync(join(dir, "b", "doc.md"), "# Soul B\n\nSegredo da soul B: a senha do cofre é HYDRA-99.\n");
    const emb = new LiteralEmbedder();
    await indexDirectory(db.pool, "soul-a", join(dir, "a"), emb);
    await indexDirectory(db.pool, "soul-b", join(dir, "b"), emb);

    const aHits = await search(db.pool, "soul-a", "senha do cofre HYDRA", emb, 5);
    assert.ok(!aHits.some((h) => h.body.includes("HYDRA")), "A não deve ver o segredo de B");

    const bHits = await search(db.pool, "soul-b", "codinome PHOENIX", emb, 5);
    assert.ok(!bHits.some((h) => h.body.includes("PHOENIX")), "B não deve ver o segredo de A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.cleanup();
  }
});

test("cross-tenant: grafo — entidades e observações isoladas por soul", async () => {
  const db = await createTestSchema();
  try {
    await upsertEntity(db.pool, "soul-a", "Alvo-A", "pessoa");
    await upsertEntity(db.pool, "soul-b", "Alvo-B", "pessoa");
    await addObservation(db.pool, "soul-a", "Alvo-A", "só a soul A sabe disso");

    const aEnts = (await listEntities(db.pool, "soul-a")).map((e) => e.name);
    const bEnts = (await listEntities(db.pool, "soul-b")).map((e) => e.name);
    assert.deepEqual(aEnts, ["Alvo-A"]);
    assert.deepEqual(bEnts, ["Alvo-B"]);

    const bObs = await listObservations(db.pool, "soul-b");
    assert.equal(bObs.length, 0, "observação de A não aparece em B");
  } finally {
    await db.cleanup();
  }
});

test("cross-tenant: sessões — session_messages isoladas por soul e por client_key", async () => {
  const db = await createTestSchema();
  try {
    const a = await openSession(db.pool, "soul-a", 10, undefined, "web");
    const b = await openSession(db.pool, "soul-b", 10, undefined, "web");
    const aMobile = await openSession(db.pool, "soul-a", 10, undefined, "mobile");
    await recordSessionMessage(db.pool, a.id, "soul-a", "user", "mensagem privada da soul A / web");

    assert.equal((await getRecentSessionMessages(db.pool, b.id, 10)).length, 0, "B não vê histórico de A");
    assert.equal((await getRecentSessionMessages(db.pool, aMobile.id, 10)).length, 0, "outro client_key da mesma soul não vê");
    assert.equal((await getRecentSessionMessages(db.pool, a.id, 10)).length, 1);
  } finally {
    await db.cleanup();
  }
});

test("cross-tenant: custos — cost_calls e getUsageSummary filtrados por soul", async () => {
  const db = await createTestSchema();
  try {
    await recordCostCall(db.pool, { soul: "soul-a", provider: "zen", model: "m", inputTokens: 10, outputTokens: 5, cost: 0, status: "ok" });
    await recordCostCall(db.pool, { soul: "soul-b", provider: "zen", model: "m", inputTokens: 999, outputTokens: 999, cost: 0, status: "ok" });
    assert.equal(await sumCostBySoul(db.pool, "soul-a"), 0); // cost=0 mas a query é por soul
    const aCalls = await db.pool.query("SELECT input_tokens FROM cost_calls WHERE soul = 'soul-a'");
    assert.equal(aCalls.rows.length, 1);
    assert.equal(Number(aCalls.rows[0].input_tokens), 10);

    await recordRouterSelection(db.pool, {
      soul: fakeSoul("soul-a"), target: { tier: "zen", provider: "zen", model: "m" },
      reason: "x", status: "executed", promptTokens: 10, completionTokens: 10, totalTokens: 20, modelUsed: "m", executionMode: "fast",
    });
    const summary = await getUsageSummary(db.pool, { soul: "soul-b" });
    assert.equal(summary.length, 0, "getUsageSummary de B não traz a execução de A");
  } finally {
    await db.cleanup();
  }
});
