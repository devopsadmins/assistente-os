/**
 * Testes unitários para as tools LangChain do LangGraph.
 *
 * Requer: PostgreSQL (DATABASE_URL no .env).
 * Uso: node --test dist/test/langgraph-tools.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createAgentTools, type CreateToolsOptions } from "../langgraph-tools.js";
import { Pool } from "pg";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_HOME = "/tmp/assistente-os-langgraph-tools-test";
const SOUL_ID = "test-soul";

let pool: Pool;

before(async () => {
  // Mesmo fallback de pgTestHelper.ts — sem DATABASE_URL no ambiente (caso
  // comum ao rodar `npm test` fora de um shell com .env carregado), o pg
  // tentava autenticar com usuário/senha do SO e quebrava com "client
  // password must be a string" antes mesmo de tentar conectar de verdade.
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://assistente_os:assistente_os@localhost:5432/assistente_os",
  });
  mkdirSync(join(TEST_HOME, "souls", SOUL_ID), { recursive: true });
  writeFileSync(join(TEST_HOME, "souls", SOUL_ID, "perfil.md"), "# Perfil\n\nSoul de teste.");
  writeFileSync(join(TEST_HOME, "souls", SOUL_ID, "licoes.md"), "# Licoes\n\nNenhuma licao ainda.");
});

after(async () => {
  await pool.end();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

function opts(): CreateToolsOptions {
  return { home: TEST_HOME, pool, soulId: SOUL_ID };
}

// Sem toolCallId (não é uma chamada real do LLM), StructuredTool.invoke()
// devolve o retorno de func() cru — só serializa pra string quando há um
// toolCallId de verdade (ver _formatToolOutput em @langchain/core/tools).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke(tool: any, args: Record<string, unknown>): Promise<any> {
  const raw = await tool.invoke(args);
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

describe("LangGraph tools (unit)", () => {
  it("createAgentTools retorna array de tools", () => {
    const tools = createAgentTools(opts());
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it("tools tem nome, descricao e schema", () => {
    const tools = createAgentTools(opts());
    for (const t of tools) {
      assert.ok(typeof t.name === "string");
      assert.ok(typeof t.description === "string");
      assert.ok(t.schema);
    }
  });

  it("inclui todas as 11 tools", () => {
    const tools = createAgentTools(opts());
    const names = tools.map((t) => t.name) as string[];
    const expected = ["memory_search", "memory_index", "memory_status", "graph_list", "observation_add", "soul_anotar", "soul_licao", "soul_decidir", "agenda_add", "agenda_list", "costs_summary"];
    for (const n of expected) {
      assert.ok(names.includes(n), `falta tool: ${n}`);
    }
  });

  it("memory_status retorna stats", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "memory_status")!;
    const result = await invoke(t, {});
    assert.ok(result.chunks !== undefined);
    assert.ok(result.graph !== undefined);
  });

  it("graph_list retorna entidades e relacoes", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "graph_list")!;
    const result = await invoke(t, {});
    assert.ok(Array.isArray(result.entities));
    assert.ok(Array.isArray(result.relations));
  });

  it("soul_anotar cria anotacao", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "soul_anotar")!;
    const result = await invoke(t, { texto: "Teste tool-calling" });
    assert.equal(result.ok, true);
  });

  it("soul_licao cria licao", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "soul_licao")!;
    const result = await invoke(t, { texto: "Licao de teste" });
    assert.equal(result.ok, true);
  });

  it("soul_decidir cria ADR", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "soul_decidir")!;
    const result = await invoke(t, {
      titulo: "Decisao de teste",
      contexto: "Testando tools",
      decisao: "Usar LangGraph",
    });
    assert.equal(result.ok, true);
  });

  it("agenda_list retorna array", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "agenda_list")!;
    const result = await invoke(t, { status: "pending" });
    assert.ok(Array.isArray(result));
  });

  it("costs_summary retorna spent e recent", async () => {
    const tools = createAgentTools(opts());
    const t = tools.find((x) => x.name === "costs_summary")!;
    const result = await invoke(t, {});
    assert.ok("spent" in result);
    assert.ok("recent" in result);
  });
});
