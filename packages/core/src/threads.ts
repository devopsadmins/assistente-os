// packages/core/src/threads.ts
import type { Pool } from "pg";
import { AssistenteOsError } from "./errors.js";

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
    accountId: row.account_id == null ? null : Number(row.account_id),
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
  try {
    const { rows } = await pool.query(
      "INSERT INTO threads (soul, account_id, title) VALUES ($1, $2, $3) RETURNING *",
      [soul, accountId, (title ?? "").slice(0, 200)],
    );
    return rowToThread(rows[0]);
  } catch (err) {
    // 23503 = foreign_key_violation (Postgres) — accountId não existe.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503") {
      throw new AssistenteOsError("E_VALIDATION", "conta inexistente");
    }
    throw err;
  }
}

/**
 * Mais recente primeiro (por last_message_at, com id como desempate — `now()`
 * é o timestamp da transação, então threads tocadas/criadas na mesma
 * transação podem ter o mesmo last_message_at). Branch por accountId em vez
 * de `IS NOT DISTINCT FROM` porque esse operador não é sargable no Postgres —
 * provado via EXPLAIN ANALYZE numa tabela de 200k linhas, o índice
 * (soul, account_id, last_message_at DESC) degradava para usar só a coluna
 * soul. `account_id = $n` e `account_id IS NULL` são ambos sargable.
 */
export async function listThreads(pool: Pool, soul: string, accountId: number | null): Promise<Thread[]> {
  const { rows } =
    accountId === null
      ? await pool.query(
          "SELECT * FROM threads WHERE soul = $1 AND account_id IS NULL ORDER BY last_message_at DESC, id DESC",
          [soul],
        )
      : await pool.query(
          "SELECT * FROM threads WHERE soul = $1 AND account_id = $2 ORDER BY last_message_at DESC, id DESC",
          [soul, accountId],
        );
  return rows.map(rowToThread);
}

/** null = thread não existe ou não pertence a este accountId (mesma ambiguidade deliberada de renameThread/deleteThread). */
export async function getThread(pool: Pool, threadId: number, accountId: number | null): Promise<Thread | null> {
  const { rows } = await pool.query(
    "SELECT * FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2",
    [threadId, accountId],
  );
  return rows[0] ? rowToThread(rows[0]) : null;
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
    [title.slice(0, 200), threadId, accountId],
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
