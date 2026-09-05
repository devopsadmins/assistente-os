/**
 * SPEC-EP2 Frente 2 (Fatia 1, 2026-09-05): antes, um campo de tipo errado no
 * corpo de uma rota HTTP era silenciosamente ignorado (`typeof x === "string"
 * ? x : default`) — nunca rejeitado. Depois de introduzir `parseBody` (schema
 * Zod) em `packages/daemon/src/routes/shared.ts`, o mesmo campo de tipo
 * errado agora vira 400 antes de qualquer acesso a soul/Postgres — os casos
 * abaixo provam a rejeição em rotas que antes aceitavam o lixo calado. Não é
 * uma suíte exaustiva das 13 rotas convertidas (ver backlog-atual.md §2
 * SPEC-EP2 pra lista completa) — é uma amostra representativa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";

const ADMIN_TOKEN = "admin-test-token";
// Porta sem ninguém escutando — todos os casos abaixo validam ANTES de tocar
// o Postgres, então isto só evita ruído de retentativa de migração contra um
// banco real que pode ou não estar de pé no ambiente de teste.
const UNREACHABLE_DB_URL = "postgres://x:x@127.0.0.1:1/x";

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: { error?: string } }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, body };
}

async function withDaemon(fn: (base: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "aos-ep2-zod-"));
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE_DB_URL;
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await fn(`http://127.0.0.1:${daemon.port}`);
  } finally {
    await daemon.close();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
}

test("SPEC-EP2: POST /agenda com soul de tipo errado (número) é rejeitado, não silenciosamente ignorado", async () => {
  await withDaemon(async (base) => {
    const r = await fetchJson(`${base}/agenda`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "tarefa", soul: 123 }),
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.error ?? "", /soul/i);
  });
});

test("SPEC-EP2: POST /agenda sem title continua rejeitado (campo obrigatório)", async () => {
  await withDaemon(async (base) => {
    const r = await fetchJson(`${base}/agenda`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
});

test("SPEC-EP2: POST /auth/signup com email de tipo errado (número) é rejeitado antes de tocar o banco", async () => {
  await withDaemon(async (base) => {
    const r = await fetchJson(`${base}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: 42, password: "senha-forte-123" }),
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
});

test("SPEC-EP2: POST /souls/:id/chat com timeoutSeconds de tipo errado (string) é rejeitado antes de resolver a soul", async () => {
  await withDaemon(async (base) => {
    // soul "inexistente" nunca é criada — se a validação rodasse depois do
    // lookup de soul, isto daria 404; 400 prova que o schema roda antes.
    const r = await fetchJson(`${base}/souls/inexistente/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi", timeoutSeconds: "60" }),
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
});

test("SPEC-EP2: POST /monitors com url de tipo errado (número) é rejeitado", async () => {
  await withDaemon(async (base) => {
    const r = await fetchJson(`${base}/monitors`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "site", url: 12345 }),
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
});
