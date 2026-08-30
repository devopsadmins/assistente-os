/**
 * `os rag eval` — roda um golden set (query → doc esperado) contra o RAG e
 * imprime hit@k / MRR / recall@5. Evidência de auditoria e comparação
 * off × cross-encoder × llm.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, type AssistenteOsConfig } from "@assistente-os/core";
import { parseGoldenJsonl, runRagEval, formatRagEvalMetrics, scanTextFiles } from "@assistente-os/memory";

/**
 * O índice está defasado se algum .md/.txt da soul tem mtime posterior ao
 * `lastIndexedAt` (MAX(chunks.updated_at)). Sem lastIndexedAt (nunca indexou) e
 * havendo arquivos → defasado.
 */
export function isIndexStale(soulDir: string, lastIndexedAt: string | null): boolean {
  let newest = 0;
  for (const f of scanTextFiles(soulDir)) {
    try {
      newest = Math.max(newest, statSync(f).mtimeMs);
    } catch {
      /* arquivo sumiu no meio da varredura */
    }
  }
  if (newest === 0) return false;
  if (!lastIndexedAt) return true;
  return newest > Date.parse(lastIndexedAt);
}

function sampleGoldenPath(): string {
  // packages/cli/dist/rag.js → packages/memory/eval/rag-golden.sample.jsonl
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "memory", "eval", "rag-golden.sample.jsonl");
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runRagCommand(config: AssistenteOsConfig, args: string[]): Promise<number> {
  const sub = args[0];
  if (sub !== "eval") {
    console.log(
      "uso: os rag eval [<soul>] [--rerank off|cross-encoder|llm] [--file <path>] [--min-hit1 0.7] [--min-refusal 0.8]",
    );
    return 1;
  }

  const soulFilter = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const rerank = getFlag(args, "rerank");
  const fileArg = getFlag(args, "file");
  const minHit1 = Number(getFlag(args, "min-hit1") ?? "0.7");
  const minRefusal = Number(getFlag(args, "min-refusal") ?? "0.8");

  if (rerank) process.env.RAG_RERANK = rerank;

  const file =
    fileArg ??
    (existsSync(join(config.home, "rag-golden.jsonl"))
      ? join(config.home, "rag-golden.jsonl")
      : sampleGoldenPath());

  if (!existsSync(file)) {
    console.error(`golden set não encontrado: ${file}`);
    return 1;
  }

  const { cases } = parseGoldenJsonl(readFileSync(file, "utf8"));
  const selected = soulFilter ? cases.filter((c) => c.soul === soulFilter) : cases;
  if (selected.length === 0) {
    console.error(soulFilter ? `nenhum caso para a soul "${soulFilter}" em ${file}` : `nenhum caso em ${file}`);
    return 1;
  }

  console.log(`rag eval — ${file}`);
  console.log(`casos: ${selected.length}${soulFilter ? ` (soul=${soulFilter})` : ""} · rerank=${process.env.RAG_RERANK ?? "off"}\n`);

  const pool = getPool(config.databaseUrl);
  const m = await runRagEval(pool, selected, { k: 5 });
  console.log(formatRagEvalMetrics(m));

  const fails: string[] = [];
  if (m.hitAt1 < minHit1) {
    fails.push(`hit@1 ${(m.hitAt1 * 100).toFixed(1)}% < mínimo ${(minHit1 * 100).toFixed(1)}%`);
  }
  if (m.nAdversarial > 0 && m.adversarialRefusalRate < minRefusal) {
    fails.push(
      `refusal rate ${(m.adversarialRefusalRate * 100).toFixed(1)}% < mínimo ${(minRefusal * 100).toFixed(1)}%`,
    );
  }
  if (fails.length > 0) {
    for (const f of fails) console.error(`\n✗ ${f}`);
    return 1;
  }
  console.log(`\n✓ hit@1 ${(m.hitAt1 * 100).toFixed(1)}% >= ${(minHit1 * 100).toFixed(1)}%` +
    (m.nAdversarial > 0 ? ` · refusal ${(m.adversarialRefusalRate * 100).toFixed(1)}% >= ${(minRefusal * 100).toFixed(1)}%` : ""));
  return 0;
}
