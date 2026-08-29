import type { Pool } from "pg";

export interface AgendaItem {
  id: number;
  ts: string;
  soul: string | null;
  title: string;
  body: string | null;
  due_at: string | null;
  done: boolean;
  done_at: string | null;
  status: string;
  attempt: number;
  last_error: string | null;
}

export async function addAgendaItem(
  pool: Pool,
  soul: string | null,
  title: string,
  body: string | null,
  dueAt: string | null,
): Promise<AgendaItem> {
  const { rows } = await pool.query<AgendaItem>(
    `INSERT INTO agenda (ts, soul, title, body, due_at, done, done_at, status, attempt, last_error)
     VALUES (now(), $1, $2, $3, $4, false, NULL, 'pending', 0, NULL)
     RETURNING *`,
    [soul, title, body, dueAt],
  );
  return rows[0]!;
}

/**
 * Lista itens da agenda.
 *
 * `soul` — quando informado, restringe a itens **daquela soul ou globais**
 * (`soul IS NULL`); um chamador escopado (agente MCP/LangGraph com `AGENT_SOUL_ID`
 * / `soulId`) nunca enxerga a agenda de outra soul. Omitido = todas as souls
 * (uso administrativo: `GET /agenda` atrás do token).
 */
export async function getAgendaItems(
  pool: Pool,
  doneFilter: "all" | "pending" | "done" = "pending",
  soul?: string,
): Promise<AgendaItem[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (doneFilter === "pending") clauses.push("done = false");
  if (doneFilter === "done") clauses.push("done = true");
  if (soul !== undefined) {
    params.push(soul);
    clauses.push(`(soul = $${params.length} OR soul IS NULL)`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query<AgendaItem>(
    `SELECT * FROM agenda ${where} ORDER BY due_at ASC NULLS FIRST, ts ASC`,
    params,
  );
  return rows;
}

export async function markAgendaDone(pool: Pool, id: number): Promise<void> {
  await pool.query("UPDATE agenda SET done = true, done_at = now(), status = 'completed' WHERE id = $1", [id]);
}

/**
 * Reivindica itens da agenda vencidos (due_at nulo ou <= agora) e ainda pendentes:
 * marca como "processing" e incrementa attempt, numa única query atômica
 * (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *) —
 * segura mesmo com dois despachos concorrentes (loop periódico + setImmediate),
 * o que o SELECT-depois-UPDATE em dois passos do SQLite não garantia sob concorrência real.
 */
export async function claimDueAgenda(pool: Pool, limit = 5): Promise<AgendaItem[]> {
  const { rows } = await pool.query<AgendaItem>(
    `UPDATE agenda SET status = 'processing', attempt = attempt + 1
     WHERE id IN (
       SELECT id FROM agenda
       WHERE done = false AND status = 'pending' AND (due_at IS NULL OR due_at <= now())
       ORDER BY due_at ASC NULLS FIRST, ts ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit],
  );
  return rows;
}

/** Finaliza um item reivindicado por claimDueAgenda: status terminal + done=true (não retenta automaticamente). */
export async function finishAgendaItem(
  pool: Pool,
  id: number,
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  await pool.query("UPDATE agenda SET status = $1, done = true, done_at = now(), last_error = $2 WHERE id = $3", [
    status,
    error ?? null,
    id,
  ]);
}
