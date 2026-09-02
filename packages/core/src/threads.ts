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

/** Mais recente primeiro (por last_message_at). accountId undefined = sem filtro (token admin, vê tudo). */
export async function listThreads(pool: Pool, soul: string, accountId: number | null | undefined): Promise<Thread[]> {
  if (accountId === undefined) {
    const { rows } = await pool.query(
      "SELECT * FROM threads WHERE soul = $1 ORDER BY last_message_at DESC, id DESC",
      [soul],
    );
    return rows.map(rowToThread);
  }
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

/** null = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function getThread(pool: Pool, threadId: number, accountId: number | null | undefined): Promise<Thread | null> {
  const { rows } =
    accountId === undefined
      ? await pool.query("SELECT * FROM threads WHERE id = $1", [threadId])
      : await pool.query("SELECT * FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2", [threadId, accountId]);
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** null = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function renameThread(
  pool: Pool,
  threadId: number,
  accountId: number | null | undefined,
  title: string,
): Promise<Thread | null> {
  const cappedTitle = title.slice(0, 200);
  const { rows } =
    accountId === undefined
      ? await pool.query("UPDATE threads SET title = $1 WHERE id = $2 RETURNING *", [cappedTitle, threadId])
      : await pool.query(
          "UPDATE threads SET title = $1 WHERE id = $2 AND account_id IS NOT DISTINCT FROM $3 RETURNING *",
          [cappedTitle, threadId, accountId],
        );
  return rows[0] ? rowToThread(rows[0]) : null;
}

/** false = thread não existe ou não pertence a este accountId. accountId undefined = sem filtro (token admin). */
export async function deleteThread(pool: Pool, threadId: number, accountId: number | null | undefined): Promise<boolean> {
  const { rowCount } =
    accountId === undefined
      ? await pool.query("DELETE FROM threads WHERE id = $1", [threadId])
      : await pool.query("DELETE FROM threads WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2", [threadId, accountId]);
  return (rowCount ?? 0) > 0;
}

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

/** Não checa posse — quem chama já confirmou via getThread antes (mesmo padrão de touchThread). */
export async function getThreadMessages(pool: Pool, threadId: number): Promise<ThreadMessage[]> {
  const { rows } = await pool.query<{ role: string; content: string; ts: unknown }>(
    "SELECT role, content, ts FROM session_messages WHERE thread_id = $1 ORDER BY id ASC",
    [threadId],
  );
  return rows.map((r) => ({ role: r.role as ThreadMessage["role"], content: r.content, ts: String(r.ts) }));
}

/** Não valida posse por accountId de propósito — chamado no caminho quente de gravar uma mensagem, onde a posse já foi checada antes (na rota). */
export async function touchThread(pool: Pool, threadId: number): Promise<void> {
  await pool.query("UPDATE threads SET last_message_at = now() WHERE id = $1", [threadId]);
}
