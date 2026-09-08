import type { Pool, PoolClient } from "pg";

/** (classid, objid) fixo — namespace pra reduzir colisão com locks de features futuras. */
export const ENTITY_EXTRACTION_BACKFILL_LOCK = { classId: 7825, objId: 1 } as const;

/**
 * Lock compartilhado numa conexão dedicada do pool. Várias chamadas
 * concorrentes (ex.: backfill de souls diferentes) seguram o shared lock ao
 * mesmo tempo sem se bloquear — só um lock exclusivo é bloqueado por ele.
 * Quem chama deve invocar `release()` ao terminar (inclusive em erro).
 * Mesmo sem release explícito, o Postgres libera locks de sessão sozinho
 * quando a conexão cai (SIGKILL, crash) — não fica lock preso.
 */
export async function acquireSharedLock(
  pool: Pool,
  lock: { classId: number; objId: number } = ENTITY_EXTRACTION_BACKFILL_LOCK,
): Promise<{ release: () => Promise<void> }> {
  const client: PoolClient = await pool.connect();
  await client.query("SELECT pg_advisory_lock_shared($1, $2)", [lock.classId, lock.objId]);
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock_shared($1, $2)", [lock.classId, lock.objId]);
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Sonda não-bloqueante via `pg_try_advisory_xact_lock` — escopo de
 * transação implícita de uma única query, libera sozinho logo depois;
 * seguro com pool de conexões (não precisa unlock manual nem conexão
 * dedicada). Retorna `true` se algum backfill está com o shared lock
 * preso agora.
 */
export async function isBackfillRunning(
  pool: Pool,
  lock: { classId: number; objId: number } = ENTITY_EXTRACTION_BACKFILL_LOCK,
): Promise<boolean> {
  const { rows } = await pool.query<{ lock_free: boolean }>(
    "SELECT pg_try_advisory_xact_lock($1, $2) AS lock_free",
    [lock.classId, lock.objId],
  );
  return !(rows[0]?.lock_free ?? true);
}
