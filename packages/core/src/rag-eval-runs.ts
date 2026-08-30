/**
 * Histórico de runs de avaliação de RAG (E12b). Persiste o resultado de
 * `os rag eval` (offline) e da amostragem online do chat, para rastrear drift
 * de qualidade ao longo do tempo. Sem conteúdo — só métricas e contagens.
 */
import type { Pool } from "pg";

export interface RagEvalRunInput {
  soul?: string | null;
  kind?: "offline" | "online";
  n?: number;
  hitAt1?: number | null;
  hitAt3?: number | null;
  hitAt5?: number | null;
  mrr?: number | null;
  recallAt5?: number | null;
  adversarialRefusalRate?: number | null;
  faithfulnessSupported?: number | null;
  note?: string | null;
}

export interface RagEvalRun extends Required<Omit<RagEvalRunInput, "note">> {
  id: number;
  ts: string;
  note: string | null;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function recordRagEvalRun(pool: Pool, input: RagEvalRunInput): Promise<void> {
  await pool.query(
    `INSERT INTO rag_eval_runs
       (soul, kind, n, hit_at_1, hit_at_3, hit_at_5, mrr, recall_at_5, adversarial_refusal_rate, faithfulness_supported, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.soul ?? null,
      input.kind ?? "offline",
      Math.max(0, Math.floor(input.n ?? 0)),
      input.hitAt1 ?? null,
      input.hitAt3 ?? null,
      input.hitAt5 ?? null,
      input.mrr ?? null,
      input.recallAt5 ?? null,
      input.adversarialRefusalRate ?? null,
      input.faithfulnessSupported ?? null,
      input.note ?? null,
    ],
  );
}

export async function listRagEvalRuns(pool: Pool, soul?: string, limit = 20): Promise<RagEvalRun[]> {
  const { rows } = soul
    ? await pool.query("SELECT * FROM rag_eval_runs WHERE soul = $1 ORDER BY id DESC LIMIT $2", [soul, limit])
    : await pool.query("SELECT * FROM rag_eval_runs ORDER BY id DESC LIMIT $1", [limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    ts: String(r.ts),
    soul: r.soul == null ? null : String(r.soul),
    kind: String(r.kind) as "offline" | "online",
    n: Number(r.n),
    hitAt1: numOrNull(r.hit_at_1),
    hitAt3: numOrNull(r.hit_at_3),
    hitAt5: numOrNull(r.hit_at_5),
    mrr: numOrNull(r.mrr),
    recallAt5: numOrNull(r.recall_at_5),
    adversarialRefusalRate: numOrNull(r.adversarial_refusal_rate),
    faithfulnessSupported: numOrNull(r.faithfulness_supported),
    note: r.note == null ? null : String(r.note),
  }));
}
