import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiteralEmbedder } from "../embedders.js";
import { indexDirectory } from "../indexer.js";
import { addObservation } from "../graph.js";
import { retrieveContext, buildRagChain, runRagChain } from "../langchain-rag.js";
import { createTestSchema } from "./pgTestHelper.js";

function tempDir(t: string) {
  return mkdtempSync(join(tmpdir(), "aos-langchain-"));
}

function makeDocs(dir: string): void {
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "projeto.md"), "# Assistente OS\n\nProjeto de assistente pessoal com IA.\n\nUsa Ollama para inferência local.\n");
  writeFileSync(join(dir, "docs", "deploy.md"), "# Deploy\n\nDeploy na VM usando Docker.\n\nPostgres para banco de dados.\n");
  writeFileSync(join(dir, "docs", "arquitetura.md"), "# Arquitetura\n\nMonorepo com pacotes: core, memory, daemon, tools, cli.\n\nMCP para ferramentas.\n");
}

test("retrieveContext retorna contexto formatado", async () => {
  const dir = tempDir("retrieve");
  const testDb = await createTestSchema();
  try {
    makeDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "s1", join(dir, "docs"), embedder);

    const result = await retrieveContext(testDb.pool, "s1", "projeto", 5);
    assert.ok(typeof result.context === "string");
    assert.ok(result.sources.length > 0);
    assert.ok(typeof result.hasRelevantDocs === "boolean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("retrieveContext retorna vazio quando não há documentos", async () => {
  const testDb = await createTestSchema();
  try {
    const result = await retrieveContext(testDb.pool, "s2", "qualquer coisa", 5);
    assert.equal(result.context, "Não foram encontrados documentos relevantes para esta pergunta.");
    assert.equal(result.sources.length, 0);
    assert.equal(result.hasRelevantDocs, false);
  } finally {
    await testDb.cleanup();
  }
});

test("retrieveContext: hasRelevantDocs=true quando só o fallback literal (observations) encontra algo", async () => {
  // Sem indexar nada em chunks: search() retorna vazio, forçando literalSearchFallback
  // (que atribui score=0.5 de propósito). Regressão do bug: hasRelevantDocs usava
  // `> 0.5` (estrito), então o fallback literal nunca era considerado relevante.
  const testDb = await createTestSchema();
  try {
    await addObservation(testDb.pool, "s4", "Projeto Assistente OS", "Usa Ollama para inferência local.", "teste");

    const result = await retrieveContext(testDb.pool, "s4", "Ollama", 5);
    assert.ok(result.sources.length > 0, "esperava achar via fallback literal");
    assert.equal(result.sources[0]?.method, "literal");
    assert.equal(result.hasRelevantDocs, true);
  } finally {
    await testDb.cleanup();
  }
});

test("buildRagChain retorna chain invoke", async () => {
  const dir = tempDir("chain");
  const testDb = await createTestSchema();
  try {
    makeDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "s1", join(dir, "docs"), embedder);

    const chain = buildRagChain(testDb.pool, "s1", 5);
    assert.ok(chain);
    assert.ok(typeof chain.invoke === "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("runRagChain retorna mensagem quando não há documentos", async () => {
  const testDb = await createTestSchema();
  try {
    const result = await runRagChain(testDb.pool, "s3", "inexistente", 5);
    assert.ok(result.answer.includes("Não encontrei"));
    assert.equal(result.sources.length, 0);
  } finally {
    await testDb.cleanup();
  }
});

test("runRagChain retorna resultado com fontes (requer Ollama)", async () => {
  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  let ollamaOk = false;
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return;
    const data = await resp.json() as { models?: Array<{ name: string }> };
    const modelPrefix = (process.env.OLLAMA_MODEL || "qwen2.5").split(":")[0];
    ollamaOk = !!(data.models?.some((m) => m.name.startsWith(modelPrefix)));
  } catch { /* ok */ }
  if (!ollamaOk) {
    return;
  }

  const dir = tempDir("rag");
  const testDb = await createTestSchema();
  try {
    makeDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "s1", join(dir, "docs"), embedder);

    const result = await runRagChain(testDb.pool, "s1", "deploy", 5);
    assert.ok(typeof result.answer === "string");
    assert.ok(result.sources.length > 0);
    assert.equal(result.model, "hybrid-embedder");
    assert.equal(result.query, "deploy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
