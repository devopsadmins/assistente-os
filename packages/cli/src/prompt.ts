/**
 * `os prompt list | show <id>` — inspeção do Prompt Garden
 * (`packages/core/src/prompts/garden/`). Etapa 5 do refino.
 */
import { GARDEN, promptHash } from "@assistente-os/core";

export function runPromptCommand(args: string[]): number {
  const sub = args[0];

  if (sub === "list" || sub === undefined) {
    const rows = [...GARDEN]
      .map((p) => ({ id: p.id, versao: p.versao, hash: promptHash(p).slice(0, 12) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const idW = Math.max(4, ...rows.map((r) => r.id.length));
    console.log(`${"id".padEnd(idW)}  ver  hash`);
    for (const r of rows) {
      console.log(`${r.id.padEnd(idW)}  ${String(r.versao).padStart(3)}  ${r.hash}`);
    }
    console.log(`\n${rows.length} prompt(s). "os prompt show <id>" para o detalhe.`);
    return 0;
  }

  if (sub === "show") {
    const id = args[1];
    if (!id) {
      console.log("uso: os prompt show <id>");
      return 1;
    }
    const p = GARDEN.find((x) => x.id === id);
    if (!p) {
      console.error(`prompt não encontrado: ${id} (veja "os prompt list")`);
      return 1;
    }
    console.log(`# ${p.id}  (v${p.versao})`);
    console.log(`hash:        ${promptHash(p)}`);
    console.log(`papel:       ${p.papel}`);
    console.log(`objetivo:    ${p.objetivo}`);
    console.log(`regras:`);
    for (const r of p.regras) console.log(`  - ${r}`);
    console.log(`formatoSaida: ${p.formatoSaida}`);
    if (p.outputSchema !== undefined) console.log(`outputSchema: ${p.outputSchema}`);
    console.log(`\n--- template ---\n${p.template}`);
    return 0;
  }

  console.log("uso: os prompt [list | show <id>]");
  return 1;
}
