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

export async function createTestSchema(): Promise<TestDb> {
  const schema = `test_${randomBytes(6).toString("hex")}`;
  const adminUrl = baseUrl();
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
      await closePool(scopedUrl);
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    },
  };
}
