/**
 * Fase 1 do plano de engine headless: chaves de API com escopo + CORS opt-in.
 * O token admin continua abrindo tudo; uma chave é uma credencial não-admin
 * com allowlist explícita de escopos, revogável, opcionalmente presa a conta.
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
  const home = mkdtempSync(join(tmpdir(), "aos-apikey-"));
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

async function createKey(
  base: string,
  scopes: string[],
  extra: Record<string, unknown> = {},
): Promise<{ key: string; keyHash: string }> {
  const r = await jsonFetch(`${base}/admin/api-keys`, {
    method: "POST",
    headers: auth(ADMIN_TOKEN),
    body: JSON.stringify({ label: `test ${scopes.join(",")}`, scopes, ...extra }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { key: r.body.key, keyHash: r.body.record.keyHash };
}

test("chave de API: escopo por domínio é aplicado (souls:read passa em GET /souls, 403 em POST /chat)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    createSoul(home, "main", { name: "main" });
    writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");

    const { key } = await createKey(base, ["souls:read"]);

    const list = await jsonFetch(`${base}/souls`, { headers: auth(key) });
    assert.equal(list.status, 200, JSON.stringify(list.body));

    const chat = await jsonFetch(`${base}/souls/main/chat`, {
      method: "POST",
      headers: auth(key),
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(chat.status, 403);
    assert.equal(chat.body.code, "E_AUTHZ");

    const admin = await jsonFetch(`${base}/admin/api-keys`, { headers: auth(key) });
    assert.equal(admin.status, 403);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("chave de API: revogação → 401; escopo '*' alcança rota admin", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    createSoul(home, "main", { name: "main" });

    const star = await createKey(base, ["*"]);
    const adminOk = await jsonFetch(`${base}/admin/api-keys`, { headers: auth(star.key) });
    assert.equal(adminOk.status, 200);

    const del = await jsonFetch(`${base}/admin/api-keys?keyHash=${star.keyHash}`, {
      method: "DELETE",
      headers: auth(ADMIN_TOKEN),
    });
    assert.equal(del.status, 200);

    const afterRevoke = await jsonFetch(`${base}/souls`, { headers: auth(star.key) });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("chave de API presa a conta: escopo de posse de soul é aplicado", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const signup = await jsonFetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dona@exemplo.com", password: "senha-forte-123" }),
    });
    assert.equal(signup.status, 201);
    const accountId: number = signup.body.account.id;

    createSoul(home, "da-conta", { name: "da-conta", ownerAccountId: accountId });
    createSoul(home, "de-outro", { name: "de-outro" });
    writeFileSync(join(home, "souls", "da-conta", "perfil.md"), "# da-conta\n");
    writeFileSync(join(home, "souls", "de-outro", "perfil.md"), "# de-outro\n");

    const { key } = await createKey(base, ["*"], { accountId });

    const own = await jsonFetch(`${base}/souls/da-conta/context`, { headers: auth(key) });
    assert.equal(own.status, 200, JSON.stringify(own.body));

    const foreign = await jsonFetch(`${base}/souls/de-outro/context`, { headers: auth(key) });
    assert.equal(foreign.status, 403);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("CORS: sem ASSISTENTE_OS_CORS_ORIGINS não há cabeçalho; com origem permitida o preflight responde 204", async () => {
  const prev = process.env.ASSISTENTE_OS_CORS_ORIGINS;
  const { home, cleanup } = await tempHome();
  try {
    // sem CORS configurado
    let daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
    let base = `http://127.0.0.1:${daemon.port}`;
    let res = await fetch(`${base}/souls`, { method: "OPTIONS", headers: { origin: "http://app.local" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.status, 405);
    await daemon.close();

    // com CORS configurado
    process.env.ASSISTENTE_OS_CORS_ORIGINS = "http://app.local,http://outra.local";
    daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
    base = `http://127.0.0.1:${daemon.port}`;

    res = await fetch(`${base}/souls`, { method: "OPTIONS", headers: { origin: "http://app.local" } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://app.local");
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");

    res = await fetch(`${base}/health`, { headers: { origin: "http://evil.local" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    await daemon.close();
  } finally {
    if (prev === undefined) delete process.env.ASSISTENTE_OS_CORS_ORIGINS;
    else process.env.ASSISTENTE_OS_CORS_ORIGINS = prev;
    await cleanup();
  }
});
