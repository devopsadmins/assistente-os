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
  claimed_at: string | null;
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

export async function getAgendaItemById(pool: Pool, id: number): Promise<AgendaItem | null> {
  const { rows } = await pool.query<AgendaItem>("SELECT * FROM agenda WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function markAgendaDone(pool: Pool, id: number): Promise<void> {
  await pool.query("UPDATE agenda SET done = true, done_at = now(), status = 'completed' WHERE id = $1", [id]);
}

/**
 * Edita título/corpo/due_at de um item ainda `pending`. Só os campos passados
 * são alterados. `null` devolvido quando o id não existe ou o item já saiu
 * de pending (reivindicado por `claimDueAgenda` ou já finalizado) — editar
 * nesse caso seria corrida com o despacho real.
 */
export async function updateAgendaItem(
  pool: Pool,
  id: number,
  updates: { title?: string; body?: string | null; dueAt?: string | null },
): Promise<AgendaItem | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.title !== undefined) {
    params.push(updates.title);
    sets.push(`title = $${params.length}`);
  }
  if (updates.body !== undefined) {
    params.push(updates.body);
    sets.push(`body = $${params.length}`);
  }
  if (updates.dueAt !== undefined) {
    params.push(updates.dueAt);
    sets.push(`due_at = $${params.length}`);
  }
  if (sets.length === 0) {
    const { rows } = await pool.query<AgendaItem>("SELECT * FROM agenda WHERE id = $1 AND status = 'pending'", [id]);
    return rows[0] ?? null;
  }
  params.push(id);
  const { rows } = await pool.query<AgendaItem>(
    `UPDATE agenda SET ${sets.join(", ")} WHERE id = $${params.length} AND status = 'pending' RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

/**
 * Cancela um item `pending` (soft: status='cancelled', done=true — nunca
 * apaga a linha, mesma filosofia auditável de `finishAgendaItem`/`reapStaleAgenda`).
 * `null` quando o id não existe ou já saiu de pending (inclui já cancelado).
 */
export async function cancelAgendaItem(pool: Pool, id: number): Promise<AgendaItem | null> {
  const { rows } = await pool.query<AgendaItem>(
    "UPDATE agenda SET status = 'cancelled', done = true, done_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id],
  );
  return rows[0] ?? null;
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
    `UPDATE agenda SET status = 'processing', attempt = attempt + 1, claimed_at = now()
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

/**
 * Reaper de itens presos em 'processing' (crash entre claim e finish). Itens
 * reivindicados há mais de `staleMinutes` voltam para 'pending' se ainda têm
 * tentativa; se `attempt >= maxAttempts`, falham de vez.
 */
export async function reapStaleAgenda(
  pool: Pool,
  opts: { staleMinutes?: number; maxAttempts?: number } = {},
): Promise<{ retried: number; failed: number }> {
  const stale = Math.max(1, Math.floor(opts.staleMinutes ?? 15));
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
  const failed = await pool.query(
    `UPDATE agenda SET status = 'failed', done = true, done_at = now(), claimed_at = NULL,
        last_error = 'reaper: preso em processing sem tentativas restantes'
     WHERE status = 'processing' AND claimed_at IS NOT NULL
       AND claimed_at < now() - ($1 || ' minutes')::interval
       AND attempt >= $2`,
    [String(stale), maxAttempts],
  );
  const retried = await pool.query(
    `UPDATE agenda SET status = 'pending', claimed_at = NULL
     WHERE status = 'processing' AND claimed_at IS NOT NULL
       AND claimed_at < now() - ($1 || ' minutes')::interval
       AND attempt < $2`,
    [String(stale), maxAttempts],
  );
  return { retried: retried.rowCount ?? 0, failed: failed.rowCount ?? 0 };
}
