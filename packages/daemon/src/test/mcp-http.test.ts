/**
 * Fase 2 do plano de engine headless (docs/ENGINE-API.md): `POST /mcp` —
 * JSON-RPC 2.0 sobre HTTP pro kernel MCP realocado de `packages/tools` pra
 * `packages/daemon/src/mcp/`. Admin-only (kernel não tem ownership por
 * conta — só allowlist de tool por soul); chave de API de serviço com
 * escopo `mcp`/`mcp:<família>` é o caminho pra um app cliente independente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-mcphttp-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function auth(bearer: string): Record<string, string> {
  return { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
}

test("POST /mcp: token admin faz tools/list e tools/call (souls_list) via JSON-RPC", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    createSoul(home, "main", { name: "main" });
    writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");

    const list = await jsonFetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(list.body.result.tools.length >= 60, `esperava >= 60 tools, veio ${list.body.result.tools.length}`);
    assert.ok(list.body.result.tools.some((t: any) => t.name === "souls_list"));

    const call = await jsonFetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "souls_list", arguments: {} } }),
    });
    assert.equal(call.status, 200, JSON.stringify(call.body));
    const payload = JSON.parse(call.body.result.content[0].text);
    assert.ok(Array.isArray(payload));
    assert.ok(payload.some((s: any) => s.id === "main"));
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("POST /mcp: notificação JSON-RPC responde 204 sem corpo", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(res.status, 204);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("POST /mcp: sessão de conta self-service é recusada com 403 (kernel não tem ownership por conta)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const signup = await jsonFetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "conta@exemplo.com", password: "senha-forte-123" }),
    });
    assert.equal(signup.status, 201);
    const res = await jsonFetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(signup.body.token),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 403);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("POST /mcp: chave de API com escopo mcp:<família> restringe tools/call; escopo errado dá 403", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    createSoul(home, "main", { name: "main" });

    const keyRes = await jsonFetch(`${base}/admin/api-keys`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({ label: "cliente-souls", scopes: ["mcp:souls"] }),
    });
    assert.equal(keyRes.status, 201, JSON.stringify(keyRes.body));
    const key = keyRes.body.key as string;

    // dentro do escopo: souls_list é família "souls".
    const ok = await jsonFetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "souls_list", arguments: {} } }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    // fora do escopo: costs_summary é família "misc".
    const denied = await jsonFetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "costs_summary", arguments: {} } }),
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "E_AUTHZ");
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("POST /mcp: corpo inválido (não-JSON) dá 400", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: "isso não é json",
    });
    assert.equal(res.status, 400);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
