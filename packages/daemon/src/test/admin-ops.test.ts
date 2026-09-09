/**
 * Fase 3 do plano de engine headless: `POST /admin/backup` e
 * `POST /admin/discriminator` — verbos operacionais que só existiam na CLI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-adminops-"));
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

test("POST /admin/backup: cria ZIP em backupDir e aplica retenção (admin) — 403 pra chave sem escopo admin", async () => {
  const { home, cleanup } = await tempHome();
  const backupDir = mkdtempSync(join(tmpdir(), "aos-adminops-dest-"));
  const prevBackupDir = process.env.ASSISTENTE_OS_BACKUP_DIR;
  process.env.ASSISTENTE_OS_BACKUP_DIR = backupDir;
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    writeFileSync(join(home, "marker.txt"), "conteúdo qualquer\n");

    const r = await jsonFetch(`${base}/admin/backup`, { method: "POST", headers: auth(ADMIN_TOKEN) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.path.startsWith(backupDir), JSON.stringify(r.body));
    assert.ok(r.body.entries.includes("marker.txt"), JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.pruned));

    // chave com escopo restrito (não admin) não alcança
    const keyRes = await jsonFetch(`${base}/admin/api-keys`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({ label: "restrita", scopes: ["souls:read"] }),
    });
    assert.equal(keyRes.status, 201);
    const denied = await jsonFetch(`${base}/admin/backup`, { method: "POST", headers: auth(keyRes.body.key) });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "E_AUTHZ");
  } finally {
    await daemon.close();
    await cleanup();
    rmSync(backupDir, { recursive: true, force: true });
    if (prevBackupDir === undefined) delete process.env.ASSISTENTE_OS_BACKUP_DIR;
    else process.env.ASSISTENTE_OS_BACKUP_DIR = prevBackupDir;
  }
});

test("POST /admin/discriminator: 400 sem changesSummary; 403 pra sessão de conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const missing = await jsonFetch(`${base}/admin/discriminator`, {
      method: "POST",
      headers: auth(ADMIN_TOKEN),
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);

    const signup = await jsonFetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "op@exemplo.com", password: "senha-forte-123" }),
    });
    assert.equal(signup.status, 201);
    const asAccount = await jsonFetch(`${base}/admin/discriminator`, {
      method: "POST",
      headers: auth(signup.body.token),
      body: JSON.stringify({ changesSummary: "diff qualquer" }),
    });
    assert.equal(asAccount.status, 403);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
