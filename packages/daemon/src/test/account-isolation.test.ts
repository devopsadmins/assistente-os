/**
 * Isolamento multi-tenant do modo amigável (Fase 1) — uma sessão de conta só
 * enxerga/acessa as próprias souls (`config.ownerAccountId`); o token admin
 * continua vendo tudo, sem regressão. Complementa cross-tenant.test.ts (que
 * cobre isolamento por soul em nível de dados, não o novo caminho de auth
 * por conta).
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
  const home = mkdtempSync(join(tmpdir(), "aos-acct-"));
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

test("modo amigável: isolamento de contas — GET /souls, /chat e /memory/search escopados por dono", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const alice = await signup(base, "alice@exemplo.com");
    const bob = await signup(base, "bob@exemplo.com");

    createSoul(home, "soul-alice", { name: "soul-alice", ownerAccountId: alice.accountId });
    createSoul(home, "soul-bob", { name: "soul-bob", ownerAccountId: bob.accountId });
    createSoul(home, "soul-operador", { name: "soul-operador" }); // sem dono — só o token admin vê
    writeFileSync(join(home, "souls", "soul-alice", "perfil.md"), "# soul-alice\n");

    const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const aliceHeaders = { authorization: `Bearer ${alice.token}` };
    const bobHeaders = { authorization: `Bearer ${bob.token}` };

    // Token admin: vê as 3 souls, sem regressão.
    const asAdmin = await fetchJson(`${base}/souls`, { headers: adminHeaders });
    assert.deepEqual(
      (asAdmin.body as Array<{ id: string }>).map((s) => s.id).sort(),
      ["soul-alice", "soul-bob", "soul-operador"],
    );

    // Sessão da Alice: só soul-alice, nunca soul-operador (que não tem dono).
    const asAlice = await fetchJson(`${base}/souls`, { headers: aliceHeaders });
    assert.deepEqual((asAlice.body as Array<{ id: string }>).map((s) => s.id), ["soul-alice"]);

    const asBob = await fetchJson(`${base}/souls`, { headers: bobHeaders });
    assert.deepEqual((asBob.body as Array<{ id: string }>).map((s) => s.id), ["soul-bob"]);

    // Alice tentando falar com a soul do Bob via /chat → 403, nunca chega a executar.
    const crossChat = await fetchJson(`${base}/souls/soul-bob/chat`, {
      method: "POST",
      headers: { ...aliceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(crossChat.status, 403);

    // Alice na própria soul: não é bloqueada pelo guard de posse (pode falhar
    // adiante por outro motivo — modelo indisponível no teste — mas não 401/403).
    const ownChat = await fetchJson(`${base}/souls/soul-alice/chat`, {
      method: "POST",
      headers: { ...aliceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi", timeoutSeconds: 5 }),
    });
    assert.notEqual(ownChat.status, 401);
    assert.notEqual(ownChat.status, 403);

    // Mesma coisa pro /memory/search: cruzado bloqueia, próprio não.
    const crossSearch = await fetchJson(`${base}/souls/soul-bob/memory/search`, {
      method: "POST",
      headers: { ...aliceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ query: "qualquer coisa" }),
    });
    assert.equal(crossSearch.status, 403);

    const ownSearch = await fetchJson(`${base}/souls/soul-alice/memory/search`, {
      method: "POST",
      headers: { ...aliceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ query: "qualquer coisa" }),
    });
    assert.notEqual(ownSearch.status, 403);

    // Soul sem dono (do operador): sessão de conta não acessa, nem pra 404 disfarçar 403.
    const operatorSoulViaAccount = await fetchJson(`${base}/souls/soul-operador/chat`, {
      method: "POST",
      headers: { ...aliceHeaders, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(operatorSoulViaAccount.status, 403);

    // Token inválido/sem token: 401, como antes de existir conta.
    const noAuth = await fetchJson(`${base}/souls`);
    assert.equal(noAuth.status, 401);
    const badToken = await fetchJson(`${base}/souls`, { headers: { authorization: "Bearer token-que-nao-existe" } });
    assert.equal(badToken.status, 401);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("modo amigável: /auth/logout invalida a sessão imediatamente", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "logout@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}` };

    const me1 = await fetchJson(`${base}/auth/me`, { headers });
    assert.equal(me1.status, 200);

    const logout = await fetchJson(`${base}/auth/logout`, { method: "POST", headers });
    assert.equal(logout.status, 200);

    const me2 = await fetchJson(`${base}/auth/me`, { headers });
    assert.equal(me2.status, 401);

    const souls = await fetchJson(`${base}/souls`, { headers });
    assert.equal(souls.status, 401);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("modo amigável: /auth/login com credenciais erradas devolve 401", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    await signup(base, "senha@exemplo.com");
    const r = await fetchJson(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "senha@exemplo.com", password: "senha-errada" }),
    });
    assert.equal(r.status, 401);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
