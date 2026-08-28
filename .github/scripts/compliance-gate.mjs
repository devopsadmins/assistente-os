#!/usr/bin/env node
/**
 * Wrapper de CI do gate de compliance. Lê o evento `pull_request` do GitHub
 * (`GITHUB_EVENT_PATH`) e o diff `base...head`, delega a decisão para
 * `evaluateCompliance` e sai com código 1 se houver pendências.
 *
 * Fora de um evento de pull_request (push, workflow_dispatch) o gate é ignorado.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateCompliance } from "./compliance-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function readEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`aviso: não consegui ler GITHUB_EVENT_PATH (${err.message})`);
    return null;
  }
}

function changedFiles(baseSha, headSha) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], {
      encoding: "utf8",
      cwd: join(here, "..", ".."),
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.error(`aviso: não consegui calcular o diff ${baseSha}...${headSha} (${err.message})`);
    return [];
  }
}

const event = readEvent();
const pr = event?.pull_request;
if (!pr) {
  console.log("Sem pull_request no evento — gate de compliance ignorado.");
  process.exit(0);
}

const baseSha = pr.base?.sha;
const headSha = pr.head?.sha;
const files = baseSha && headSha ? changedFiles(baseSha, headSha) : [];

const violations = evaluateCompliance({ body: pr.body ?? "", changedFiles: files });

console.log(`PR #${pr.number} — ${files.length} arquivo(s) alterado(s)`);

if (violations.length === 0) {
  console.log("\n✓ Gate de compliance: OK");
  process.exit(0);
}

console.error("\n✗ Gate de compliance — pendências:\n");
for (const v of violations) console.error(`  • ${v}`);
console.error("\nAjuste a descrição do PR (ver .github/pull_request_template.md).");
process.exit(1);
