/**
 * SPEC-HR1 (fatia inicial — só POST /chat): com o Postgres fora do ar,
 * `preparePromptContext` lançaria na primeira query (`sumCostBySoul`) e a
 * requisição morria com 500, sem registrar nada da troca. Agora degrada pra
 * Markdown-only: responde 200 com `degraded:true` e grava a troca em
 * `sessoes/YYYY-MM-DD.md` via `anotar()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";

const ADMIN_TOKEN = "admin-test-token";
// Porta sem ninguém escutando — ECONNREFUSED rápido, sem esperar o
// connectionTimeoutMillis cheio (5s) do pool real.
const UNREACHABLE_DB_URL = "postgres://x:x@127.0.0.1:1/x";

test("SPEC-HR1: POST /chat com Postgres inatingível degrada pra 200 + Markdown, não 500", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-hr1-"));
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE_DB_URL;
  createSoul(home, "soul-hr1", { name: "soul-hr1" });
  writeFileSync(join(home, "souls", "soul-hr1", "perfil.md"), "# soul-hr1\n\nSoul de teste do modo degradado.\n");
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/soul-hr1/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "diga apenas: oi" }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    // Não é 500 nem trava — ou responde degradado (Ollama respondeu), ou 503
    // claro se até o Ollama local também estiver fora (ambiente sem Ollama).
    assert.ok(res.status === 200 || res.status === 503, `status inesperado: ${res.status} — ${JSON.stringify(body)}`);
    assert.equal(body.degraded, true);

    if (res.status === 200) {
      assert.equal(typeof body.response, "string");
      assert.ok((body.response as string).length > 0);
      // Persistiu em Markdown, não só respondeu — é o "reindexa depois".
      const today = new Date().toISOString().slice(0, 10);
      const sessionFile = join(home, "souls", "soul-hr1", "sessoes", `${today}.md`);
      assert.ok(existsSync(sessionFile), "sessoes/YYYY-MM-DD.md deveria ter sido criado");
      const content = readFileSync(sessionFile, "utf8");
      assert.ok(content.includes("MODO DEGRADADO"), "o registro deveria indicar que foi modo degradado");
    }
  } finally {
    await daemon.close();
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(home, { recursive: true, force: true });
  }
});
