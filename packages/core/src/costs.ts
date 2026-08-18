import type { Pool } from "pg";

export interface CostCallInput {
  soul: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  status?: string;
  note?: string;
}

export interface CostCall extends CostCallInput {
  id: number;
  ts: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Registra UMA chamada de custo de forma IMUTÁVEL:
 * a linha nunca é alterada; correções viram novas linhas com status/note.
 */
export async function recordCostCall(pool: Pool, input: CostCallInput): Promise<CostCall> {
  const ts = nowIso();
  const { rows } = await pool.query(
    `INSERT INTO cost_calls (ts, soul, provider, model, input_tokens, output_tokens, cost, status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [ts, input.soul, input.provider, input.model, input.inputTokens, input.outputTokens, input.cost, input.status ?? "ok", input.note ?? null],
  );
  return rowToCostCall(rows[0]);
}

export async function sumCostBySoul(pool: Pool, soul: string, sinceIso?: string): Promise<number> {
  const { rows } = sinceIso
    ? await pool.query<{ s: number | null }>("SELECT SUM(cost) AS s FROM cost_calls WHERE soul = $1 AND ts >= $2", [soul, sinceIso])
    : await pool.query<{ s: number | null }>("SELECT SUM(cost) AS s FROM cost_calls WHERE soul = $1", [soul]);
  return rows[0]?.s ?? 0;
}

export async function recentCalls(pool: Pool, soul: string, limit = 20): Promise<CostCall[]> {
  const { rows } = await pool.query("SELECT * FROM cost_calls WHERE soul = $1 ORDER BY id DESC LIMIT $2", [soul, limit]);
  return rows.map(rowToCostCall);
}

function rowToCostCall(row: Record<string, unknown>): CostCall {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    soul: String(row.soul),
    provider: String(row.provider),
    model: String(row.model),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cost: Number(row.cost),
    status: String(row.status),
    note: row.note == null ? undefined : String(row.note),
  };
}
