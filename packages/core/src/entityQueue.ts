import type { Pool } from "pg";
import { nowIso } from "./costs.js";

/** Tentativas antes de marcar um job como `failed` terminal (ver finishEntityExtractionJob). */
export const MAX_EXTRACTION_ATTEMPTS = 3;

export interface EntityExtractionJob {
  id: number;
  ts: string;
  soul: string;
  entityName: string;
  body: string;
  source: string | null;
  observationId: number | null;
  status: string;
  attempt: number;
  lastError: string | null;
  processedAt: string | null;
  claimedAt: string | null;
}

/**
 * Enfileira um job de extração de entidades/relações via LLM, disparado a
 * partir de addObservation() (packages/memory/src/graph.ts). Fila dedicada,
 * não reaproveita `events` — processPendingEvents() roda todo evento pelo
 * pipeline pesado de agente completo, sem branch por tipo.
 */
export async function enqueueEntityExtraction(
  pool: Pool,
  soul: string,
  entityName: string,
  body: string,
  source?: string | null,
  observationId?: number | null,
): Promise<EntityExtractionJob> {
  const { rows } = await pool.query(
    `INSERT INTO entity_extraction_queue (ts, soul, entity_name, body, source, observation_id, status, attempt, last_error, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, NULL, NULL)
     RETURNING *`,
    [nowIso(), soul, entityName, body, source ?? null, observationId ?? null],
  );
  return rowToJob(rows[0]);
}

/**
 * Reivindica jobs pendentes (marca como processing e incrementa attempt) numa
 * única query atômica (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)),
 * segura sob despacho concorrente.
 */
export async function claimEntityExtractionJobs(pool: Pool, limit = 5): Promise<EntityExtractionJob[]> {
  const { rows } = await pool.query(
    `UPDATE entity_extraction_queue SET status = 'processing', attempt = attempt + 1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM entity_extraction_queue WHERE status = 'pending' ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit],
  );
  return rows.map(rowToJob);
}

export async function finishEntityExtractionJob(
  pool: Pool,
  id: number,
  status: "completed" | "failed" | "pending",
  error?: string,
): Promise<void> {
  // Retry (status "pending"): mantém processed_at NULL — o job ainda não terminou,
  // só voltou pra fila. Só "completed"/"failed" carimbam processed_at.
  const processedAt = status === "pending" ? null : nowIso();
  await pool.query(
    "UPDATE entity_extraction_queue SET status = $1, last_error = $2, processed_at = $3 WHERE id = $4",
    [status, error ?? null, processedAt, id],
  );
}

/**
 * Reclama jobs presos em `processing` (ex.: daemon reiniciado no meio de uma
 * extração) de volta pra `pending`, depois de `staleMinutes` sem conclusão.
 * Chamado no início de cada tick do poller, antes de claimEntityExtractionJobs.
 */
export async function reclaimStuckEntityExtractionJobs(pool: Pool, staleMinutes = 10): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE entity_extraction_queue SET status = 'pending'
     WHERE status = 'processing' AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [staleMinutes],
  );
  return rowCount ?? 0;
}

function rowToJob(row: Record<string, unknown>): EntityExtractionJob {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    soul: String(row.soul),
    entityName: String(row.entity_name),
    body: String(row.body),
    source: row.source == null ? null : String(row.source),
    observationId: row.observation_id == null ? null : Number(row.observation_id),
    status: String(row.status),
    attempt: Number(row.attempt),
    lastError: row.last_error == null ? null : String(row.last_error),
    processedAt: row.processed_at == null ? null : String(row.processed_at),
    claimedAt: row.claimed_at == null ? null : String(row.claimed_at),
  };
}
