import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_FAMILIES } from "../mcp/kernel.js";
import { MCP_TOOL_CATALOG } from "../routes/catalog.js";

/**
 * Desde a Fase 2 (realocação do kernel MCP pra dentro do daemon),
 * `MCP_TOOL_CATALOG` é DERIVADO de `TOOLS` (`routes/catalog.ts`) — não tem
 * mais como divergir em nome/quantidade, então o que sobra pra verificar é a
 * própria fonte: nenhuma tool caindo no fallback silencioso "misc" de
 * `TOOL_FAMILIES` por esquecimento em `TOOL_FAMILIES_TABLE` (`mcp/kernel.ts`),
 * e nenhum nome duplicado entre famílias.
 */

test("toda tool tem uma família própria em TOOL_FAMILIES_TABLE (nenhuma cai no fallback 'misc' por esquecimento)", () => {
  const semFamiliaExplicita = TOOLS.filter((t) => TOOL_FAMILIES[t.name] === undefined).map((t) => t.name);
  assert.deepEqual(
    semFamiliaExplicita,
    [],
    `tools sem entrada em TOOL_FAMILIES_TABLE (mcp/kernel.ts): ${semFamiliaExplicita.join(", ")}`,
  );
});

test("nenhum nome de tool duplicado entre famílias", () => {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const t of TOOLS) {
    if (seen.has(t.name)) dup.push(t.name);
    seen.add(t.name);
  }
  assert.deepEqual(dup, [], `tool(s) com nome duplicado: ${dup.join(", ")}`);
});

test("MCP_TOOL_CATALOG tem a mesma contagem e cada entrada tem family/description não-vazias", () => {
  assert.equal(MCP_TOOL_CATALOG.length, TOOLS.length);
  for (const t of MCP_TOOL_CATALOG) {
    assert.ok(t.family && t.family.length > 0, `tool ${t.name} sem family`);
    assert.ok(t.description && t.description.length > 0, `tool ${t.name} sem description`);
  }
});
