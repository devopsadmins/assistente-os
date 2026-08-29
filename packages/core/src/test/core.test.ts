import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAgendaItem, claimDueAgenda, reapStaleAgenda, finishAgendaItem, getAgendaItems } from "../kernelDb.js";
import { recordCostCall, sumCostBySoul, recentCalls } from "../costs.js";
import { route, resolveTarget, selectRoute, type RouterProbe } from "../router.js";
import { createSoul, listSouls, getSoul, setActiveSoul, getActiveSoul, ensureSoulFiles } from "../souls.js";
import { loadConfig } from "../config.js";
import { runMigrations } from "../db.js";
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

test("agenda (Onda 3c): reapStaleAgenda devolve preso p/ fila; falha quando esgota tentativas", async () => {
  const testDb = await createTestSchema();
  try {
    const a = await addAgendaItem(testDb.pool, "main", "presa retry", null, null);
    const b = await addAgendaItem(testDb.pool, "main", "presa sem retry", null, null);
    await claimDueAgenda(testDb.pool, 10); // marca 'processing', attempt=1, claimed_at=now()

    // nada envelheceu ainda → reaper não mexe
    assert.deepEqual(await reapStaleAgenda(testDb.pool, { staleMinutes: 15, maxAttempts: 3 }), { retried: 0, failed: 0 });

    // envelhece o claimed_at das duas; b já esgotou tentativas
    await testDb.pool.query("UPDATE agenda SET claimed_at = now() - interval '30 minutes' WHERE id = ANY($1)", [[a.id, b.id]]);
    await testDb.pool.query("UPDATE agenda SET attempt = 3 WHERE id = $1", [b.id]);

    const reaped = await reapStaleAgenda(testDb.pool, { staleMinutes: 15, maxAttempts: 3 });
    assert.deepEqual(reaped, { retried: 1, failed: 1 });

    const rows = Object.fromEntries(
      (await testDb.pool.query("SELECT id, status, done FROM agenda WHERE id = ANY($1)", [[a.id, b.id]])).rows.map(
        (r) => [Number(r.id), r],
      ),
    );
    assert.equal(rows[a.id].status, "pending");
    assert.equal(rows[a.id].done, false);
    assert.equal(rows[b.id].status, "failed");
    assert.equal(rows[b.id].done, true);

    // o que voltou p/ fila pode ser reivindicado de novo
    const again = await claimDueAgenda(testDb.pool, 10);
    assert.deepEqual(again.map((x) => x.id), [a.id]);
    assert.ok(again[0]!.claimed_at, "claimDueAgenda carimba claimed_at");
  } finally {
    await testDb.cleanup();
  }
});

test("agenda: getAgendaItems(soul) escopa à soul (+ itens globais); sem soul lista tudo", async () => {
  const testDb = await createTestSchema();
  try {
    await addAgendaItem(testDb.pool, "soulA", "tarefa da A", null, null);
    await addAgendaItem(testDb.pool, "soulB", "tarefa da B", null, null);
    await addAgendaItem(testDb.pool, null, "tarefa global", null, null);

    const all = await getAgendaItems(testDb.pool, "pending");
    assert.equal(all.length, 3, "sem soul: todas");

    const forA = await getAgendaItems(testDb.pool, "pending", "soulA");
    assert.deepEqual(
      forA.map((i) => i.title).sort(),
      ["tarefa da A", "tarefa global"],
      "soulA vê a sua + a global, nunca a da soulB",
    );

    const forB = await getAgendaItems(testDb.pool, "pending", "soulB");
    assert.equal(forB.some((i) => i.title === "tarefa da A"), false, "soulB não vê a agenda da soulA");
  } finally {
    await testDb.cleanup();
  }
});

test("migrations (Onda 3b): grava sql_sha256; drift de migração aplicada vira warn, não erro", async () => {
  const testDb = await createTestSchema();
  try {
    // createTestSchema já rodou runMigrations → todas as linhas têm checksum.
    const semChecksum = await testDb.pool.query("SELECT count(*) c FROM schema_migrations WHERE sql_sha256 IS NULL");
    assert.equal(Number(semChecksum.rows[0].c), 0, "toda migração aplicada guarda o sql_sha256");

    // Simula uma migração editada-após-aplicada: corrompe o checksum de uma linha.
    const { rows } = await testDb.pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id LIMIT 1");
    const alvo = rows[0]!.id;
    await testDb.pool.query("UPDATE schema_migrations SET sql_sha256 = 'deadbeef' WHERE id = $1", [alvo]);

    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => warns.push(a.join(" "));
    try {
      await assert.doesNotReject(runMigrations(testDb.pool), "drift não derruba o boot");
    } finally {
      console.warn = orig;
    }
    assert.ok(warns.some((w) => w.includes("DRIFT") && w.includes(alvo)), `esperava warn de DRIFT para ${alvo}`);

    // Linha sem checksum (upgrade de ambiente antigo) é preenchida, sem warn.
    await testDb.pool.query("UPDATE schema_migrations SET sql_sha256 = NULL WHERE id = $1", [alvo]);
    warns.length = 0;
    console.warn = (...a: unknown[]) => warns.push(a.join(" "));
    try {
      await runMigrations(testDb.pool);
    } finally {
      console.warn = orig;
    }
    assert.equal(warns.length, 0, "backfill de checksum não emite warn");
    const back = await testDb.pool.query("SELECT sql_sha256 FROM schema_migrations WHERE id = $1", [alvo]);
    assert.match(back.rows[0].sql_sha256, /^[0-9a-f]{64}$/, "checksum recomputado e gravado");
  } finally {
    await testDb.cleanup();
  }
});

test("config: ASSISTENTE_OS_ROUTER_TIERS sobrescreve os degraus (antes era documentado mas ignorado)", () => {
  const prev = process.env.ASSISTENTE_OS_ROUTER_TIERS;
  try {
    delete process.env.ASSISTENTE_OS_ROUTER_TIERS;
    assert.deepEqual(loadConfig({ home: tempHome("rt-default").dir }).routerTiers, ["local", "zen", "soul"]);

    process.env.ASSISTENTE_OS_ROUTER_TIERS = " zen , soul ";
    assert.deepEqual(loadConfig({ home: tempHome("rt-env").dir }).routerTiers, ["zen", "soul"]);

    // override explícito ainda vence o env
    assert.deepEqual(
      loadConfig({ home: tempHome("rt-ovr").dir, routerTiers: ["local"] }).routerTiers,
      ["local"],
    );
  } finally {
    if (prev === undefined) delete process.env.ASSISTENTE_OS_ROUTER_TIERS;
    else process.env.ASSISTENTE_OS_ROUTER_TIERS = prev;
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
