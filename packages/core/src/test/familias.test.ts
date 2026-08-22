import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  criarFamilia,
  buscarFamiliaPorSoulId,
  encerrarFamilia,
  excluirFamilia,
  listarFamiliasVencidas,
  sweepRetencaoFamilias,
  familiasRetencaoDias,
  FAMILIAS_RETENCAO_DIAS_PADRAO,
} from "../familias.js";
import { createTestSchema, type TestDb } from "./pgTestHelper.js";

const DIA_MS = 86_400_000;

test("familiasRetencaoDias: default 1825, env válido e inválido", () => {
  const original = process.env.FAMILIAS_RETENCAO_DIAS;
  try {
    delete process.env.FAMILIAS_RETENCAO_DIAS;
    assert.equal(familiasRetencaoDias(), FAMILIAS_RETENCAO_DIAS_PADRAO);

    process.env.FAMILIAS_RETENCAO_DIAS = "365";
    assert.equal(familiasRetencaoDias(), 365);

    process.env.FAMILIAS_RETENCAO_DIAS = "abc";
    assert.equal(familiasRetencaoDias(), FAMILIAS_RETENCAO_DIAS_PADRAO);
    process.env.FAMILIAS_RETENCAO_DIAS = "-1";
    assert.equal(familiasRetencaoDias(), FAMILIAS_RETENCAO_DIAS_PADRAO);
  } finally {
    if (original === undefined) delete process.env.FAMILIAS_RETENCAO_DIAS;
    else process.env.FAMILIAS_RETENCAO_DIAS = original;
  }
});

test("familias: criação aplica defaults de privacidade (base legal, finalidade, sem encerramento)", async () => {
  const testDb = await createTestSchema();
  try {
    const f = await criarFamilia(testDb.pool, "5511999999999", "Família Silva", "João");
    assert.equal(f.baseLegal, "consentimento_responsavel");
    assert.equal(f.baseLegalSensivel, "tutela_saude_profissional");
    assert.equal(f.finalidade, "psicoterapia_familiar_infanto_juvenil");
    assert.equal(f.encerradoEm, null);
    assert.equal(f.retencaoAte, null);
    assert.equal(f.status, "pendente");
  } finally {
    await testDb.cleanup();
  }
});

test("familias: encerrar define status/prazos; vencido entra na lista", async () => {
  const testDb = await createTestSchema();
  try {
    const f = await criarFamilia(testDb.pool, "5511888888888", "Família Souza");
    const antes = Date.now();
    const encerrada = await encerrarFamilia(testDb.pool, f.id, { retencaoDias: 30 });
    assert.equal(encerrada!.status, "encerrado");
    assert.ok(encerrada!.encerradoEm);
    const diff = Date.parse(encerrada!.retencaoAte!) - antes;
    // 30 dias com tolerância de 5s entre agora no JS e o momento da gravação
    assert.ok(Math.abs(diff - 30 * DIA_MS) < 5000, `retencaoAte deveria ser ~30 dias à frente (diff=${diff})`);
    assert.deepEqual(await listarFamiliasVencidas(testDb.pool), []);

    // retencaoDias=0 => já venceu
    const f2 = await criarFamilia(testDb.pool, "5511777777777", "Família Lima");
    await encerrarFamilia(testDb.pool, f2.id, { retencaoDias: 0 });
    const vencidas = await listarFamiliasVencidas(testDb.pool);
    assert.equal(vencidas.length, 1);
    assert.equal(vencidas[0]!.id, f2.id);
  } finally {
    await testDb.cleanup();
  }
});

/** Popula dados derivados da soul em todas as tabelas do escopo da cascata. */
async function seedDadosDaSoul(db: TestDb, soulId: string): Promise<void> {
  const p = db.pool;
  const { rows: sRows } = await p.query<{ id: number }>(
    "INSERT INTO sessions (soul, started_at) VALUES ($1, now()) RETURNING id",
    [soulId],
  );
  await p.query(
    "INSERT INTO execution_logs (session_id, soul, ts, kind) VALUES ($1, $2, now(), 'chat')",
    [sRows[0]!.id, soulId],
  );
  await p.query("INSERT INTO events (ts, type, payload, soul) VALUES (now(), 'mensagem', '{}', $1)", [soulId]);
  await p.query("INSERT INTO agenda (ts, title, soul) VALUES (now(), 'consulta', $1)", [soulId]);
  await p.query(
    "INSERT INTO entity_extraction_queue (ts, soul, entity_name, body) VALUES (now(), $1, 'escola', 'texto longo o suficiente')",
    [soulId],
  );
  await p.query("INSERT INTO observations (soul, entity_name, body, ts) VALUES ($1, 'escola', 'observação', now())", [soulId]);
  await p.query("INSERT INTO relations (soul, from_name, rel, to_name) VALUES ($1, 'joão', 'estuda_em', 'escola')", [soulId]);
  await p.query("INSERT INTO entities (soul, name) VALUES ($1, 'escola') ON CONFLICT DO NOTHING", [soulId]);
  await p.query("INSERT INTO chunks (soul, doc_key, path, body) VALUES ($1, 'perfil.md::0', '/x/perfil.md', 'trecho')", [soulId]);
  await p.query("INSERT INTO agent_checkpoints (soul_id, iteration) VALUES ($1, 1)", [soulId]);
}

test("familias: exclusão em cascata apaga todas as tabelas + diretório da soul", async () => {
  const testDb = await createTestSchema();
  const soulsRoot = mkdtempSync(join(tmpdir(), "souls-test-"));
  try {
    const f = await criarFamilia(testDb.pool, "5511666666666", "Família Costa", "Maria");
    const soulId = f.soulId;
    const soulDirPath = join(soulsRoot, soulId);
    mkdirSync(soulDirPath, { recursive: true });
    writeFileSync(join(soulDirPath, "perfil.md"), "# perfil\n");
    await seedDadosDaSoul(testDb, soulId);

    const contagem = async (sql: string) =>
      Number((await testDb.pool.query<{ n: string }>(sql, [soulId])).rows[0]!.n);
    assert.equal(await contagem("SELECT COUNT(*) AS n FROM chunks WHERE soul = $1"), 1);
    assert.equal(await contagem("SELECT COUNT(*) AS n FROM sessions WHERE soul = $1"), 1);

    const resultado = await excluirFamilia(testDb.pool, soulsRoot, f.id);
    assert.ok(resultado);
    assert.equal(resultado!.soulId, soulId);
    assert.ok(resultado!.soulDirRemovido);
    assert.ok(!existsSync(soulDirPath));
    assert.ok((resultado!.linhasPorTabela["chunks"] ?? 0) >= 1);
    assert.ok((resultado!.linhasPorTabela["sessions"] ?? 0) >= 1);

    for (const [sql, coluna] of [
      ["execution_logs", "soul"],
      ["sessions", "soul"],
      ["events", "soul"],
      ["agenda", "soul"],
      ["entity_extraction_queue", "soul"],
      ["observations", "soul"],
      ["relations", "soul"],
      ["entities", "soul"],
      ["chunks", "soul"],
      ["agent_checkpoints", "soul_id"],
    ] as const) {
      assert.equal(
        Number((await testDb.pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${sql} WHERE ${coluna} = $1`, [soulId])).rows[0]!.n),
        0,
        `${sql} deveria estar vazio após a cascata`,
      );
    }
    assert.equal(await buscarFamiliaPorSoulId(testDb.pool, soulId), null);

    // Segunda exclusão: registro já sumiu
    assert.equal(await excluirFamilia(testDb.pool, soulsRoot, f.id), null);
  } finally {
    rmSync(soulsRoot, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("familias: sweep de retenção elimina só as vencidas", async () => {
  const testDb = await createTestSchema();
  const soulsRoot = mkdtempSync(join(tmpdir(), "souls-sweep-"));
  try {
    const vencida = await criarFamilia(testDb.pool, "5511555555555", "Família Vencida");
    await encerrarFamilia(testDb.pool, vencida.id, { retencaoDias: 0 });
    const futura = await criarFamilia(testDb.pool, "5511444444444", "Família Futura");
    await encerrarFamilia(testDb.pool, futura.id, { retencaoDias: 30 });
    mkdirSync(join(soulsRoot, vencida.soulId), { recursive: true });
    mkdirSync(join(soulsRoot, futura.soulId), { recursive: true });

    const purgados = await sweepRetencaoFamilias(testDb.pool, soulsRoot);
    assert.equal(purgados.length, 1);
    assert.equal(purgados[0]!.familiaId, vencida.id);
    assert.ok(!existsSync(join(soulsRoot, vencida.soulId)));
    assert.ok(existsSync(join(soulsRoot, futura.soulId)));

    // Idempotente
    assert.deepEqual(await sweepRetencaoFamilias(testDb.pool, soulsRoot), []);
  } finally {
    rmSync(soulsRoot, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
