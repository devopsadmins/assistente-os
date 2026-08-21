import type { Pool } from "pg";
import { nowIso } from "./costs.js";

export interface SessionRecord {
  id: number;
  soul: string;
  startedAt: string;
  endedAt: string | null;
  promptCount: number;
  maxTurns: number;
  budgetCap: number | null;
}

export interface ExecutionLog {
  id: number;
  sessionId: number | null;
  soul: string;
  ts: string;
  kind: string;
  promptHash: string | null;
  model: string | null;
  tier: string | null;
  filesLoaded: number;
  tokensIn: number;
  tokensOut: number;
  contextChars: number;
  verdict: string | null;
  status: string;
  note: string | null;
}

export interface ExecutionLogInput {
  sessionId?: number | null;
  soul: string;
  kind?: string;
  promptHash?: string;
  model?: string;
  tier?: string;
  filesLoaded?: number;
  tokensIn?: number;
  tokensOut?: number;
  contextChars?: number;
  verdict?: string;
  status?: string;
  note?: string;
}

/**
 * Abre a sessão ativa da soul (ou cria uma nova) e devolve o registro.
 * Usa INSERT ... ON CONFLICT sobre o índice único parcial idx_sessions_soul_open
 * (soul) WHERE ended_at IS NULL — sob SQLite (single-writer síncrono) um
 * "SELECT, senão INSERT" nunca duplicava; sob Postgres com chamadas concorrentes
 * de verdade, duplicaria sem essa garantia no banco.
 */
export async function openSession(pool: Pool, soul: string, maxTurns: number, budgetCap?: number): Promise<SessionRecord> {
  // Até 3 tentativas: se a sessão concorrente "vencedora" for fechada entre o
  // INSERT (que perde o ON CONFLICT) e o SELECT de fallback, nenhuma sessão
  // aberta existe mais — uma nova tentativa de INSERT deve então ter sucesso.
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await pool.query(
      `INSERT INTO sessions (soul, started_at, ended_at, prompt_count, max_turns, budget_cap)
       VALUES ($1, $2, NULL, 0, $3, $4)
       ON CONFLICT (soul) WHERE ended_at IS NULL DO NOTHING
       RETURNING *`,
      [soul, nowIso(), maxTurns, budgetCap ?? null],
    );
    if (inserted.rows[0]) return rowToSession(inserted.rows[0]);
    const { rows } = await pool.query(
      "SELECT * FROM sessions WHERE soul = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
      [soul],
    );
    if (rows[0]) return rowToSession(rows[0]);
  }
  throw new Error(`openSession: não foi possível abrir/recuperar sessão para soul '${soul}' após concorrência repetida`);
}

/** Incrementa o contador de prompts da sessão e devolve o total usado. */
export async function bumpSessionPrompt(pool: Pool, sessionId: number): Promise<number> {
  const { rows } = await pool.query<{ prompt_count: number }>(
    "UPDATE sessions SET prompt_count = prompt_count + 1 WHERE id = $1 RETURNING prompt_count",
    [sessionId],
  );
  return Number(rows[0]?.prompt_count ?? 0);
}

export async function closeSession(pool: Pool, sessionId: number): Promise<void> {
  await pool.query("UPDATE sessions SET ended_at = $1 WHERE id = $2 AND ended_at IS NULL", [nowIso(), sessionId]);
}

/** Registra UMA execução (contexto montado + turno disparado) de forma imutável. */
export async function recordExecution(pool: Pool, input: ExecutionLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO execution_logs (session_id, soul, ts, kind, prompt_hash, model, tier, files_loaded, tokens_in, tokens_out, context_chars, verdict, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      input.sessionId ?? null,
      input.soul,
      nowIso(),
      input.kind ?? "chat",
      input.promptHash ?? null,
      input.model ?? null,
      input.tier ?? null,
      input.filesLoaded ?? 0,
      input.tokensIn ?? 0,
      input.tokensOut ?? 0,
      input.contextChars ?? 0,
      input.verdict ?? null,
      input.status ?? "ok",
      input.note ?? null,
    ],
  );
}

export async function listExecutions(pool: Pool, soul?: string, limit = 20): Promise<ExecutionLog[]> {
  const { rows } = soul
    ? await pool.query("SELECT * FROM execution_logs WHERE soul = $1 ORDER BY id DESC LIMIT $2", [soul, limit])
    : await pool.query("SELECT * FROM execution_logs ORDER BY id DESC LIMIT $1", [limit]);
  return rows.map(rowToExecution);
}

export async function countSessions(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM sessions");
  return Number(rows[0]?.n ?? 0);
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: Number(row.id),
    soul: String(row.soul),
    startedAt: String(row.started_at),
    endedAt: row.ended_at == null ? null : String(row.ended_at),
    promptCount: Number(row.prompt_count),
    maxTurns: Number(row.max_turns),
    budgetCap: row.budget_cap == null ? null : Number(row.budget_cap),
  };
}

function rowToExecution(row: Record<string, unknown>): ExecutionLog {
  return {
    id: Number(row.id),
    sessionId: row.session_id == null ? null : Number(row.session_id),
    soul: String(row.soul),
    ts: String(row.ts),
    kind: String(row.kind),
    promptHash: row.prompt_hash == null ? null : String(row.prompt_hash),
    model: row.model == null ? null : String(row.model),
    tier: row.tier == null ? null : String(row.tier),
    filesLoaded: Number(row.files_loaded),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    contextChars: Number(row.context_chars),
    verdict: row.verdict == null ? null : String(row.verdict),
    status: String(row.status),
    note: row.note == null ? null : String(row.note),
  };
}
