import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../index.js";
import { MCP_TOOL_CATALOG } from "@assistente-os/daemon";

/**
 * Guard de drift: o catálogo estático em `packages/daemon/src/routes/catalog.ts`
 * (que alimenta /llms.txt, /api/capabilities e /api/openapi.json) precisa bater
 * com o array `TOOLS` real deste pacote. `daemon` não pode importar `tools`
 * (ciclo), então a checagem mora aqui.
 */

test("MCP_TOOL_CATALOG (daemon) cobre exatamente as TOOLS reais", () => {
  const live = new Set(TOOLS.map((t) => t.name));
  const catalog = new Set(MCP_TOOL_CATALOG.map((t) => t.name));

  const missingNoCatalogo = [...live].filter((n) => !catalog.has(n)).sort();
  const sobrandoNoCatalogo = [...catalog].filter((n) => !live.has(n)).sort();

  assert.deepEqual(
    missingNoCatalogo,
    [],
    `tools reais fora do catálogo do daemon (adicione em routes/catalog.ts): ${missingNoCatalogo.join(", ")}`,
  );
  assert.deepEqual(
    sobrandoNoCatalogo,
    [],
    `catálogo do daemon lista tools que não existem mais (remova de routes/catalog.ts): ${sobrandoNoCatalogo.join(", ")}`,
  );
});

test("cada entrada do catálogo tem family e description não-vazias", () => {
  for (const t of MCP_TOOL_CATALOG) {
    assert.ok(t.family && t.family.length > 0, `tool ${t.name} sem family`);
    assert.ok(t.description && t.description.length > 0, `tool ${t.name} sem description`);
  }
});
