/**
 * Allowlist admin de capabilities/skills pro modo amigável — GET/PUT
 * /admin/friendly-allowlist (admin-only), GET /accounts/me/available-
 * capabilities (conta), e a validação em POST/PATCH de soul contra essa
 * allowlist (nunca aceita capability fora do que o admin liberou).
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
  const home = mkdtempSync(join(tmpdir(), "aos-allowlist-"));
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
  return { accountId: r.body.account.id, token: r.body.token };
}

test("admin allowlist: GET/PUT só pro token admin, sessão de conta recebe 403", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "allowlist-alice@exemplo.com");
    const accountHeaders = { authorization: `Bearer ${alice.token}` };

    const getAsAccount = await fetchJson(`${base}/admin/friendly-allowlist`, { headers: accountHeaders });
    assert.equal(getAsAccount.status, 403);

    const putAsAccount = await fetchJson(`${base}/admin/friendly-allowlist`, {
      method: "PUT", headers: { ...accountHeaders, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: ["memory_search"], skills: [] }),
    });
    assert.equal(putAsAccount.status, 403);

    const getAsAdmin = await fetchJson(`${base}/admin/friendly-allowlist`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    assert.equal(getAsAdmin.status, 200);
    assert.ok(Array.isArray(getAsAdmin.body.capabilities));
    assert.ok(getAsAdmin.body.capabilities.some((c: any) => c.pattern === "memory_search"));
    assert.equal(getAsAdmin.body.capabilities.every((c: any) => c.allowed === false), true, "nada liberado por padrão");
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("admin allowlist: PUT filtra patterns desconhecidos, GET reflete o que foi salvo", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

    const put = await fetchJson(`${base}/admin/friendly-allowlist`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ capabilities: ["memory_search", "capability-que-nao-existe"], skills: ["minha-skill"] }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.capabilities, ["memory_search"]); // filtrado
    assert.deepEqual(put.body.skills, ["minha-skill"]); // skills não são validadas contra catálogo fechado

    const get = await fetchJson(`${base}/admin/friendly-allowlist`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    const memSearch = get.body.capabilities.find((c: any) => c.pattern === "memory_search");
    assert.equal(memSearch.allowed, true);
    const soulCreate = get.body.capabilities.find((c: any) => c.pattern === "soul_create");
    assert.equal(soulCreate.allowed, false);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("wizard: capability fora da allowlist é rejeitada; dentro da allowlist é concedida", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    // admin libera só memory_search
    await fetchJson(`${base}/admin/friendly-allowlist`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: ["memory_search"], skills: [] }),
    });

    const alice = await signup(base, "wizard-cap-alice@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    // pede uma capability fora da allowlist (soul_create está no catálogo mas não foi liberada)
    const dryBad = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST", headers, body: JSON.stringify({ purpose: "algo", capabilities: ["soul_create"] }),
    });
    assert.equal(dryBad.status, 400);
    assert.equal(dryBad.body.code, "E_VALIDATION");

    // pede só a que foi liberada — passa
    const dryOk = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST", headers, body: JSON.stringify({ purpose: "algo", capabilities: ["memory_search"] }),
    });
    assert.equal(dryOk.status, 200, JSON.stringify(dryOk.body));
    assert.equal(dryOk.body.ok, true);

    const commit = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST", headers,
      body: JSON.stringify({ purpose: "algo", capabilities: ["memory_search"], dry_run: false, plan_hash: dryOk.body.plan_hash }),
    });
    assert.equal(commit.status, 201);

    const settings = await fetchJson(`${base}/accounts/me/souls/${commit.body.soul_id}`, { headers });
    assert.deepEqual(settings.body.capabilities, ["memory_search"]);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("configurações: PATCH capabilities respeita a allowlist e persiste; sem enviar o campo mantém o que já tinha", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    await fetchJson(`${base}/admin/friendly-allowlist`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: ["memory_search", "soul_context"], skills: [] }),
    });

    const alice = await signup(base, "patch-cap-alice@exemplo.com");
    const headers = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };
    const dry = await fetchJson(`${base}/accounts/me/souls`, { method: "POST", headers, body: JSON.stringify({ purpose: "algo" }) });
    const commit = await fetchJson(`${base}/accounts/me/souls`, {
      method: "POST", headers, body: JSON.stringify({ purpose: "algo", dry_run: false, plan_hash: dry.body.plan_hash }),
    });
    const soulId = commit.body.soul_id;

    // sem capabilities na criação: nasce vazio (comportamento de sempre)
    const initial = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers });
    assert.deepEqual(initial.body.capabilities, []);

    // PATCH com capability fora da allowlist → rejeitado, nada muda
    const badPatch = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers, body: JSON.stringify({ capabilities: ["action_execute"] }),
    });
    assert.equal(badPatch.status, 400);

    // PATCH com capability liberada → aceito e persiste
    const goodPatch = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers, body: JSON.stringify({ capabilities: ["memory_search", "soul_context"] }),
    });
    assert.equal(goodPatch.status, 200, JSON.stringify(goodPatch.body));
    assert.deepEqual(goodPatch.body.capabilities.sort(), ["memory_search", "soul_context"]);

    // PATCH de outro campo, sem mexer em capabilities → continua como estava
    const unrelatedPatch = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers, body: JSON.stringify({ description: "novo texto" }),
    });
    assert.deepEqual(unrelatedPatch.body.capabilities.sort(), ["memory_search", "soul_context"]);
  } finally {
    await daemon.close();
    await cleanup();
  }
});
