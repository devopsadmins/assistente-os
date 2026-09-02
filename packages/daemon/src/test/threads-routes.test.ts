import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-threads-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-threads-"));
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

test("threads REST: CRUD completo por uma conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-threads@exemplo.com");
    createSoul(home, "soul-alice", { name: "soul-alice", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "minha primeira conversa" }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.title, "minha primeira conversa");
    const threadId = created.body.id;

    const listed = await fetchJson(`${base}/souls/soul-alice/threads`, { headers: aliceHeaders });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, threadId);

    const renamed = await fetchJson(`${base}/souls/soul-alice/threads/${threadId}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "renomeada" }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.title, "renomeada");

    const messages = await fetchJson(`${base}/souls/soul-alice/threads/${threadId}/messages`, { headers: aliceHeaders });
    assert.equal(messages.status, 200);
    assert.deepEqual(messages.body, []);

    const deleted = await fetch(`${base}/souls/soul-alice/threads/${threadId}`, {
      method: "DELETE",
      headers: aliceHeaders,
    });
    assert.equal(deleted.status, 204);

    const listedAfter = await fetchJson(`${base}/souls/soul-alice/threads`, { headers: aliceHeaders });
    assert.equal(listedAfter.body.length, 0);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: conta B não alcança thread da conta A (404, não 403 — não confirma existência)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-iso@exemplo.com");
    const bob = await signup(base, "bob-iso@exemplo.com");
    createSoul(home, "soul-alice2", { name: "soul-alice2", ownerAccountId: alice.accountId });
    createSoul(home, "soul-bob2", { name: "soul-bob2", ownerAccountId: bob.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const bobHeaders = { authorization: `Bearer ${bob.token}`, "content-type": "application/json" };

    // Bob tentando acessar a soul da Alice já é barrado pelo guard central (403) —
    // não dá pra nem chegar perto de uma thread da Alice por essa rota.
    const crossSoul = await fetchJson(`${base}/souls/soul-alice2/threads`, { headers: bobHeaders });
    assert.equal(crossSoul.status, 403);

    // Bob dentro da PRÓPRIA soul, mas tentando um threadId inventado: 404.
    const fakeThread = await fetchJson(`${base}/souls/soul-bob2/threads/999999`, { headers: bobHeaders });
    assert.equal(fakeThread.status, 404);

    // Forma alcançável de isolamento na mesma soul: uma thread criada pelo
    // token admin (account_id NULL) na soul da própria Alice não aparece nem
    // é editável pela sessão de conta da Alice — só pelo admin.
    createSoul(home, "soul-alice-op", { name: "soul-alice-op", ownerAccountId: alice.accountId });
    const opCreated = await fetchJson(`${base}/souls/soul-alice-op/threads`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "criada pelo admin" }),
    });
    const opThreadId = opCreated.body.id;

    const aliceListOnOwnSoul = await fetchJson(`${base}/souls/soul-alice-op/threads`, { headers: aliceHeaders });
    assert.equal(aliceListOnOwnSoul.body.length, 0);

    const aliceTouchesOpThread = await fetchJson(`${base}/souls/soul-alice-op/threads/${opThreadId}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "tentativa" }),
    });
    assert.equal(aliceTouchesOpThread.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: token admin vê e gerencia threads de qualquer conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-admin@exemplo.com");
    createSoul(home, "soul-alice3", { name: "soul-alice3", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice3/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "da alice" }),
    });
    const threadId = created.body.id;

    const asAdmin = await fetchJson(`${base}/souls/soul-alice3/threads`, { headers: adminHeaders });
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.length, 1);
    assert.equal(asAdmin.body[0].id, threadId);

    const renamedByAdmin = await fetchJson(`${base}/souls/soul-alice3/threads/${threadId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ title: "renomeada pelo admin" }),
    });
    assert.equal(renamedByAdmin.status, 200);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: POST sem title usa string vazia; PATCH sem title devolve 400", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-validate@exemplo.com");
    createSoul(home, "soul-alice4", { name: "soul-alice4", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice4/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, "");

    const badPatch = await fetchJson(`${base}/souls/soul-alice4/threads/${created.body.id}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(badPatch.status, 400);

    const badId = await fetchJson(`${base}/souls/soul-alice4/threads/not-a-number`, { headers: aliceHeaders });
    assert.equal(badId.status, 404); // não bate a regex de rota com id numérico → cai em 404 genérico, não 500
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: soul inexistente devolve 404", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const r = await fetchJson(`${base}/souls/nao-existe/threads`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(r.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: URL de uma soul não alcança thread de outra soul da mesma conta", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-twosouls@exemplo.com");
    createSoul(home, "soul-alice-x", { name: "soul-alice-x", ownerAccountId: alice.accountId });
    createSoul(home, "soul-alice-y", { name: "soul-alice-y", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const created = await fetchJson(`${base}/souls/soul-alice-x/threads`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "da soul x" }),
    });
    const threadId = created.body.id;

    const crossSoulPatch = await fetchJson(`${base}/souls/soul-alice-y/threads/${threadId}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "tentativa via soul errada" }),
    });
    assert.equal(crossSoulPatch.status, 404);

    const crossSoulMessages = await fetchJson(`${base}/souls/soul-alice-y/threads/${threadId}/messages`, { headers: aliceHeaders });
    assert.equal(crossSoulMessages.status, 404);

    const crossSoulDelete = await fetch(`${base}/souls/soul-alice-y/threads/${threadId}`, { method: "DELETE", headers: aliceHeaders });
    assert.equal(crossSoulDelete.status, 404);

    // Pela soul certa, continua funcionando.
    const ownSoulPatch = await fetchJson(`${base}/souls/soul-alice-x/threads/${threadId}`, {
      method: "PATCH",
      headers: aliceHeaders,
      body: JSON.stringify({ title: "renomeada pela soul certa" }),
    });
    assert.equal(ownSoulPatch.status, 200);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("threads REST: thread id fora do range de bigint devolve 404, não 500", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-bigid@exemplo.com");
    createSoul(home, "soul-alice-bigid", { name: "soul-alice-bigid", ownerAccountId: alice.accountId });
    const aliceHeaders = { authorization: `Bearer ${alice.token}` };

    const r1 = await fetchJson(`${base}/souls/soul-alice-bigid/threads/99999999999999999999`, { headers: aliceHeaders });
    assert.equal(r1.status, 404);

    const r2 = await fetchJson(`${base}/souls/soul-alice-bigid/threads/99999999999999999999/messages`, { headers: aliceHeaders });
    assert.equal(r2.status, 404);

    const r3 = await fetch(`${base}/souls/soul-alice-bigid/threads/99999999999999999999`, { method: "DELETE", headers: aliceHeaders });
    assert.equal(r3.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
