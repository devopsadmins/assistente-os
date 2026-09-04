import { createHash } from "node:crypto";
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
    pool = new Pool({ 
      connectionString: databaseUrl,
      max: 50,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
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

/**
 * SPEC-HR1: sonda rápida e barata pra decidir degradar pra Markdown-only sem
 * esperar o `connectionTimeoutMillis` cheio do pool (5s) — uma query trivial
 * com corrida contra um timer próprio, bem mais curto.
 */
export async function isDbHealthy(pool: Pool, timeoutMs = 1500): Promise<boolean> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db health probe timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
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

const migrationSha = (sql: string): string => createHash("sha256").update(sql).digest("hex");

/**
 * Aplica migrações pendentes (controladas por `schema_migrations`), em ordem,
 * cada uma em transação própria.
 *
 * Onda 3b: cada linha guarda o `sql_sha256` da migração aplicada. Como o
 * framework é append-only + `IF NOT EXISTS`, uma migração **editada depois de
 * aplicada** em algum ambiente não re-roda e não erra — o drift ficava
 * invisível. Agora, na subida, o checksum atual é comparado com o gravado;
 * divergência vira `console.warn` (não derruba o boot — é um POC). Linhas
 * antigas sem checksum são preenchidas com o valor atual (não dá pra detectar
 * drift retroativo, mas trava o futuro).
 */
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
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sql_sha256 TEXT");

    const { rows } = await client.query<{ id: string; sql_sha256: string | null }>(
      "SELECT id, sql_sha256 FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.id, r.sql_sha256]));

    for (const migration of MIGRATIONS) {
      const sha = migrationSha(migration.sql);
      if (done.has(migration.id)) {
        const stored = done.get(migration.id);
        if (stored == null) {
          await client.query("UPDATE schema_migrations SET sql_sha256 = $1 WHERE id = $2", [sha, migration.id]);
        } else if (stored !== sha) {
          console.warn(
            `[migrations] DRIFT: '${migration.id}' foi editada depois de aplicada ` +
              `(gravado ${stored.slice(0, 12)}, atual ${sha.slice(0, 12)}). ` +
              `O schema neste ambiente pode não refletir o código.`,
          );
        }
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (id, sql_sha256) VALUES ($1, $2)", [migration.id, sha]);
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
