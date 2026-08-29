/**
 * Caminho dourado ponta a ponta (Onda 2 da remediação — pedido nº1 da revisão
 * externa): `POST /souls/:id/chat` → router → RAG → tier `local` (Ollama REAL) →
 * resposta auditável. Verifica que o **trace** amarra tudo: header `x-trace-id`,
 * spans por estágio (`rag`, `router`, `ollama`, `persistencia`), linha canônica
 * em `execution_logs` com o `trace_id`, veredito de RAG e custo gravados.
 *
 * NÃO roda no CI (glob é `*.test.js`; este é `*.live.js`). Roda no ambiente do
 * usuário, com Ollama vivo:
 *   npm --workspace @assistente-os/daemon run build
 *   RUN_E2E=1 node --test packages/daemon/dist/test/golden-path.live.js
 *
 * Sem `RUN_E2E=1` ou sem Ollama, os casos apenas retornam (não falham).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../server.js";
import { createSoul, getPool, loadConfig } from "@assistente-os/core";
import { indexDirectory, getEmbedder } from "@assistente-os/memory";
import { tempDaemonHome } from "./pgTestHelper.js";

const RUN = process.env.RUN_E2E === "1";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

describe("golden path e2e (Ollama real)", () => {
  it("chat → RAG → local → resposta auditável, tudo amarrado pelo trace", async () => {
    if (!RUN) return;
    if (!(await ollamaUp())) {
      console.log(`[golden-path] Ollama indisponível em ${OLLAMA_URL} — pulando`);
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "aos-e2e-"));
    const home = mkdtempSync(join(tmpdir(), "aos-e2e-home-"));
    createSoul(home, "e2e", { name: "e2e", description: "soul de e2e" });
    writeFileSync(join(home, "souls", "e2e", "perfil.md"), "# e2e\n\nassistente de teste ponta a ponta\n");
    const db = await tempDaemonHome(home);

    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "pm2.md"),
      "# Operação pm2\n\nPara reiniciar o serviço no servidor, rode `pm2 restart assistente-os`.\n" +
        "Os logs ficam em `pm2 logs assistente-os`. O daemon escuta na porta 4310.\n",
    );
    const pool = getPool(loadConfig({ home }).databaseUrl);
    await indexDirectory(pool, "e2e", join(dir, "docs"), getEmbedder());

    const daemon = await startDaemon({ port: 0, home });
    try {
      const base = `http://127.0.0.1:${daemon.port}`;
      const res = await fetch(`${base}/souls/e2e/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "como reinicio o serviço com pm2?", timeoutSeconds: 120 }),
      });
      assert.equal(res.status, 200, "chat respondeu 200");
      const traceId = res.headers.get("x-trace-id");
      assert.ok(traceId, "x-trace-id presente");
      const body = (await res.json()) as { ok: boolean; stdout: string; tier: string };
      assert.equal(body.ok, true);
      assert.ok(body.stdout.trim().length > 0, "resposta não vazia");
      assert.equal(body.tier, "local", "o tier vencedor foi o local (Ollama real)");

      const { rows: exec } = await pool.query(
        "SELECT tier, status, context_chars, verdict FROM execution_logs WHERE trace_id = $1",
        [traceId],
      );
      assert.equal(exec.length, 1);
      assert.equal(exec[0]!.tier, "local");
      assert.equal(exec[0]!.status, "ok");
      assert.ok(Number(exec[0]!.context_chars) > 0, "RAG montou contexto");
      assert.ok(exec[0]!.verdict, "veredito de RAG persistido");

      const { rows: spans } = await pool.query<{ module: string; level: string }>(
        "SELECT module, level FROM execution_spans WHERE trace_id = $1 ORDER BY seq",
        [traceId],
      );
      const modules = spans.map((s) => s.module);
      for (const stage of ["chat", "rag", "router", "ollama", "persistencia"]) {
        assert.ok(modules.includes(stage), `faltou o span do estágio '${stage}' (veio: ${modules.join(", ")})`);
      }
      assert.ok(!spans.some((s) => s.level === "err"), "nenhum span de erro no caminho feliz");

      const { rows: cost } = await pool.query("SELECT status FROM cost_calls WHERE soul = 'e2e'");
      assert.ok(cost.length >= 1, "custo registrado");
    } finally {
      await daemon.close();
      await db.cleanup();
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
