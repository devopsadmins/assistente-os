import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { MIGRATIONS } from "./migrations.js";

export type { Pool, PoolClient } from "pg";

// pg por padrão devolve TIMESTAMPTZ/TIMESTAMP como objetos Date. O projeto inteiro
// (interfaces, testes, respostas JSON da API) trata timestamps como string ISO
// (era assim com node:sqlite, que só guarda TEXT) — reformata pra manter esse
// contrato em vez de propagar Date por todo o codebase.
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
types.setTypeParser(TIMESTAMPTZ_OID, (val) => new Date(val).toISOString());
types.setTypeParser(TIMESTAMP_OID, (val) => new Date(val).toISOString());

const pools = new Map<string, Pool>();

/** Pool compartilhado por connection string (singleton lazy). Não fechar por request. */
export function getPool(databaseUrl: string): Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

/** Fecha um pool específico (ou todos, se omitido). Usar no shutdown do daemon / fim da CLI. */
export async function closePool(databaseUrl?: string): Promise<void> {
  const targets = databaseUrl
    ? [[databaseUrl, pools.get(databaseUrl)] as const]
    : [...pools.entries()];
  for (const [key, pool] of targets) {
    if (!pool) continue;
    pools.delete(key);
    await pool.end();
  }
}

/** Roda um SELECT/INSERT/UPDATE parametrizado no pool. Atalho fino sobre pool.query. */
export function query<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}

/** Aplica migrações pendentes (controladas por schema_migrations), em ordem, cada uma em transação própria. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const client: PoolClient = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    const { rows } = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const done = new Set(rows.map((r) => r.id));
    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        applied.push(migration.id);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migração ${migration.id} falhou: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
