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
 *
 * Achado ao vivo (2026-09-08): esta conexão fica parada (só segura o lock)
 * pela duração inteira de um backfill, que pode passar de `idle_session_timeout`
 * (5min neste ambiente) — sem tratamento, o Postgres mata a conexão e o `pg`
 * emite um `error` não-escutado, derrubando o processo inteiro (pior que não
 * ter lock nenhum). `SET idle_session_timeout = 0` na sessão (só nesta
 * conexão dedicada, não afeta o resto do pool) neutraliza isso; o handler de
 * `error` é defesa em profundidade pra qualquer outra desconexão inesperada
 * (rede, restart do Postgres) não derrubar o processo — só o lock some.
 */
export async function acquireSharedLock(
  pool: Pool,
  lock: { classId: number; objId: number } = ENTITY_EXTRACTION_BACKFILL_LOCK,
): Promise<{ release: () => Promise<void> }> {
  const client: PoolClient = await pool.connect();
  client.on("error", () => {
    /* conexão dedicada só pra segurar o lock — uma desconexão aqui não deve
     * derrubar o processo inteiro (sem handler, o `pg` relança como exceção
     * não tratada). O lock simplesmente some com a conexão; quem chama não
     * tem como "reconectar" um advisory lock no meio da run, então só
     * engolimos o erro e seguimos — pior caso é o poller do daemon voltar a
     * competir por Ollama antes do esperado, não um crash. */
  });
  await client.query("SET idle_session_timeout = 0");
  await client.query("SELECT pg_advisory_lock_shared($1, $2)", [lock.classId, lock.objId]);
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock_shared($1, $2)", [lock.classId, lock.objId]);
      } catch {
        /* conexão já pode ter caído (ver handler de error acima) — melhor esforço */
      } finally {
        try {
          client.release();
        } catch {
          /* idem — client já pode ter sido descartado do pool pelo próprio pg */
        }
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
