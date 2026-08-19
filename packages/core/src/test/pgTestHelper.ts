import { randomBytes } from "node:crypto";
import { getPool, closePool, runMigrations, type Pool } from "../db.js";

/**
 * Postgres não tem "arquivo novo por teste" de graça como o SQLite tinha
 * (mkdtempSync). Isolamento aqui é por schema: cada teste cria um schema
 * único, roda as migrações nele (search_path = schema,public — precisa de
 * "public" porque é onde a extensão pgvector cria o tipo `vector`), e dropa
 * tudo no fim. Requer um Postgres real acessível via DATABASE_URL_TEST
 * (ou DATABASE_URL) — não há mock/in-memory aqui (pgvector não teria como).
 */
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
