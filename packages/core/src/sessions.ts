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
  lastActivityAt: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

/** Inatividade após a qual a sessão aberta é considerada encerrada (env ASSISTENTE_OS_SESSION_IDLE_MINUTES, default 120min). */
export function sessionIdleTimeoutMinutes(): number {
  const n = Number(process.env.ASSISTENTE_OS_SESSION_IDLE_MINUTES);
  return Number.isFinite(n) && n >= 0 ? n : 120;
}

/** Turnos recentes (usuário+assistente) incluídos como histórico no prompt (env ASSISTENTE_OS_SESSION_HISTORY_TURNS, default 6). */
export function sessionHistoryTurns(): number {
  const n = Number(process.env.ASSISTENTE_OS_SESSION_HISTORY_TURNS);
  return Number.isFinite(n) && n >= 0 ? n : 6;
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
 *
 * Rotação por inatividade: closeSession() nunca é chamado em produção, então
 * sem isso a sessão aberta duraria pra sempre — uma soul que ultrapassasse
 * maxTurns uma vez ficaria travada com 429 em todo chat futuro. Se a sessão
 * aberta está inativa há mais que sessionIdleTimeoutMinutes(), fecha e abre
 * uma nova (zera prompt_count e o histórico de mensagens visível).
 */
export async function openSession(pool: Pool, soul: string, maxTurns: number, budgetCap?: number): Promise<SessionRecord> {
  // Até 3 tentativas: se a sessão concorrente "vencedora" for fechada entre o
  // INSERT (que perde o ON CONFLICT) e o SELECT de fallback, nenhuma sessão
  // aberta existe mais — uma nova tentativa de INSERT deve então ter sucesso.
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await pool.query(
      `INSERT INTO sessions (soul, started_at, ended_at, prompt_count, max_turns, budget_cap, last_activity_at)
       VALUES ($1, $2, NULL, 0, $3, $4, $2)
       ON CONFLICT (soul) WHERE ended_at IS NULL DO NOTHING
       RETURNING *`,
      [soul, nowIso(), maxTurns, budgetCap ?? null],
    );
    if (inserted.rows[0]) return rowToSession(inserted.rows[0]);
    const { rows } = await pool.query(
      "SELECT * FROM sessions WHERE soul = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
      [soul],
    );
    const existing = rows[0];
    if (existing) {
      const idleMs = Date.now() - new Date(String(existing.last_activity_at)).getTime();
      if (idleMs > sessionIdleTimeoutMinutes() * 60_000) {
        await closeSession(pool, Number(existing.id));
        continue; // próxima iteração: sem sessão aberta, o INSERT acima cria uma nova.
      }
      return rowToSession(existing);
    }
  }
  throw new Error(`openSession: não foi possível abrir/recuperar sessão para soul '${soul}' após concorrência repetida`);
}

/** Incrementa o contador de prompts da sessão (e marca atividade) e devolve o total usado. */
export async function bumpSessionPrompt(pool: Pool, sessionId: number): Promise<number> {
  const { rows } = await pool.query<{ prompt_count: number }>(
    "UPDATE sessions SET prompt_count = prompt_count + 1, last_activity_at = $2 WHERE id = $1 RETURNING prompt_count",
    [sessionId, nowIso()],
  );
  return Number(rows[0]?.prompt_count ?? 0);
}

/** Grava um turno (usuário ou assistente) da conversa, associado à sessão. */
export async function recordSessionMessage(
  pool: Pool,
  sessionId: number,
  soul: string,
  role: SessionMessage["role"],
  content: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO session_messages (session_id, soul, role, content, ts) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, soul, role, content, nowIso()],
  );
}

/** Últimos `turns` turnos (até turns*2 mensagens) da sessão, em ordem cronológica. */
export async function getRecentSessionMessages(pool: Pool, sessionId: number, turns: number): Promise<SessionMessage[]> {
  if (turns <= 0) return [];
  const { rows } = await pool.query<{ role: string; content: string }>(
    "SELECT role, content FROM session_messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2",
    [sessionId, turns * 2],
  );
  return rows.reverse().map((r) => ({ role: r.role as SessionMessage["role"], content: r.content }));
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
    lastActivityAt: String(row.last_activity_at),
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
