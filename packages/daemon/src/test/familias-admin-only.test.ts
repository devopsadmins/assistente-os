/**
 * Fase 5 do plano de engine headless: `/familias/*` não tem modelo de dono
 * self-service (a tabela `familias` não tem `account_id`) — antes desta
 * checagem, qualquer conta self-service autenticada conseguia listar/ver/
 * apagar dados de qualquer família (nome de criança, telefone, anamnese) via
 * o gate central, que só escopa `/souls/:id/*`. Confirmado ao vivo antes do
 * fix. Agora `handleFamilias` recusa toda sessão de conta com 403, igual ao
 * padrão admin-only de `adminPlans.ts`/`adminApiKeys.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-test-token";

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("/familias/*: sessão de conta self-service recebe 403 em toda rota; token admin passa", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-familias-admin-"));
  const db = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;

    const signup = await jsonFetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "intruso@exemplo.com", password: "senha-forte-123" }),
    });
    assert.equal(signup.status, 201);
    const accountAuth = { authorization: `Bearer ${signup.body.token}`, "content-type": "application/json" };
    const adminAuth = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };

    const list = await jsonFetch(`${base}/familias`, { headers: accountAuth });
    assert.equal(list.status, 403);

    const create = await jsonFetch(`${base}/familias`, {
      method: "POST",
      headers: accountAuth,
      body: JSON.stringify({ telefone: "5511999999999", nomeFamilia: "Teste" }),
    });
    assert.equal(create.status, 403);

    const del = await jsonFetch(`${base}/familias/1`, { method: "DELETE", headers: accountAuth });
    assert.equal(del.status, 403);

    // token admin continua funcionando normalmente (lista vazia, sem 403).
    const listAdmin = await jsonFetch(`${base}/familias`, { headers: adminAuth });
    assert.equal(listAdmin.status, 200);
    assert.equal(listAdmin.body.total, 0);
  } finally {
    await daemon.close();
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
