/**
 * Configurações escopadas do modo amigável (Fase 3) — GET/PATCH
 * /accounts/me/souls/:id. Cobre isolamento entre contas, clamp de
 * guardrails contra o teto global, e que autonomy/capabilities nunca
 * mudam por essa rota (superfície de edição fixa desde a criação).
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
  const home = mkdtempSync(join(tmpdir(), "aos-settings-"));
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

async function signupAndCreateSoul(base: string, email: string, purpose: string): Promise<{ token: string; soulId: string }> {
  const signup = await fetchJson(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  const headers = { authorization: `Bearer ${signup.body.token}`, "content-type": "application/json" };
  const dry = await fetchJson(`${base}/accounts/me/souls`, { method: "POST", headers, body: JSON.stringify({ purpose }) });
  const commit = await fetchJson(`${base}/accounts/me/souls`, {
    method: "POST", headers,
    body: JSON.stringify({ purpose, dry_run: false, plan_hash: dry.body.plan_hash }),
  });
  return { token: signup.body.token, soulId: commit.body.soul_id };
}

test("settings: GET devolve description/personas/guardrails; PATCH atualiza e persiste", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "settings-a@exemplo.com", "ajudar com pedidos");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const before = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers });
    assert.equal(before.status, 200);
    assert.equal(before.body.description, "ajudar com pedidos");
    assert.equal(before.body.displayName, "");
    assert.equal(before.body.perfilMd, "");

    const patch = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        displayName: "Atendimento Loja",
        description: "ajudar com pedidos e devoluções",
        perfilMd: "# Persona\nSeja gentil.",
        guardrails: { maxTurns: 5 },
      }),
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.displayName, "Atendimento Loja");
    assert.equal(patch.body.description, "ajudar com pedidos e devoluções");
    assert.equal(patch.body.perfilMd, "# Persona\nSeja gentil.");
    assert.equal(patch.body.guardrails.maxTurns, 5);

    const after = await fetchJson(`${base}/accounts/me/souls/${soulId}`, { headers });
    assert.equal(after.body.displayName, "Atendimento Loja");
    assert.equal(after.body.description, "ajudar com pedidos e devoluções");
    assert.equal(after.body.perfilMd, "# Persona\nSeja gentil.");

    // GET /souls (fonte da listagem/chips) também precisa refletir o rename —
    // é o dado que a UI usa pra desenhar o chip, não só a view de settings.
    const souls = await fetchJson(`${base}/souls`, { headers });
    const soul = souls.body.find((s: any) => s.id === soulId);
    assert.equal(soul.config.displayName, "Atendimento Loja");
    assert.equal(soul.config.name, soulId, "config.name continua o slug/id — invariante do core não muda");
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("settings: conta de outra pessoa não lê nem edita — 403 nos dois métodos", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signupAndCreateSoul(base, "settings-alice@exemplo.com", "algo da alice");
    const bobSignup = await fetchJson(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "settings-bob@exemplo.com", password: "senha-forte-123" }),
    });
    const bobHeaders = { authorization: `Bearer ${bobSignup.body.token}`, "content-type": "application/json" };

    const getR = await fetchJson(`${base}/accounts/me/souls/${alice.soulId}`, { headers: bobHeaders });
    assert.equal(getR.status, 403);

    const patchR = await fetchJson(`${base}/accounts/me/souls/${alice.soulId}`, {
      method: "PATCH", headers: bobHeaders, body: JSON.stringify({ description: "hackeado" }),
    });
    assert.equal(patchR.status, 403);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("settings: guardrail além do teto global é clampado, nunca afrouxa", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "settings-clamp@exemplo.com", "algo");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // teto global default de maxIterations é bem menor que 99999 — nunca deve aceitar isso cru.
    const patch = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers, body: JSON.stringify({ guardrails: { maxIterations: 99999 } }),
    });
    assert.equal(patch.status, 200);
    assert.ok(patch.body.guardrails.maxIterations < 99999, `esperava clamp, veio ${patch.body.guardrails.maxIterations}`);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("settings: PATCH nunca expõe nem altera autonomy (superfície fixa); capabilities fora da allowlist é rejeitada, não ignorada em silêncio", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const { token, soulId } = await signupAndCreateSoul(base, "settings-fixed@exemplo.com", "algo");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // autonomy não está na whitelist de campos lidos — tenta injetar, é
    // simplesmente ignorado (nem chega a validar contra nada).
    const patchAutonomy = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ description: "x", autonomy: "auto" }),
    });
    assert.equal(patchAutonomy.status, 200);
    assert.equal(patchAutonomy.body.autonomy, undefined); // nem aparece na view de settings

    // capabilities agora É editável (feature nova, ver friendly-allowlist.
    // test.ts) — mas sem allowlist configurada pelo admin (vazia por
    // padrão), qualquer capability pedida é REJEITADA (400), nunca aceita
    // nem silenciosamente descartada — silenciar dava a ilusão de que foi
    // concedida quando não foi.
    const patchCap = await fetchJson(`${base}/accounts/me/souls/${soulId}`, {
      method: "PATCH", headers, body: JSON.stringify({ capabilities: ["browser_navigate"] }),
    });
    assert.equal(patchCap.status, 400);
    assert.equal(patchCap.body.code, "E_VALIDATION");

    const soulsAsAdmin = await fetchJson(`${base}/souls`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    const soul = soulsAsAdmin.body.find((s: any) => s.id === soulId);
    assert.equal(soul.config.agent.autonomy, "ask"); // continua o default da criação
    assert.deepEqual(soul.config.agent.permissions.tools, []); // rejeitado, continua zero capabilities
  } finally {
    await daemon.close();
    await cleanup();
  }
});
