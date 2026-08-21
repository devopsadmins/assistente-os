import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { McpServer, SERVER_NAME } from "../index.js";
import { createSoul, todayISODate } from "@assistente-os/core";
import { pointDatabaseUrlAtFreshSchema } from "./pgTestHelper.js";

const prevDatabaseUrl = process.env.DATABASE_URL;
const dbCleanups: (() => Promise<void>)[] = [];
after(async () => {
  await Promise.all(dbCleanups.map((fn) => fn()));
  if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDatabaseUrl;
});

async function tempHome(): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "aos-mcp-"));
  createSoul(home, "main", { name: "main", description: "soul principal" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await pointDatabaseUrlAtFreshSchema();
  dbCleanups.push(cleanup);
  return home;
}

test("mcp: initialize responde capabilities", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const result = res?.result as { serverInfo?: { name: string }; capabilities?: { tools?: object } };
    assert.equal(result.serverInfo?.name, SERVER_NAME);
    assert.ok(result.capabilities?.tools);
    assert.ok(res?.id === 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list retorna ferramentas", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const expected of ["souls_list", "soul_context", "soul_chat", "memory_search", "memory_index", "memory_status", "graph_list", "costs_summary", "router_status"]) {
      assert.ok(names.includes(expected), `ferramenta ausente: ${expected}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: souls_list retorna souls", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "souls_list", arguments: {} } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "[]") as { id: string }[];
    assert.deepEqual(parsed.map((s) => s.id), ["main"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_context retorna perfil concatenado", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "soul_context", arguments: { soul: "main" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { context: string };
    assert.ok(parsed.context.includes("assistente principal"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul desconhecida responde erro", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "soul_context", arguments: { soul: "x" } } });
    assert.ok(res?.error, "esperava erro");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul com path traversal (../) é rejeitada, não escapa souls/", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "soul_context", arguments: { soul: "../../../etc" } },
    });
    assert.ok(res?.error, "esperava erro para soul com path traversal");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: ping responde ok e notificação não tem resposta", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const pong = await server.handleMessage({ jsonrpc: "2.0", id: 6, method: "ping" });
    assert.deepEqual(pong?.result, {});
    const notif = await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(notif, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: stdio real responde initialize e tools/list", async () => {
  const home = await tempHome();
  const child = spawn(process.execPath, [join(import.meta.dirname, "..", "..", "dist", "index.js")], {
    env: { ...process.env, ASSISTENTE_OS_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    let out = "";
    const done = new Promise<void>((resolve) => child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
      if (out.split("\n").filter(Boolean).length >= 2) resolve();
    }));
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    child.stdin.end();
    await done;
    const lines = out.split("\n").filter(Boolean);
    const init = JSON.parse(lines[0] ?? "{}") as { result?: { serverInfo?: { name: string } } };
    assert.equal(init.result?.serverInfo?.name, SERVER_NAME);
    const list = JSON.parse(lines[1] ?? "{}") as { result?: { tools?: unknown[] } };
    assert.ok((list.result?.tools?.length ?? 0) > 0);
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: tools/list inclui tools de alma e veredito de busca", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/list" });
    const tools = (res?.result as { tools?: { name: string }[] }).tools ?? [];
    const names = tools.map((t) => t.name);
    for (const expected of ["soul_anotar", "soul_licao", "soul_decidir"]) {
      assert.ok(names.includes(expected), `ferramenta ausente: ${expected}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_anotar grava sessão do dia", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "soul_anotar", arguments: { soul: "main", texto: "teste de anotação" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
     const parsed = JSON.parse(content[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
     assert.equal(parsed.ok, true);
     const fs = await import("node:fs");
     const { basename, dirname } = await import("node:path");
     assert.equal(basename(parsed.arquivo), `${todayISODate()}.md`);
     assert.equal(basename(dirname(parsed.arquivo)), "sessoes");
     assert.ok(fs.existsSync(parsed.arquivo));
     const fileBody = fs.readFileSync(parsed.arquivo, "utf8");
     assert.ok(fileBody.includes("teste de anotação"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_licao grava licoes.md", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "soul_licao", arguments: { soul: "main", texto: "nunca confiar em defaults não testados" } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
    assert.equal(parsed.ok, true);
    assert.match(parsed.arquivo, /licoes\.md$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: soul_decidir grava ADR e duplicata falha", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const call = (titulo: string) =>
      server.handleMessage({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "soul_decidir", arguments: { soul: "main", titulo, contexto: "ctx", decisao: "dec", alternativas: "a, b", consequencias: "c" } },
      });
    const first = await call("usar gate de relevância");
    const fc = (first?.result as { content?: { text: string }[] }).content ?? [];
     const parsed = JSON.parse(fc[0]?.text ?? "{}") as { ok: boolean; arquivo: string };
     assert.equal(parsed.ok, true);
     const { basename: b, dirname: d } = await import("node:path");
     assert.equal(d(parsed.arquivo).split(/[/\\]/).pop(), "decisoes");
     assert.match(b(parsed.arquivo), new RegExp(`^${todayISODate()}-usar-gate-de-relevancia\\.md$`));
    // segunda chamada com mesmo título no mesmo dia deve falhar (idempotência por slug+data)
    const second = await call("usar gate de relevância");
    const sc = (second?.result as { content?: { text: string }[] }).content ?? [];
    const parsed2 = JSON.parse(sc[0]?.text ?? "{}") as { ok: boolean };
    assert.equal(parsed2.ok, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: memory_search retorna veredito de relevância", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "memory_search", arguments: { soul: "main", query: "qualquer coisa aqui", limit: 1 } } });
    const content = (res?.result as { content?: { text: string }[] }).content ?? [];
    const parsed = JSON.parse(content[0]?.text ?? "{}") as { soul: string; query: string; verdict: { ok: boolean; modo: string; motivo: string } };
    assert.equal(parsed.soul, "main");
    assert.equal(parsed.query, "qualquer coisa aqui");
    assert.ok(["recusar", "aviso", "libre"].includes(parsed.verdict.modo));
    assert.equal(parsed.verdict.motivo, "Nenhum resultado recuperado do acervo.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: agenda_add agenda uma tarefa e agenda_list lista por status", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const badSoul = await server.handleMessage({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: { name: "agenda_add", arguments: { soul: "nao-existe", title: "x" } },
    });
    assert.ok((badSoul?.error as { message?: string } | undefined)?.message?.includes("soul não encontrada"));

    const added = await server.handleMessage({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "agenda_add", arguments: { soul: "main", title: "gerar relatório", body: "resumo semanal" } },
    });
    const addedContent = (added?.result as { content?: { text: string }[] }).content ?? [];
    const addedParsed = JSON.parse(addedContent[0]?.text ?? "{}") as { ok: boolean; item: { id: number; status: string; title: string } };
    assert.equal(addedParsed.ok, true);
    assert.equal(addedParsed.item.status, "pending");
    assert.equal(addedParsed.item.title, "gerar relatório");

    const listed = await server.handleMessage({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: { name: "agenda_list", arguments: {} },
    });
    const listedContent = (listed?.result as { content?: { text: string }[] }).content ?? [];
    const listedParsed = JSON.parse(listedContent[0]?.text ?? "{}") as { items: { id: number; title: string }[] };
    assert.equal(listedParsed.items.length, 1);
    assert.equal(listedParsed.items[0]?.id, addedParsed.item.id);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
