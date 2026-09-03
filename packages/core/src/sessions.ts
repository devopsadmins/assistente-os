import type { Pool } from "pg";
import { nowIso } from "./costs.js";

export interface SessionRecord {
  id: number;
  soul: string;
  clientKey: string;
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

/**
 * Teto de caracteres do histórico injetado no prompt (env
 * ASSISTENTE_OS_SESSION_HISTORY_MAX_CHARS, default 6000 ≈ 1500 tokens).
 * O contexto default do Ollama é 2048 tokens — sem teto, um histórico
 * longo empurra o system prompt / RAG / a pergunta atual para fora da
 * janela e o modelo "esquece" o que importa. 0 desliga o corte.
 */
export function sessionHistoryMaxChars(): number {
  const n = Number(process.env.ASSISTENTE_OS_SESSION_HISTORY_MAX_CHARS);
  return Number.isFinite(n) && n >= 0 ? n : 6000;
}

export interface HistoryBudget {
  /** Máximo de turnos (usuário+assistente contam como 1 turno cada par). */
  maxTurns: number;
  /** Teto de caracteres somados do conteúdo; corta os turnos mais antigos primeiro. 0/undefined = sem corte. */
  maxChars?: number;
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
  traceId: string | null;
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
  /** Correlaciona esta linha canônica aos spans por estágio (`execution_spans`). */
  traceId?: string;
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
export async function openSession(
  pool: Pool,
  soul: string,
  maxTurns: number,
  budgetCap?: number,
  clientKey = "default",
): Promise<SessionRecord> {
  // Até 3 tentativas: se a sessão concorrente "vencedora" for fechada entre o
  // INSERT (que perde o ON CONFLICT) e o SELECT de fallback, nenhuma sessão
  // aberta existe mais — uma nova tentativa de INSERT deve então ter sucesso.
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await pool.query(
      `INSERT INTO sessions (soul, client_key, started_at, ended_at, prompt_count, max_turns, budget_cap, last_activity_at)
       VALUES ($1, $5, $2, NULL, 0, $3, $4, $2)
       ON CONFLICT (soul, client_key) WHERE ended_at IS NULL DO NOTHING
       RETURNING *`,
      [soul, nowIso(), maxTurns, budgetCap ?? null, clientKey],
    );
    if (inserted.rows[0]) return rowToSession(inserted.rows[0]);
    const { rows } = await pool.query(
      "SELECT * FROM sessions WHERE soul = $1 AND client_key = $2 AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
      [soul, clientKey],
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
/** threadId opcional — quando informado, grava em session_messages.thread_id (é o que GET .../threads/:id/messages lê). Devolve o id da mensagem gravada. */
export async function recordSessionMessage(
  pool: Pool,
  sessionId: number,
  soul: string,
  role: SessionMessage["role"],
  content: string,
  threadId?: number,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO session_messages (session_id, soul, role, content, ts, thread_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [sessionId, soul, role, content, nowIso(), threadId ?? null],
  );
  return Number(rows[0]!.id);
}

/**
 * Últimos turnos da sessão em ordem cronológica, respeitando um orçamento.
 *
 * Aceita um número (só teto de turnos, compat) ou um `HistoryBudget`
 * (`{ maxTurns, maxChars }`). Com `maxChars`, descarta as mensagens mais
 * antigas até o conteúdo somado caber no teto — nunca corta pela metade
 * uma mensagem, e sempre devolve pelo menos a última se ela couber.
 */
export async function getRecentSessionMessages(
  pool: Pool,
  sessionId: number,
  budget: number | HistoryBudget,
): Promise<SessionMessage[]> {
  const { maxTurns, maxChars } = typeof budget === "number" ? { maxTurns: budget, maxChars: undefined } : budget;
  if (maxTurns <= 0) return [];
  const { rows } = await pool.query<{ role: string; content: string }>(
    "SELECT role, content FROM session_messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2",
    [sessionId, maxTurns * 2],
  );
  const msgs = rows.reverse().map((r) => ({ role: r.role as SessionMessage["role"], content: r.content }));
  if (!maxChars || maxChars <= 0) return msgs;
  let total = msgs.reduce((sum, m) => sum + m.content.length, 0);
  while (msgs.length > 1 && total > maxChars) {
    total -= msgs[0]!.content.length;
    msgs.shift();
  }
  return msgs;
}

export async function closeSession(pool: Pool, sessionId: number): Promise<void> {
  await pool.query("UPDATE sessions SET ended_at = $1 WHERE id = $2 AND ended_at IS NULL", [nowIso(), sessionId]);
}

/**
 * Remove trechos de conteúdo do verdict de RAG antes de persistir (E8.4 /
 * gate AI-3: telemetria não vaza contexto). `execution_logs.verdict` é
 * devolvido por `/infra/status` — mantém só `ok`/`motivo` e, por fonte,
 * `path`/`method`/`score`; nunca `snippet`/`body`/`text`.
 */
export function sanitizeVerdictForLog(verdict: string | undefined): string | null {
  if (!verdict) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(verdict);
  } catch {
    return null; // não-JSON: descarta em vez de arriscar vazar texto livre
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = parsed as Record<string, unknown>;
  const sources = Array.isArray(v.sources)
    ? v.sources.map((s) => {
        const src = (s ?? {}) as Record<string, unknown>;
        // `doc` (doc_key: "<path>::<i>") é metadado de proveniência estável — liga
        // a resposta ao chunk exato; não carrega conteúdo, então entra na allowlist.
        return {
          doc: typeof src.doc === "string" ? src.doc : null,
          path: src.path ?? null,
          method: src.method ?? null,
          score: src.score ?? null,
        };
      })
    : undefined;
  return JSON.stringify({
    ok: typeof v.ok === "boolean" ? v.ok : undefined,
    motivo: typeof v.motivo === "string" ? v.motivo : undefined,
    ...(sources ? { sources } : {}),
  });
}

/** Registra UMA execução (contexto montado + turno disparado) de forma imutável. */
export async function recordExecution(pool: Pool, input: ExecutionLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO execution_logs (session_id, soul, ts, kind, prompt_hash, model, tier, files_loaded, tokens_in, tokens_out, context_chars, verdict, status, note, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
      sanitizeVerdictForLog(input.verdict),
      input.status ?? "ok",
      input.note ?? null,
      input.traceId ?? null,
    ],
  );
}

// ── Spans de execução (trace por estágio — Onda 2) ─────────────────────

export interface ExecutionSpan {
  id: number;
  traceId: string;
  soul: string;
  sessionId: number | null;
  ts: string;
  seq: number;
  module: string;
  message: string;
  level: string;
  elapsedMs: number;
}

export interface ExecutionSpanInput {
  traceId: string;
  soul: string;
  sessionId?: number | null;
  seq: number;
  module: string;
  message: string;
  level?: string;
  elapsedMs?: number;
}

/** Grava um span (um estágio do turno). Diagnóstico — não entra em custo/uso. */
export async function recordExecutionSpan(pool: Pool, input: ExecutionSpanInput): Promise<void> {
  await pool.query(
    `INSERT INTO execution_spans (trace_id, soul, session_id, ts, seq, module, message, level, elapsed_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.traceId,
      input.soul,
      input.sessionId ?? null,
      nowIso(),
      input.seq,
      input.module,
      input.message.slice(0, 2000),
      input.level ?? "info",
      Math.max(0, Math.floor(input.elapsedMs ?? 0)),
    ],
  );
}

function rowToSpan(row: Record<string, unknown>): ExecutionSpan {
  return {
    id: Number(row.id),
    traceId: String(row.trace_id),
    soul: String(row.soul),
    sessionId: row.session_id == null ? null : Number(row.session_id),
    ts: String(row.ts),
    seq: Number(row.seq),
    module: String(row.module),
    message: String(row.message),
    level: String(row.level),
    elapsedMs: Number(row.elapsed_ms),
  };
}

/** Reconstrói um turno: a linha canônica + os spans por estágio, em ordem. */
export async function getTrace(
  pool: Pool,
  traceId: string,
): Promise<{ execution: ExecutionLog | null; spans: ExecutionSpan[] }> {
  const [exec, spans] = await Promise.all([
    pool.query("SELECT * FROM execution_logs WHERE trace_id = $1 ORDER BY id DESC LIMIT 1", [traceId]),
    pool.query("SELECT * FROM execution_spans WHERE trace_id = $1 ORDER BY seq ASC", [traceId]),
  ]);
  return {
    execution: exec.rows[0] ? rowToExecution(exec.rows[0]) : null,
    spans: spans.rows.map(rowToSpan),
  };
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
    clientKey: row.client_key == null ? "default" : String(row.client_key),
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
    traceId: row.trace_id == null ? null : String(row.trace_id),
  };
}
