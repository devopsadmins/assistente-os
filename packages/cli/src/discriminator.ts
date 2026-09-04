/**
 * `os discriminator` — SPEC-GR4: gate de merge no CI. Roda `auditExecution`
 * (Guardian, `packages/core/src/governance/golden-rules.ts`) sobre o diff da
 * branch contra uma base, e sai != 0 se a nota vier abaixo de 95/100 — é
 * literalmente o critério de aceite do item ("CI tem step `Discriminator`
 * que sai != 0 se score < 95, com o JSON do parecer no log/artefato").
 *
 * Backend do julgamento: Zen (cloud) se `ZEN_API_KEY[S]` estiver configurada
 * — é o caso do runner do GitHub Actions, que não tem Ollama local — senão
 * Ollama local, pra rodar o mesmo gate numa máquina de dev.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { auditExecution } from "@assistente-os/core";

// Achado ao vivo: o modelo local padrão (qwen2.5-coder:3b) tem contexto de
// 4096 tokens — um orçamento de 12k chars pro diff sozinho (~3k tokens) já
// deixava pouca margem pro resto do prompt (template + stat + log) e o
// prefill ficava lento demais em CPU. 6k é mais seguro pros dois backends
// (Zen tem contexto maior, mas cortar cedo também ajuda custo/latência lá).
const DIFF_CHAR_BUDGET = 6_000;

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(args: string[]): string {
  try {
    return git(args);
  } catch {
    return "";
  }
}

/** Resumo do diff pra caber no orçamento de contexto do julgamento — commits + stat sempre completos, diff bruto truncado. */
function buildChangesSummary(base: string): string {
  const log = tryGit(["log", `${base}..HEAD`, "--oneline"]);
  const stat = tryGit(["diff", `${base}...HEAD`, "--stat"]);
  let diff = tryGit(["diff", `${base}...HEAD`]);
  if (diff.length > DIFF_CHAR_BUDGET) {
    diff = `${diff.slice(0, DIFF_CHAR_BUDGET)}\n... (diff truncado em ${DIFF_CHAR_BUDGET} caracteres — o resumo por arquivo acima é completo)`;
  }
  const parts: string[] = [];
  if (log) parts.push(`Commits:\n${log}`);
  if (stat) parts.push(`Arquivos alterados:\n${stat}`);
  if (diff) parts.push(`Diff:\n${diff}`);
  return parts.join("\n\n") || `(sem diferença detectada contra ${base})`;
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export async function runDiscriminatorCommand(args: string[]): Promise<number> {
  const base = getFlag(args, "base") ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  const taskId = getFlag(args, "task-id") ?? process.env.GITHUB_SHA ?? tryGit(["rev-parse", "HEAD"]) ?? "local";
  const targetAgent = getFlag(args, "target-agent") ?? process.env.GITHUB_ACTOR ?? tryGit(["log", "-1", "--format=%an"]) ?? "desconhecido";
  const testResults = getFlag(args, "test-results");
  const outPath = getFlag(args, "out");

  const changesSummary = buildChangesSummary(base);
  const result = await auditExecution({ taskId, targetAgent, changesSummary, testResults });
  const verdict = { ...result, taskId, targetAgent, base, ts: new Date().toISOString() };
  const json = JSON.stringify(verdict, null, 2);

  console.log(json);
  if (outPath) writeFileSync(outPath, `${json}\n`, "utf8");

  if (!result.approved) {
    console.error(`\n[discriminator] REPROVADO — score ${result.score}/100 (mínimo 95). ${result.feedback}`);
    return 1;
  }
  console.error(`\n[discriminator] APROVADO — score ${result.score}/100.`);
  return 0;
}
