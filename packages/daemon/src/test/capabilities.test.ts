import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";
import { createSoul } from "@assistente-os/core";
import { REST_ROUTES, MCP_TOOL_CATALOG, SSE_EVENTS, WS_EVENT_TYPES, ERROR_CODES } from "../routes/catalog.js";

test("catalog: sem rota duplicada (method+path) e sem tool MCP duplicada", () => {
  const seen = new Set<string>();
  for (const r of REST_ROUTES) {
    const key = `${r.method} ${r.path}`;
    assert.ok(!seen.has(key), `rota duplicada no catálogo: ${key}`);
    seen.add(key);
  }
  const toolNames = new Set<string>();
  for (const t of MCP_TOOL_CATALOG) {
    assert.ok(!toolNames.has(t.name), `tool MCP duplicada no catálogo: ${t.name}`);
    toolNames.add(t.name);
  }
  assert.ok(REST_ROUTES.length >= 60, `esperava >= 60 rotas catalogadas, tem ${REST_ROUTES.length}`);
  assert.ok(MCP_TOOL_CATALOG.length >= 60, `esperava >= 60 tools catalogadas, tem ${MCP_TOOL_CATALOG.length}`);
});

test("daemon: GET /llms.txt deriva do catálogo (loopback, sem token)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-llms-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/llms.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    const body = await res.text();
    assert.match(body, /^# terrasIA/);
    assert.ok(body.includes("## Rotas REST + WebSocket"));
    assert.ok(body.includes("## Catálogo de MCP Tools"));
    assert.ok(body.includes("## Eventos SSE"));
    assert.ok(body.includes("## Códigos de erro estáveis"));
    assert.ok(body.includes("## Souls registradas"));
    assert.ok(body.includes("`main`"));
    assert.ok(body.includes("POST /souls/:id/chat"));
    assert.ok(body.includes("spec_grill_plan"));
    assert.ok(body.includes("browser_navigate"));
    assert.ok(body.includes("sales_ingest_meeting"));
    assert.ok(body.includes("guardian_approve_rule"));
    assert.ok(body.includes("E_BUDGET"));
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("daemon: GET /api/capabilities retorna o contrato consolidado", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-cap-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const { cleanup } = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/api/capabilities`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body: any = await res.json();
    assert.equal(body.system.name, "terrasIA");
    assert.ok(body.souls.some((s: any) => s.id === "main"));
    assert.equal(body.restEndpoints.length, REST_ROUTES.length);
    assert.equal(body.mcpTools.length, MCP_TOOL_CATALOG.length);
    assert.equal(body.sseEvents.length, SSE_EVENTS.length);
    assert.equal(body.wsEvents.length, WS_EVENT_TYPES.length);
    assert.equal(body.errorCodes.length, ERROR_CODES.length);
    assert.ok(Array.isArray(body.cliOnlyVerbs));
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("daemon: GET /api/openapi.json é uma spec 3.1 válida gerada do catálogo", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dmn-oas-"));
  createSoul(home, "main", { name: "main" });
  const { cleanup } = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/api/openapi.json`);
    assert.equal(res.status, 200);
    const spec: any = await res.json();
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/souls/{id}/chat"]?.post);
    assert.ok(spec.paths["/souls/{id}/threads/{threadId}/messages/stream"]?.post);
    assert.ok(spec.components.securitySchemes.bearerAuth);
    // WS não vira path OpenAPI
    assert.ok(!spec.paths["/"]);
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
