import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAgendaItem, claimDueAgenda, finishAgendaItem, getAgendaItems } from "../kernelDb.js";
import { recordCostCall, sumCostBySoul, recentCalls } from "../costs.js";
import { route, resolveTarget, selectRoute, type RouterProbe } from "../router.js";
import { createSoul, listSouls, getSoul, setActiveSoul, getActiveSoul, ensureSoulFiles } from "../souls.js";
import { loadConfig } from "../config.js";
import { createTestSchema } from "./pgTestHelper.js";

function tempHome(t: string) {
  const dir = mkdtempSync(join(tmpdir(), "aos-test-"));
  const cfg = loadConfig({ home: dir });
  return { dir, cfg };
}

test("banco: cria schema e registra custo imutável", async () => {
  const testDb = await createTestSchema();
  try {
    const c1 = await recordCostCall(testDb.pool, {
      soul: "teste",
      provider: "ollama",
      model: "qwen2.5-coder:3b",
      inputTokens: 10,
      outputTokens: 5,
      cost: 0.001,
    });
    const c2 = await recordCostCall(testDb.pool, {
      soul: "teste",
      provider: "zen",
      model: "zen",
      inputTokens: 100,
      outputTokens: 50,
      cost: 0,
    });
    assert.ok(c1.id > 0);
    assert.ok(c2.id > c1.id);
    assert.equal(await sumCostBySoul(testDb.pool, "teste"), 0.001);
    assert.equal((await recentCalls(testDb.pool, "teste", 10)).length, 2);
    const sumSince = await sumCostBySoul(testDb.pool, "teste", c2.ts);
    assert.equal(sumSince, 0);
  } finally {
    await testDb.cleanup();
  }
});

test("agenda: claimDueAgenda reivindica itens vencidos e ignora futuros/já reivindicados", async () => {
  const testDb = await createTestSchema();
  try {
    const semPrazo = await addAgendaItem(testDb.pool, "main", "tarefa imediata", null, null);
    const vencida = await addAgendaItem(testDb.pool, "main", "tarefa vencida", null, "2000-01-01T00:00:00.000Z");
    await addAgendaItem(testDb.pool, "main", "tarefa futura", null, "2999-01-01T00:00:00.000Z");

    const claimed = await claimDueAgenda(testDb.pool, 10);
    assert.equal(claimed.length, 2);
    assert.deepEqual(
      claimed.map((c) => c.id).sort((a, b) => a - b),
      [semPrazo.id, vencida.id].sort((a, b) => a - b),
    );
    for (const item of claimed) {
      assert.equal(item.status, "processing");
      assert.equal(item.attempt, 1);
      assert.equal(item.done, false);
    }

    // Reivindicado não aparece de novo até ser finalizado.
    assert.equal((await claimDueAgenda(testDb.pool, 10)).length, 0);

    await finishAgendaItem(testDb.pool, semPrazo.id, "completed");
    await finishAgendaItem(testDb.pool, vencida.id, "failed", "opencode saiu com código 1");

    const done = await getAgendaItems(testDb.pool, "done");
    assert.equal(done.length, 2);
    const failed = done.find((d) => d.id === vencida.id)!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.last_error, "opencode saiu com código 1");
    assert.equal((await getAgendaItems(testDb.pool, "pending")).length, 1);
  } finally {
    await testDb.cleanup();
  }
});

test("roteador local-first escolhe o primeiro degrau que responde", async () => {
  const testDb = await createTestSchema();
  try {
    const cfg = loadConfig({ home: tempHome("router").dir, routerTiers: ["local", "zen", "soul"] });
    const soul = { id: "s1", dir: join(cfg.home, "souls", "s1"), config: { name: "s1", provider: "zen-s1" } };
    const seen: string[] = [];
    const decision = await route(testDb.pool, cfg, soul, async (target) => {
      seen.push(target.tier);
      if (target.tier === "local") return { ok: false, reason: "ollama fora do ar" };
      return { ok: true, model: target.model };
    });
    assert.deepEqual(seen, ["local", "zen"]);
    assert.equal(decision.target.tier, "zen");
    assert.equal(decision.target.provider, "zen");
  } finally {
    await testDb.cleanup();
  }
});

test("resolveTarget monta target correto por degrau", () => {
  const cfg = loadConfig({ home: tempHome("tgt").dir });
  const soul = { id: "s1", dir: "x", config: { name: "s1", provider: "zen-s1", models: { chat: "m1" } } };
  assert.deepEqual(resolveTarget(cfg, soul, "local"), { tier: "local", provider: "ollama", model: `ollama/${cfg.ollamaChatModel}` });
  assert.deepEqual(resolveTarget(cfg, soul, "zen"), { tier: "zen", provider: "zen", model: "zen" });
  assert.deepEqual(resolveTarget(cfg, soul, "soul"), { tier: "soul", provider: "zen-s1", model: "m1" });
});

test("selectRoute sem probe pega o primeiro degrau sem checar disponibilidade", async () => {
  const testDb = await createTestSchema();
  try {
    const cfg = loadConfig({ home: tempHome("select-route").dir, routerTiers: ["zen", "soul"] });
    const soul = { id: "s1", dir: "x", config: { name: "s1" } };
    // Sem probe explícito, usa o default "sempre ok" — mesmo comportamento
    // histórico (sem sonda de verdade), preservado pra quem chama selectRoute
    // sem probe (agenda.ts/events.ts: a tarefa disparada em seguida tem
    // efeitos colaterais, não deve ser tentada contra vários provedores).
    const decision = await selectRoute(testDb.pool, cfg, soul);
    assert.equal(decision.target.tier, "zen");
    const { rows } = await testDb.pool.query<{ status: string; reason: string | null }>("SELECT status, reason FROM router_history");
    assert.equal(rows[0]?.status, "ok");
    assert.equal(rows[0]?.reason, null);
  } finally {
    await testDb.cleanup();
  }
});

test("selectRoute com probe cai pro próximo degrau se o atual falhar", async () => {
  const testDb = await createTestSchema();
  try {
    const cfg = loadConfig({ home: tempHome("select-route-probe").dir, routerTiers: ["local", "zen"] });
    const soul = { id: "s1", dir: "x", config: { name: "s1" } };
    const probe: RouterProbe = async (target) => (target.provider === "ollama" ? { ok: false, reason: "indisponível" } : { ok: true });
    const decision = await selectRoute(testDb.pool, cfg, soul, cfg.routerTiers, probe);
    assert.equal(decision.target.tier, "zen");
  } finally {
    await testDb.cleanup();
  }
});

test("souls: criar, listar, ativa, arquivos padrão", () => {
  const { dir } = tempHome("souls");
  try {
    createSoul(dir, "dev", { name: "dev", description: "desenvolvimento" });
    createSoul(dir, "escrita", { name: "escrita" });
    const list = listSouls(dir);
    assert.deepEqual(list.map((s) => s.id), ["dev", "escrita"]);
    assert.equal(getSoul(dir, "dev")?.config.description, "desenvolvimento");
    assert.equal(getSoul(dir, "nao-existe"), null);

    setActiveSoul(dir, "escrita");
    assert.equal(getActiveSoul(dir), "escrita");

    const dev = getSoul(dir, "dev");
    assert.ok(dev);
    const files = ensureSoulFiles(dev.dir);
    assert.ok(files.every((f) => existsSync(f)));
    assert.ok(existsSync(join(dev.dir, "sessoes")));
    assert.ok(existsSync(join(dev.dir, "sources")));
    assert.ok(readFileSync(join(dev.dir, "perfil.md"), "utf8") === "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
