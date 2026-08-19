import { randomBytes } from "node:crypto";
import { getPool, closePool, runMigrations, type Pool } from "@assistente-os/core";

/** Mesmo padrão de packages/core/src/test/pgTestHelper.ts (duplicado — testes não
 * cruzam fronteira de pacote no monorepo). Ver o original para detalhes. */
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
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await closePool(scopedUrl);
    },
  };
}

/**
 * Cria uma home temporária (souls/) + um schema Postgres isolado, aponta
 * DATABASE_URL pra esse schema (é assim que loadConfig()/getPool() resolvem
 * o banco — não é derivado de `home` como o antigo kernelDbPath era) e
 * devolve um cleanup único que desfaz os dois.
 */
export async function tempDaemonHome(homeDir: string): Promise<{ cleanup: () => Promise<void> }> {
  const testDb = await createTestSchema();
  const prevDatabaseUrl = process.env.DATABASE_URL;
  const scopedUrl = new URL(baseUrl());
  scopedUrl.searchParams.set("options", `-c search_path=${testDb.schema},public`);
  process.env.DATABASE_URL = scopedUrl.toString();
  return {
    async cleanup() {
      if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDatabaseUrl;
      await testDb.cleanup();
    },
  };
}
