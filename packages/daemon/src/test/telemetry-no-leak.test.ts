/**
 * Telemetria não vaza contexto/PII (E8.4 / gate AI-3).
 *
 * `execution_logs.verdict` já carregava `snippet` (200 chars do corpo do doc)
 * e é devolvido por `/infra/status`. `sanitizeVerdictForLog` corta isso na
 * gravação — mantém só ok/motivo/path/method/score.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeVerdictForLog } from "@assistente-os/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul, getPool, loadConfig, recordExecution } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

test("sanitizeVerdictForLog: descarta snippet/body das fontes de RAG", () => {
  const raw = JSON.stringify({
    ok: true,
    sources: [
      { path: "souls/x/perfil.md", method: "semantic", score: 0.82, snippet: "TEXTO SENSÍVEL do documento que não pode vazar" },
      { path: "souls/x/soul.md", method: "literal", score: 0.5, body: "outro TEXTO SENSÍVEL" },
    ],
  });
  const clean = sanitizeVerdictForLog(raw)!;
  assert.ok(!clean.includes("SENSÍVEL"), "nenhum trecho de conteúdo sobrevive");
  const parsed = JSON.parse(clean) as { ok: boolean; sources: Array<Record<string, unknown>> };
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.sources[0], { path: "souls/x/perfil.md", method: "semantic", score: 0.82 });
  assert.equal(sanitizeVerdictForLog("texto livre não-JSON"), null);
  assert.equal(sanitizeVerdictForLog(undefined), null);
});

test("/infra/status não devolve trechos de documento nos execution_logs", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-leak-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");
  const db = await tempDaemonHome(home);
  const daemon = await startDaemon({ port: 0, home });
  try {
    const pool = getPool(loadConfig({ home }).databaseUrl);
    // Simula um turno que gravou verdict com snippet (comportamento antigo).
    await recordExecution(pool, {
      soul: "main",
      kind: "chat",
      verdict: JSON.stringify({ ok: true, sources: [{ path: "souls/main/perfil.md", method: "semantic", score: 0.9, snippet: "CONTEUDO_QUE_NAO_PODE_VAZAR" }] }),
      status: "ok",
    });

    const res = await fetch(`http://127.0.0.1:${daemon.port}/infra/status`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!body.includes("CONTEUDO_QUE_NAO_PODE_VAZAR"), "snippet do doc não aparece em /infra/status");
    assert.ok(body.includes("souls/main/perfil.md") && body.includes("semantic"), "metadados de retrieval (path/method, sem conteúdo) permanecem");
  } finally {
    await daemon.close();
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
