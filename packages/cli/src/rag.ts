/**
 * `os rag eval` — roda um golden set (query → doc esperado) contra o RAG e
 * imprime hit@k / MRR / recall@5. Evidência de auditoria e comparação
 * off × cross-encoder × llm.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, recordRagEvalRun, listRagEvalRuns, type AssistenteOsConfig } from "@assistente-os/core";
import {
  parseGoldenJsonl,
  runRagEval,
  runFaithfulnessEval,
  formatRagEvalMetrics,
  scanTextFiles,
  type RagGenerate,
} from "@assistente-os/memory";

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

/** `RagGenerate` via Ollama `/api/chat` (não-streaming). Ancorado no contexto. */
function ollamaGenerate(config: AssistenteOsConfig): RagGenerate {
  return async (snippets, question) => {
    const sys =
      "Responda à pergunta usando SÓ o contexto abaixo. Se o contexto não cobrir, diga que não há evidência suficiente. Não use conhecimento externo.";
    const user = `Contexto:\n${snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n")}\n\nPergunta: ${question}`;
    const url = config.ollamaUrl.replace(/\/$/, "");
    const r = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: config.ollamaChatModel.replace(/^(ollama|openai)\//, ""),
        stream: false,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data = (await r.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  };
}

async function ragHistory(config: AssistenteOsConfig, soul?: string): Promise<number> {
  const pool = getPool(config.databaseUrl);
  const runs = await listRagEvalRuns(pool, soul, 30);
  if (runs.length === 0) {
    console.log("(nenhum run de rag eval registrado)");
    return 0;
  }
  const pct = (x: number | null) => (x == null ? "  -  " : (x * 100).toFixed(1).padStart(5) + "%");
  console.log("ts                        soul            kind      n   hit@1  hit@5  MRR    recall refusal faith");
  for (const r of runs) {
    console.log(
      `${r.ts.slice(0, 19)}  ${(r.soul ?? "-").padEnd(14)}  ${r.kind.padEnd(8)}  ${String(r.n).padStart(3)}  ` +
        `${pct(r.hitAt1)} ${pct(r.hitAt5)} ${(r.mrr ?? 0).toFixed(3)}  ${pct(r.recallAt5)} ${pct(r.adversarialRefusalRate)} ${pct(r.faithfulnessSupported)}`,
    );
  }
  return 0;
}

export async function runRagCommand(config: AssistenteOsConfig, args: string[]): Promise<number> {
  const sub = args[0];
  if (sub !== "eval") {
    console.log(
      "uso: os rag eval [<soul>] [--rerank off|cross-encoder|llm] [--file <path>] [--min-hit1 0.7] [--min-refusal 0.8] [--faithfulness] [--record] [--history]",
    );
    return 1;
  }

  const soulFilter = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  if (args.includes("--history")) return ragHistory(config, soulFilter);

  const rerank = getFlag(args, "rerank");
  const fileArg = getFlag(args, "file");
  const minHit1 = Number(getFlag(args, "min-hit1") ?? "0.7");
  const minRefusal = Number(getFlag(args, "min-refusal") ?? "0.8");
  const withFaithfulness = args.includes("--faithfulness");
  const record = args.includes("--record");

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

  let faithSupported: number | null = null;
  if (withFaithfulness) {
    try {
      const f = await runFaithfulnessEval(pool, selected, ollamaGenerate(config), { k: 5 });
      faithSupported = f.meanSupported;
      console.log(`\nfidelidade (resposta gerada · Ollama): ${(f.meanSupported * 100).toFixed(1)}% em ${f.evaluated} caso(s)`);
      for (const l of f.low) console.log(`  - [${l.id}] supported ${l.supported} · não sustentado: ${l.unsupported.join(" | ")}`);
    } catch (err) {
      console.error(`\n(fidelidade pulada — Ollama indisponível: ${(err as Error).message})`);
    }
  }

  if (record) {
    await recordRagEvalRun(pool, {
      soul: soulFilter ?? null,
      kind: "offline",
      n: m.n,
      hitAt1: m.hitAt1,
      hitAt3: m.hitAt3,
      hitAt5: m.hitAt5,
      mrr: m.mrr,
      recallAt5: m.recallAt5,
      adversarialRefusalRate: m.nAdversarial > 0 ? m.adversarialRefusalRate : null,
      faithfulnessSupported: faithSupported,
      note: `rerank=${process.env.RAG_RERANK ?? "off"}; file=${file}`,
    });
    console.log("\n(run registrado em rag_eval_runs — `os rag eval --history` para o histórico)");
  }

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
