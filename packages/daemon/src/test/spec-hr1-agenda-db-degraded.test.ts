/**
 * SPEC-HR1 (fatia 3, 2026-09-05): `GET/POST /agenda` e o job em loop
 * `processDueAgenda` ainda vazavam a exceção crua do driver `pg` (e esperavam
 * o `connectionTimeoutMillis` cheio do pool, 5s) quando o Postgres estava
 * fora do ar — diferente de `POST /chat` (degrada pra Markdown) e da tool MCP
 * `agenda_add`/`agenda_list` (já sondava `isDbHealthy`), que já tinham sido
 * corrigidos numa fatia anterior. Agora a rota REST responde 503 rápido com
 * mensagem clara, e o job pula o ciclo sem lançar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { processDueAgenda } from "../agenda.js";

const ADMIN_TOKEN = "admin-test-token";
// Porta sem ninguém escutando — ECONNREFUSED rápido, sem esperar o
// connectionTimeoutMillis cheio (5s) do pool real.
const UNREACHABLE_DB_URL = "postgres://x:x@127.0.0.1:1/x";

test("SPEC-HR1: GET /agenda com Postgres inatingível responde 503 claro, não 500 cru", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-hr1-agenda-"));
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE_DB_URL;
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const startedAt = Date.now();
    const res = await fetch(`${base}/agenda`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const elapsedMs = Date.now() - startedAt;
    const body = (await res.json()) as { error?: string };
    assert.equal(res.status, 503);
    assert.match(body.error ?? "", /Postgres indisponível/);
    assert.ok(elapsedMs < 3000, `deveria responder rápido via sonda (1.5s), levou ${elapsedMs}ms`);
  } finally {
    await daemon.close();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-HR1: POST /agenda com Postgres inatingível responde 503 claro, não 500 cru", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-hr1-agenda-"));
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE_DB_URL;
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/agenda`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "tarefa de teste" }),
    });
    const body = (await res.json()) as { error?: string };
    assert.equal(res.status, 503);
    assert.match(body.error ?? "", /Postgres indisponível/);
  } finally {
    await daemon.close();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
});

test("SPEC-HR1: processDueAgenda com Postgres inatingível pula o ciclo sem lançar", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-hr1-agenda-job-"));
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE_DB_URL;
  try {
    const startedAt = Date.now();
    const processed = await processDueAgenda({ home });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(processed, 0);
    assert.ok(elapsedMs < 3000, `deveria pular via sonda (1.5s), levou ${elapsedMs}ms`);
  } finally {
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
});
