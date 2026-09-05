#!/usr/bin/env node
/**
 * SPEC-EP3 — `npm run dod` (Definition of Done): encadeia a suíte de
 * verificação que normalmente só se descobre quebrada no CI, ~25 minutos
 * depois de abrir o PR. Roda tudo (não para no primeiro erro) e imprime um
 * resumo no fim — a ideia é ver o quadro completo antes de encerrar o turno,
 * não descobrir o 2º problema só depois de corrigir o 1º e rodar de novo.
 *
 * Ordem pedida pelo item original: build → typecheck → test → manifest →
 * discriminator. `lint` foi inserido entre typecheck e test porque virou um
 * gate real de CI (SPEC-EP2 Frente 1) depois que este item foi especificado
 * — deixá-lo de fora seria a suíte de verificação mentir sobre o que o CI
 * de fato checa.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const CLI_ENTRY = "packages/cli/dist/index.js";

/** @type {{ name: string, cmd: string, args: string[], skip?: () => string | undefined }[]} */
const STEPS = [
  { name: "build", cmd: "npm", args: ["run", "build"] },
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { name: "lint", cmd: "npm", args: ["run", "lint"] },
  { name: "test", cmd: "npm", args: ["run", "test"] },
  {
    name: "manifest",
    cmd: "node",
    args: [CLI_ENTRY, "manifest"],
    // Precisa de build (dist/index.js) e Postgres alcançável — sem isso,
    // falhar aqui não é sinal de regressão, é ambiente incompleto.
    skip: () => (existsSync(CLI_ENTRY) ? undefined : `${CLI_ENTRY} não existe — rode depois do build`),
  },
  {
    name: "discriminator",
    cmd: "node",
    args: [CLI_ENTRY, "discriminator"],
    skip: () => (existsSync(CLI_ENTRY) ? undefined : `${CLI_ENTRY} não existe — rode depois do build`),
  },
];

const results = [];
for (const step of STEPS) {
  const skipReason = step.skip?.();
  if (skipReason) {
    console.log(`\n=== ${step.name} (pulado: ${skipReason}) ===`);
    results.push({ name: step.name, status: "skipped" });
    continue;
  }
  console.log(`\n=== ${step.name} ===`);
  const r = spawnSync(step.cmd, step.args, { stdio: "inherit" });
  results.push({ name: step.name, status: r.status === 0 ? "ok" : "fail", code: r.status });
}

console.log("\n=== Resumo (npm run dod) ===");
let anyFail = false;
for (const r of results) {
  const icon = r.status === "ok" ? "✓" : r.status === "skipped" ? "-" : "✗";
  console.log(`  ${icon} ${r.name}${r.status === "fail" ? ` (exit ${r.code})` : ""}`);
  if (r.status === "fail") anyFail = true;
}

if (anyFail) {
  console.error("\nDoD: reprovado — pelo menos uma etapa falhou (ver acima).");
  process.exitCode = 1;
} else {
  console.log("\nDoD: aprovado.");
}
