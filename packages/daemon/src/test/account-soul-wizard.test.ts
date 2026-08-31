/**
 * Wizard de criação de soul do modo amigável (Fase 2) — POST /accounts/me/souls.
 * Cobre o caminho dry_run→plan_hash→commit, o limite por conta, e que a
 * ownership fica gravada corretamente (reaproveita a mesma validação/criação
 * core que soul_create via MCP já usa).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-wizard-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const r = await fetchJson(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { accountId: r.body.account.id, token: r.body.token };
}

test("wizard: dry_run não cria nada, commit com plan_hash certo cria a soul com ownerAccountId", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "wizard-alice@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const dry = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ purpose: "Tirar dúvidas de contratos" }),
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dry_run, true);
    assert.equal(dry.body.ok, true);
    assert.equal(dry.body.soul_id, "tirar-duvidas-de-contratos");
    assert.ok(dry.body.plan_hash);

    // dry_run não escreveu nada em disco: GET /souls da conta continua vazio.
    const soulsBeforeCommit = await fetchJson(`${base}/souls`, { headers });
    assert.deepEqual(soulsBeforeCommit.body, []);

    const commit = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ purpose: "Tirar dúvidas de contratos", dry_run: false, plan_hash: dry.body.plan_hash }),
    });
    assert.equal(commit.status, 201, JSON.stringify(commit.body));
    assert.equal(commit.body.created, true);
    assert.equal(commit.body.soul_id, "tirar-duvidas-de-contratos");

    const soulsAfterCommit = await fetchJson(`${base}/souls`, { headers });
    assert.equal(soulsAfterCommit.body.length, 1);
    assert.equal(soulsAfterCommit.body[0].id, "tirar-duvidas-de-contratos");
    assert.equal(soulsAfterCommit.body[0].config.ownerAccountId, alice.accountId);
    assert.deepEqual(soulsAfterCommit.body[0].config.agent.permissions.tools, []); // zero capabilities por padrão
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("wizard: commit sem sessão de conta (token admin) é recusado", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const r = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "qualquer coisa" }),
    });
    assert.equal(r.status, 401);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("wizard: purpose vazio é rejeitado antes de qualquer coisa", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "vazio@exemplo.com");
    const r = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "   " }),
    });
    assert.equal(r.status, 400);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("wizard: plan_hash divergente no commit devolve 409 E_STALE_HASH com hash fresco", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "stale@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const r = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers,
      body: JSON.stringify({ purpose: "algo", dry_run: false, plan_hash: "hash-inventado" }),
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "E_STALE_HASH");
    assert.ok(r.body.plan_hash);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("wizard: limite por conta (ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT) é respeitado", async () => {
  const prevLimit = process.env.ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT;
  process.env.ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT = "1";
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "limite@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const dry1 = await fetchJson(`${base}/accounts/me/souls`, { method: "POST", headers, body: JSON.stringify({ purpose: "primeira" }) });
    const commit1 = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST", headers,
      body: JSON.stringify({ purpose: "primeira", dry_run: false, plan_hash: dry1.body.plan_hash }),
    });
    assert.equal(commit1.status, 201);

    const dry2 = await fetchJson(`${base}/accounts/me/souls`, { method: "POST", headers, body: JSON.stringify({ purpose: "segunda" }) });
    assert.equal(dry2.status, 400);
    assert.equal(dry2.body.code, "E_ACCOUNT_LIMIT");
  } finally {
    await daemon.close();
    await cleanup();
    if (prevLimit === undefined) delete process.env.ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT;
    else process.env.ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT = prevLimit;
  }
});

test("wizard: id pedido que já existe cai pra slug único (-2)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "colisao-a@exemplo.com");
    const bob = await signup(base, "colisao-b@exemplo.com");

    const dryA = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "x", id: "assistente" }),
    });
    await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "x", id: "assistente", dry_run: false, plan_hash: dryA.body.plan_hash }),
    });

    const dryB = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST",
      headers: { authorization: `Bearer ${bob.token}`, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "y", id: "assistente" }),
    });
    assert.equal(dryB.body.soul_id, "assistente-2");
  } finally {
    await daemon.close();
    await cleanup();
  }
});
