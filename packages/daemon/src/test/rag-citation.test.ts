/**
 * E11 — RAG auditável: o bloco de contexto do `buildPrompt` cita a fonte
 * (`[score · arquivo]`), traz a diretriz de constrained generation, e o
 * `verdict` carrega `confidence`. Com `AOS_RAG_MIN_CONFIDENCE` alto, entra o
 * modo "evidência insuficiente".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, loadConfig, getSoul, getPool } from "@assistente-os/core";
import { LiteralEmbedder, indexDirectory } from "@assistente-os/memory";
import { buildPrompt } from "../context.js";
import { tempDaemonHome } from "./pgTestHelper.js";

async function ragHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-cit-"));
  createSoul(home, "main", { name: "main" });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n\nassistente principal\n");
  const docs = mkdtempSync(join(tmpdir(), "aos-cit-docs-"));
  mkdirSync(join(docs, "d"), { recursive: true });
  writeFileSync(join(docs, "d", "pm2.md"), "# pm2\n\npara reiniciar o serviço rode pm2 restart assistente-os\n");
  const db = await tempDaemonHome(home);
  await indexDirectory(getPool(loadConfig({ home }).databaseUrl), "main", join(docs, "d"), new LiteralEmbedder());
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
      rmSync(docs, { recursive: true, force: true });
    },
  };
}

test("buildPrompt: bloco RAG cita a fonte + diretriz de constrained generation; verdict.confidence presente", async () => {
  const { home, cleanup } = await ragHome();
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const built = await buildPrompt({ home, soul, prompt: "pm2 restart", config, withRag: true });

    assert.match(built.ragCtx, /Contexto de conhecimento relevante/);
    assert.match(built.ragCtx, /Responda usando SÓ o que está abaixo/);
    assert.match(built.ragCtx, /\[pm2\.md::1 · sim \d\.\d{3} · \d{4}-\d{2}-\d{2}\]/, "cada linha cita [doc_key · sim score · data]");

    const v = built.verdict as { ok: boolean; confidence?: { score: number; level: string }; sources?: Array<{ indexedAt?: string | null }> };
    assert.equal(v.ok, true);
    assert.ok(v.confidence && typeof v.confidence.score === "number", "verdict.confidence presente");
    assert.ok(["high", "medium", "low"].includes(v.confidence.level));
    assert.ok(v.sources && v.sources[0] && "indexedAt" in v.sources[0], "sources carregam indexedAt");
  } finally {
    await cleanup();
  }
});

test("buildPrompt: AOS_RAG_MIN_CONFIDENCE alto → modo 'evidência insuficiente' (não injeta o contexto)", async () => {
  const { home, cleanup } = await ragHome();
  const prev = process.env.AOS_RAG_MIN_CONFIDENCE;
  process.env.AOS_RAG_MIN_CONFIDENCE = "0.99";
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const built = await buildPrompt({ home, soul, prompt: "pm2 restart", config, withRag: true });

    assert.match(built.ragCtx, /Evidência insuficiente/);
    assert.doesNotMatch(built.ragCtx, /pm2 restart assistente-os/, "o trecho da fonte NÃO vai pro prompt");
    const v = built.verdict as { ok: boolean; motivo?: string; confidence?: { score: number } };
    assert.equal(v.ok, false);
    assert.equal(v.motivo, "confidence_below_floor");
    assert.ok(v.confidence && v.confidence.score < 0.99);
  } finally {
    if (prev === undefined) delete process.env.AOS_RAG_MIN_CONFIDENCE;
    else process.env.AOS_RAG_MIN_CONFIDENCE = prev;
    await cleanup();
  }
});
