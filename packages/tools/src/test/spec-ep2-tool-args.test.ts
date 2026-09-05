/**
 * SPEC-EP2 Frente 2 (Fatia 2, 2026-09-05): antes, um argumento de tipo
 * errado numa chamada de tool MCP era ignorado em silêncio pelos `typeof x
 * === "string" ? x : default` de cada handler — nunca rejeitado, mesmo com o
 * `inputSchema` da tool já declarando o tipo certo. `validateToolArgs`
 * (argSchema.ts) converte esse `inputSchema` num schema Zod e valida em
 * `handleToolCall`, antes do handler rodar. Os casos abaixo provam a
 * rejeição — não é suíte exaustiva das ~50 tools, é amostra representativa
 * (ver `tools.test.ts` pros testes funcionais de cada família).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "../index.js";
import { createSoul } from "@assistente-os/core";
import { pointDatabaseUrlAtFreshSchema } from "./pgTestHelper.js";

const prevDatabaseUrl = process.env.DATABASE_URL;

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aos-ep2-tool-args-"));
  createSoul(home, "main", { name: "main", description: "soul principal" });
  return home;
}

test("SPEC-EP2: memory_search com limit de tipo errado (string) é rejeitado com -32602", async () => {
  const home = tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "memory_search", arguments: { soul: "main", query: "x", limit: "5" } },
    });
    assert.equal(res?.result, undefined);
    const error = res?.error as { code?: number; message?: string } | undefined;
    assert.equal(error?.code, -32602);
    assert.match(error?.message ?? "", /limit/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: memory_search sem query (campo obrigatório) é rejeitado", async () => {
  const home = tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "memory_search", arguments: { soul: "main" } },
    });
    const error = res?.error as { code?: number; message?: string } | undefined;
    assert.equal(error?.code, -32602);
    assert.match(error?.message ?? "", /query/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: agenda_add com soul de tipo errado (número) é rejeitado, não silenciosamente ignorado", async () => {
  const home = tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "agenda_add", arguments: { title: "tarefa", soul: 123 } },
    });
    const error = res?.error as { code?: number; message?: string } | undefined;
    assert.equal(error?.code, -32602);
    assert.match(error?.message ?? "", /soul/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-EP2: tool com args corretos continua passando (sem regressão)", async () => {
  const home = tempHome();
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "costs_summary", arguments: {} },
    });
    assert.ok(res?.result, JSON.stringify(res));
  } finally {
    await cleanup();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
});
