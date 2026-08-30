/**
 * Score de confiança multi-sinal da recuperação (E11).
 *
 * Antes só havia a similaridade do 1º chunk + o gate de relevância binário.
 * Aqui combinamos, de forma heurística (sem ML), três sinais:
 *  - **topScore**    — similaridade/rerank do melhor chunk (âncora).
 *  - **concord**     — quantas fontes independentes acima de um piso concordam
 *                      (0..1, satura em `concordTarget` fontes).
 *  - **freshness**   — idade do chunk mais recente; índice velho reduz confiança.
 *
 * `score = 0.6·topScore + 0.25·concord + 0.15·(1 − freshnessPenalty)`.
 *
 * Envs (todas opcionais):
 *  - `AOS_RAG_CONCORD_FLOOR`  (default 0.5)  — score mínimo p/ uma fonte "contar".
 *  - `AOS_RAG_CONCORD_TARGET` (default 3)    — nº de fontes concordantes = sinal cheio.
 *  - `AOS_RAG_STALE_DAYS`     (default 365)  — idade em que a penalidade de freshness satura em 1.
 */
import type { RagChunk } from "./rag-chain.js";

export interface RagConfidenceSignals {
  topScore: number;
  concord: number;
  freshnessDays: number | null;
  freshnessPenalty: number;
}

export interface RagConfidence {
  score: number;
  level: "high" | "medium" | "low";
  signals: RagConfidenceSignals;
}

export interface RagConfidenceOpts {
  concordFloor?: number;
  concordTarget?: number;
  staleDays?: number;
  now?: number;
}

function num(env: string | undefined, def: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function computeRagConfidence(sources: RagChunk[], opts: RagConfidenceOpts = {}): RagConfidence {
  const concordFloor = opts.concordFloor ?? num(process.env.AOS_RAG_CONCORD_FLOOR, 0.5);
  const concordTarget = opts.concordTarget ?? num(process.env.AOS_RAG_CONCORD_TARGET, 3);
  const staleDays = opts.staleDays ?? num(process.env.AOS_RAG_STALE_DAYS, 365);
  const now = opts.now ?? Date.now();

  if (sources.length === 0) {
    return {
      score: 0,
      level: "low",
      signals: { topScore: 0, concord: 0, freshnessDays: null, freshnessPenalty: 0 },
    };
  }

  const topScore = clamp01(sources[0]?.score ?? 0);

  const agreeing = sources.filter((s) => (s.score ?? 0) >= concordFloor).length;
  const concord = clamp01(agreeing / concordTarget);

  const stamps = sources
    .map((s) => (s.indexedAt ? Date.parse(s.indexedAt) : NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  const newest = stamps.length ? Math.max(...stamps) : null;
  const freshnessDays = newest === null ? null : Math.max(0, (now - newest) / 86_400_000);
  const freshnessPenalty = freshnessDays === null ? 0 : clamp01(freshnessDays / staleDays);

  const score = clamp01(0.6 * topScore + 0.25 * concord + 0.15 * (1 - freshnessPenalty));
  const level: RagConfidence["level"] = score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low";

  return { score, level, signals: { topScore, concord, freshnessDays, freshnessPenalty } };
}

/** Piso de confiança abaixo do qual o chat entra em "evidência insuficiente" (`AOS_RAG_MIN_CONFIDENCE`, default 0 = desligado). */
export function ragMinConfidence(): number {
  const n = Number(process.env.AOS_RAG_MIN_CONFIDENCE);
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : 0;
}
