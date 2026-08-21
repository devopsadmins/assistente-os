import { randomBytes } from "node:crypto";
import { getPool, closePool, runMigrations, type Pool } from "@assistente-os/core";

/** Mesmo padrão de packages/core/src/test/pgTestHelper.ts — duplicado aqui porque
 * arquivos de teste não cruzam fronteira de pacote no monorepo (cada um com seu
 * próprio rootDir de tsc). Ver o original para o porquê do search_path incluir "public". */
export interface TestDb {
  pool: Pool;
  schema: string;
  cleanup(): Promise<void>;
}

function baseUrl(): string {
  return (
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL ||
    "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
  );
}

// O adminPool (CREATE/DROP SCHEMA) é um singleton cacheado por getPool() e
// compartilhado por todos os testes do arquivo — fechá-lo em cleanup() por
// teste quebraria os testes seguintes que ainda o usam. Em vez disso, fecha
// uma única vez quando o processo do arquivo de teste está de fato terminando.
let adminPoolExitHookRegistered = false;
function registerAdminPoolExitHook(adminUrl: string): void {
  if (adminPoolExitHookRegistered) return;
  adminPoolExitHookRegistered = true;
  process.on("beforeExit", () => {
    void closePool(adminUrl).catch(() => {});
  });
}

export async function createTestSchema(): Promise<TestDb> {
  const schema = `test_${randomBytes(6).toString("hex")}`;
  const adminUrl = baseUrl();
  registerAdminPoolExitHook(adminUrl);
  const adminPool = getPool(adminUrl);
  await adminPool.query(`CREATE SCHEMA "${schema}"`);

  const url = new URL(adminUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const scopedUrl = url.toString();
  const pool = getPool(scopedUrl);
  await runMigrations(pool);

  return {
    pool,
    schema,
    async cleanup() {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await closePool(scopedUrl);
    },
  };
}
