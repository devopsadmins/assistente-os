/**
 * Avaliação de qualidade de recuperação do RAG (Epic C).
 *
 * "Adicionamos um reranker" não é auditável sem número. Este runner roda um
 * conjunto rotulado (query → documento(s) esperado(s)) contra `retrieveContext`
 * e devolve hit@k / MRR / recall@5 — evidência de auditoria e gate de regressão.
 *
 * Formato do golden set (`.jsonl`, uma linha por objeto):
 *   {"kind":"doc","path":"api/patterns.md","body":"# ...\n\n..."}   ← só na fixture de CI
 *   {"kind":"case","id":"api-dao","soul":"consultoria_ia","query":"padrão de DAO multi-tenant",
 *    "expect_path_substr":["hub-api-patterns.md"],"min_top1_score":0.5}
 *
 * O runner NÃO indexa nada — assume que a soul de cada caso já está indexada
 * (`os memory <soul> index`). A fixture de CI monta um corpus toy e indexa antes.
 */
import type { Pool } from "@assistente-os/core";
import { retrieveContext } from "./rag-chain.js";

export interface RagEvalCase {
  id: string;
  soul: string;
  query: string;
  /** Substrings de path — o caso "acerta" se alguma casar um path recuperado. */
  expect_path_substr: string[];
  /** Opcional: exige score mínimo do 1º resultado (senão conta como miss de hit@1). */
  min_top1_score?: number;
}

export interface RagEvalDoc {
  path: string;
  body: string;
}

export interface RagEvalMetrics {
  n: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  /** Mean Reciprocal Rank (1/rank do primeiro acerto; 0 se não achou no top-k). */
  mrr: number;
  /** Média por caso de |expect casados no top-5| / |expect|. */
  recallAt5: number;
  failures: Array<{ id: string; query: string; got: string[] }>;
}

/** Divide o `.jsonl` em docs (fixture) e casos. Linhas em branco / `//` são ignoradas. */
export function parseGoldenJsonl(text: string): { docs: RagEvalDoc[]; cases: RagEvalCase[] } {
  const docs: RagEvalDoc[] = [];
  const cases: RagEvalCase[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.kind === "doc" && typeof obj.path === "string" && typeof obj.body === "string") {
      docs.push({ path: obj.path, body: obj.body });
      continue;
    }
    // default: caso (kind ausente ou "case")
    if (typeof obj.id !== "string" || typeof obj.soul !== "string" || typeof obj.query !== "string") {
      throw new Error(`linha de caso inválida no golden set: ${line.slice(0, 120)}`);
    }
    if (!Array.isArray(obj.expect_path_substr) || obj.expect_path_substr.some((s) => typeof s !== "string")) {
      throw new Error(`caso ${obj.id}: expect_path_substr deve ser string[]`);
    }
    cases.push({
      id: obj.id,
      soul: obj.soul,
      query: obj.query,
      expect_path_substr: obj.expect_path_substr as string[],
      min_top1_score: typeof obj.min_top1_score === "number" ? obj.min_top1_score : undefined,
    });
  }
  return { docs, cases };
}

function firstHitRank(paths: string[], expect: string[]): number {
  for (let i = 0; i < paths.length; i++) {
    if (expect.some((e) => paths[i]!.includes(e))) return i + 1;
  }
  return 0;
}

export async function runRagEval(
  pool: Pool,
  cases: RagEvalCase[],
  opts: { k?: number } = {},
): Promise<RagEvalMetrics> {
  const k = opts.k ?? 5;
  let hit1 = 0;
  let hit3 = 0;
  let hit5 = 0;
  let rrSum = 0;
  let recallSum = 0;
  const failures: RagEvalMetrics["failures"] = [];

  for (const c of cases) {
    const ctx = await retrieveContext(pool, c.soul, c.query, k);
    const paths = ctx.sources.map((s) => s.path);
    const rank = firstHitRank(paths, c.expect_path_substr);
    const top1ScoreOk =
      c.min_top1_score === undefined || (ctx.sources[0]?.score ?? 0) >= c.min_top1_score;

    if (rank === 1 && top1ScoreOk) hit1++;
    if (rank >= 1 && rank <= 3) hit3++;
    if (rank >= 1 && rank <= 5) hit5++;
    rrSum += rank > 0 ? 1 / rank : 0;

    const matched = new Set(
      c.expect_path_substr.filter((e) => paths.slice(0, 5).some((p) => p.includes(e))),
    );
    recallSum += c.expect_path_substr.length > 0 ? matched.size / c.expect_path_substr.length : 0;

    if (rank === 0) failures.push({ id: c.id, query: c.query, got: paths });
  }

  const n = cases.length || 1;
  return {
    n: cases.length,
    hitAt1: hit1 / n,
    hitAt3: hit3 / n,
    hitAt5: hit5 / n,
    mrr: rrSum / n,
    recallAt5: recallSum / n,
    failures,
  };
}

/** Tabela legível para o CLI. */
export function formatRagEvalMetrics(m: RagEvalMetrics): string {
  const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + "%";
  const lines = [
    `casos:      ${m.n}`,
    `hit@1:     ${pct(m.hitAt1)}`,
    `hit@3:     ${pct(m.hitAt3)}`,
    `hit@5:     ${pct(m.hitAt5)}`,
    `MRR:        ${m.mrr.toFixed(3)}`,
    `recall@5:  ${pct(m.recallAt5)}`,
  ];
  if (m.failures.length > 0) {
    lines.push("", "falhas (nenhum doc esperado no top-5):");
    for (const f of m.failures) lines.push(`  - [${f.id}] "${f.query}" → ${f.got.join(", ") || "(nada)"}`);
  }
  return lines.join("\n");
}
