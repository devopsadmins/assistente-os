/**
 * `os rag eval` — roda um golden set (query → doc esperado) contra o RAG e
 * imprime hit@k / MRR / recall@5. Evidência de auditoria e comparação
 * off × cross-encoder × llm.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, type AssistenteOsConfig } from "@assistente-os/core";
import { parseGoldenJsonl, runRagEval, formatRagEvalMetrics } from "@assistente-os/memory";

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
    console.log("uso: os rag eval [<soul>] [--rerank off|cross-encoder|llm] [--file <path>] [--min-hit1 0.7]");
    return 1;
  }

  const soulFilter = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const rerank = getFlag(args, "rerank");
  const fileArg = getFlag(args, "file");
  const minHit1 = Number(getFlag(args, "min-hit1") ?? "0.7");

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

  if (m.hitAt1 < minHit1) {
    console.error(`\n✗ hit@1 ${(m.hitAt1 * 100).toFixed(1)}% < mínimo ${(minHit1 * 100).toFixed(1)}%`);
    return 1;
  }
  console.log(`\n✓ hit@1 ${(m.hitAt1 * 100).toFixed(1)}% >= mínimo ${(minHit1 * 100).toFixed(1)}%`);
  return 0;
}
