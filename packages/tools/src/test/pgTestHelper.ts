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
 * Aponta DATABASE_URL pra um schema novo e isolado (McpServer resolve o pool
 * via loadConfig() -> getPool(), não é derivado do `home` que o caller já criou).
 * Devolve o cleanup; quem chama decide quando rodar (aqui: um único test.after()
 * no arquivo, já que os testes rodam sequenciais e cada tempHome() troca o schema).
 */
export async function pointDatabaseUrlAtFreshSchema(): Promise<{ cleanup: () => Promise<void> }> {
  const testDb = await createTestSchema();
  const scopedUrl = new URL(baseUrl());
  scopedUrl.searchParams.set("options", `-c search_path=${testDb.schema},public`);
  process.env.DATABASE_URL = scopedUrl.toString();
  return { cleanup: testDb.cleanup };
}
