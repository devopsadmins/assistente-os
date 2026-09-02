// packages/core/src/threads.ts
import type { Pool } from "pg";

/**
 * Threads (conversas nomeadas) — sub-projeto B. `accountId: null` é thread
 * do operador (token admin), não uma conta de cliente — mesmo padrão de
 * `account_id` nullable já usado desde a Fase 0 do modo amigável.
 */

export interface Thread {
  id: number;
  soul: string;
  accountId: number | null;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

function rowToThread(row: Record<string, unknown>): Thread {
  return {
    id: Number(row.id),
    soul: String(row.soul),
    accountId: row.account_id === null ? null : Number(row.account_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    lastMessageAt: String(row.last_message_at),
  };
}

export async function createThread(
  pool: Pool,
  soul: string,
  accountId: number | null,
  title?: string,
): Promise<Thread> {
  const { rows } = await pool.query(
    "INSERT INTO threads (soul, account_id, title) VALUES ($1, $2, $3) RETURNING *",
    [soul, accountId, title ?? ""],
  );
  return rowToThread(rows[0]);
}

/** Mais recente primeiro (por last_message_at). */
export async function listThreads(pool: Pool, soul: string, accountId: number | null): Promise<Thread[]> {
  const { rows } = await pool.query(
    "SELECT * FROM threads WHERE soul = $1 AND account_id IS NOT DISTINCT FROM $2 ORDER BY last_message_at DESC",
    [soul, accountId],
  );
  return rows.map(rowToThread);
}

/** null = thread não existe ou não pertence a este accountId (as duas situações se parecem de propósito — não vaza qual é qual). */
export async function renameThread(
  pool: Pool,
  threadId: number,
  accountId: number | null,
  title: string,
): Promise<Thread | null> {
  const { rows } = await pool.query(
    "UPDATE threads SET title = $1 WHERE id = $2 AND account_id IS NOT DISTINCT FROM $3 RETURNING *",
    [title, threadId, accountId],
  );
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** false = thread não existe ou não pertence a este accountId. */
export async function deleteThread(pool: Pool, threadId: number, accountId: number | null): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2",
    [threadId, accountId],
  );
  return (rowCount ?? 0) > 0;
}

/** Não valida posse por accountId de propósito — chamado no caminho quente de gravar uma mensagem, onde a posse já foi checada antes (na rota). */
export async function touchThread(pool: Pool, threadId: number): Promise<void> {
  await pool.query("UPDATE threads SET last_message_at = now() WHERE id = $1", [threadId]);
}
