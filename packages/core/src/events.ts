import type { Pool } from "pg";
import { nowIso } from "./costs.js";

export interface EventRecord {
  id: number;
  ts: string;
  type: string;
  payload: string | null;
  soul: string | null;
  signature: string | null;
  status: string;
  attempt: number;
  lastError: string | null;
  processedAt: string | null;
}

export type EventStatus = "pending" | "processing" | "completed" | "failed";

export interface AddEventInput {
  type: string;
  payload?: unknown;
  soul?: string | null;
  signature?: string | null;
}

/** Enfileira um evento aguardando processamento em background. */
export async function addEvent(pool: Pool, input: AddEventInput): Promise<EventRecord> {
  const { rows } = await pool.query(
    `INSERT INTO events (ts, type, payload, soul, signature, status, attempt, last_error, processed_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 0, NULL, NULL)
     RETURNING *`,
    [nowIso(), input.type, input.payload === undefined ? null : JSON.stringify(input.payload), input.soul ?? null, input.signature ?? null],
  );
  return rowToEvent(rows[0]);
}

/**
 * Reivindica eventos pendentes (marca como processing e incrementa attempt) numa
 * única query atômica (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)),
 * segura sob despacho concorrente.
 */
export async function claimPendingEvents(pool: Pool, limit = 5): Promise<EventRecord[]> {
  const { rows } = await pool.query(
    `UPDATE events SET status = 'processing', attempt = attempt + 1
     WHERE id IN (
       SELECT id FROM events WHERE status = 'pending' ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit],
  );
  return rows.map(rowToEvent);
}

export async function finishEvent(pool: Pool, id: number, status: "completed" | "failed", error?: string): Promise<void> {
  await pool.query("UPDATE events SET status = $1, last_error = $2, processed_at = $3 WHERE id = $4", [
    status,
    error ?? null,
    nowIso(),
    id,
  ]);
}

export async function eventStats(pool: Pool): Promise<Record<EventStatus, number>> {
  const { rows } = await pool.query<{ status: string; n: string }>("SELECT status, COUNT(*) AS n FROM events GROUP BY status");
  const out: Record<EventStatus, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) out[row.status as EventStatus] = Number(row.n);
  return out;
}

export async function recentEvents(pool: Pool, limit = 20): Promise<EventRecord[]> {
  const { rows } = await pool.query("SELECT * FROM events ORDER BY id DESC LIMIT $1", [limit]);
  return rows.map(rowToEvent);
}

function rowToEvent(row: Record<string, unknown>): EventRecord {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    type: String(row.type),
    payload: row.payload == null ? null : typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload),
    soul: row.soul == null ? null : String(row.soul),
    signature: row.signature == null ? null : String(row.signature),
    status: String(row.status),
    attempt: Number(row.attempt),
    lastError: row.last_error == null ? null : String(row.last_error),
    processedAt: row.processed_at == null ? null : String(row.processed_at),
  };
}
