/**
 * Restauração de backup ponta a ponta (Onda 2.3 da remediação — prioridade nº5
 * da revisão externa: "backup sem teste de restauração não é suficiente").
 *
 * `createFullBackup` → extrai `database.dump` do ZIP → **destrói dados** →
 * `pg_restore --clean --if-exists` → confere as contagens.
 *
 * NÃO roda no CI (`*.live.js`, e exige `pg_dump`/`pg_restore` + um Postgres onde
 * dê pra `CREATE DATABASE`). No ambiente do usuário:
 *   npm --workspace @assistente-os/cli run build
 *   RUN_E2E=1 node --test packages/cli/dist/test/backup-restore.live.js
 *
 * Usa o container Docker `AOS_PG_CONTAINER` (default `assistente-os-postgres-1`)
 * para criar/dropar o banco descartável e rodar o `pg_restore` (mesma versão do
 * servidor). Sem `RUN_E2E=1` ou sem Docker, apenas retorna.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { Pool } from "pg";
import { runMigrations } from "@assistente-os/core";
import { createFullBackup } from "../backup.js";

const execFileAsync = promisify(execFile);
const RUN = process.env.RUN_E2E === "1";
const CONTAINER = process.env.AOS_PG_CONTAINER || "assistente-os-postgres-1";
const PG_USER = "assistente_os";

async function dockerPsql(db: string, sql: string): Promise<void> {
  await execFileAsync("docker", ["exec", CONTAINER, "psql", "-U", PG_USER, "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

async function dockerUp(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["exec", CONTAINER, "true"]);
    return true;
  } catch {
    return false;
  }
}

describe("backup → restore e2e", () => {
  it("createFullBackup + pg_restore --clean recupera as contagens após perda de dados", async () => {
    if (!RUN) return;
    if (!(await dockerUp())) {
      console.log(`[backup-restore] container ${CONTAINER} indisponível — pulando`);
      return;
    }

    const dbName = `aos_restore_test_${randomUUID().slice(0, 8)}`;
    const url = `postgres://${PG_USER}:${PG_USER}@127.0.0.1:5432/${dbName}`;
    const home = await mkdtemp(join(tmpdir(), "aos-restore-home-"));
    const backupDir = await mkdtemp(join(tmpdir(), "aos-restore-dest-"));
    await mkdir(join(home, "souls"), { recursive: true });
    await writeFile(join(home, "marker.txt"), "home de teste de restore\n");

    await dockerPsql("postgres", `CREATE DATABASE ${dbName}`);
    let pool: Pool | undefined;
    try {
      pool = new Pool({ connectionString: url });
      await runMigrations(pool);

      // Semente: linhas com contagem conhecida em duas tabelas.
      for (let i = 0; i < 7; i++) {
        await pool.query("INSERT INTO agenda (ts, soul, title, body, due_at, done, done_at, status, attempt, last_error) VALUES (now(), 'restore', $1, NULL, NULL, false, NULL, 'pending', 0, NULL)", [`tarefa ${i}`]);
      }
      for (let i = 0; i < 4; i++) {
        await pool.query("INSERT INTO cost_calls (ts, soul, provider, model, input_tokens, output_tokens, cost, status, note) VALUES (now(), 'restore', 'ollama', 'x', 1, 1, 0, 'ok', NULL)");
      }
      const before = {
        agenda: Number((await pool.query("SELECT count(*) c FROM agenda")).rows[0].c),
        cost: Number((await pool.query("SELECT count(*) c FROM cost_calls")).rows[0].c),
      };
      assert.deepEqual(before, { agenda: 7, cost: 4 });

      // Backup (usa o fallback docker do createFullBackup para o pg_dump).
      const result = await createFullBackup(home, url, backupDir);
      const zip = new AdmZip(result.path);
      const dumpEntry = zip.getEntries().find((e) => e.entryName.endsWith("database.dump"));
      assert.ok(dumpEntry && dumpEntry.getData().length > 0, "database.dump presente e não-vazio no ZIP");
      const manifestEntry = zip.getEntries().find((e) => e.entryName.endsWith("manifest.json"));
      const manifest = JSON.parse(manifestEntry!.getData().toString("utf8")) as { database: { ok: boolean } };
      assert.equal(manifest.database.ok, true, "manifest confirma que o dump rodou");

      // Perda de dados: esvazia uma tabela, dropa a outra.
      await pool.query("DELETE FROM agenda");
      await pool.query("DROP TABLE cost_calls");
      assert.equal(Number((await pool.query("SELECT count(*) c FROM agenda")).rows[0].c), 0);
      await pool.end();
      pool = undefined;

      // Restaura o dump de dentro do container.
      const dumpPath = join(backupDir, "database.dump");
      await writeFile(dumpPath, dumpEntry!.getData());
      await execFileAsync("docker", ["cp", dumpPath, `${CONTAINER}:/tmp/${dbName}.dump`]);
      await execFileAsync("docker", [
        "exec", CONTAINER, "pg_restore", "--clean", "--if-exists", "--no-owner",
        "-U", PG_USER, "-d", dbName, `/tmp/${dbName}.dump`,
      ]);

      // Confere: contagens de volta.
      pool = new Pool({ connectionString: url });
      const after = {
        agenda: Number((await pool.query("SELECT count(*) c FROM agenda")).rows[0].c),
        cost: Number((await pool.query("SELECT count(*) c FROM cost_calls")).rows[0].c),
      };
      assert.deepEqual(after, before, "pg_restore recuperou as duas tabelas e suas contagens");
    } finally {
      if (pool) await pool.end().catch(() => {});
      await dockerPsql("postgres", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await execFileAsync("docker", ["exec", CONTAINER, "rm", "-f", `/tmp/${dbName}.dump`]).catch(() => {});
      await rm(home, { recursive: true, force: true });
      await rm(backupDir, { recursive: true, force: true });
    }
  });
});
