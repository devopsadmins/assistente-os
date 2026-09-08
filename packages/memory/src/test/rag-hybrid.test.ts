import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Embedder } from "../embedders.js";
import { indexDirectory, search } from "../indexer.js";
import { createTestSchema } from "./pgTestHelper.js";

/**
 * Embedder determinístico (hash → vetor 768d) só pra teste: gera vetores
 * estáveis por texto sem depender de Ollama/Xenova, o suficiente pra pgvector
 * indexar e ranquear por distância de cosseno.
 */
class DeterministicEmbedder implements Embedder {
  dims(): number {
    return 768;
  }
  async embed(text: string): Promise<number[] | null> {
    const vec: number[] = [];
    let seed = createHash("sha256").update(text).digest();
    while (vec.length < 768) {
      seed = createHash("sha256").update(seed).digest();
      for (let i = 0; i < seed.length && vec.length < 768; i++) vec.push(seed[i]! / 255 - 0.5);
    }
    return vec;
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "aos-hybrid-"));
}

test("search com RAG_HYBRID_SEARCH=on funde vetorial + full-text (method hybrid)", async () => {
  const dir = tempDir();
  const testDb = await createTestSchema();
  const prevFlag = process.env.RAG_HYBRID_SEARCH;
  process.env.RAG_HYBRID_SEARCH = "on";
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "ollama.md"), "# Ollama\n\nOllama roda modelos de IA localmente na máquina.\n");
    writeFileSync(join(dir, "docs", "deploy.md"), "# Deploy\n\nO deploy usa Docker Compose e Postgres.\n");

    const embedder = new DeterministicEmbedder();
    await indexDirectory(testDb.pool, "hyb", join(dir, "docs"), embedder);

    const results = await search(testDb.pool, "hyb", "Ollama modelos locais", embedder, 5);
    assert.ok(results.length > 0, "esperava pelo menos um resultado");
    assert.ok(results.every((r) => r.method === "hybrid"), "todos os resultados deveriam vir com method=hybrid");
    assert.ok(results.some((r) => r.path.includes("ollama.md")), "esperava achar o doc sobre Ollama");
  } finally {
    if (prevFlag === undefined) delete process.env.RAG_HYBRID_SEARCH;
    else process.env.RAG_HYBRID_SEARCH = prevFlag;
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("search com RAG_HYBRID_SEARCH=off (default) mantém method vector", async () => {
  const dir = tempDir();
  const testDb = await createTestSchema();
  const prevFlag = process.env.RAG_HYBRID_SEARCH;
  delete process.env.RAG_HYBRID_SEARCH;
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "ollama.md"), "# Ollama\n\nOllama roda modelos de IA localmente na máquina.\n");

    const embedder = new DeterministicEmbedder();
    await indexDirectory(testDb.pool, "hyboff", join(dir, "docs"), embedder);

    const results = await search(testDb.pool, "hyboff", "Ollama modelos locais", embedder, 5);
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.method === "vector"));
  } finally {
    if (prevFlag === undefined) delete process.env.RAG_HYBRID_SEARCH;
    else process.env.RAG_HYBRID_SEARCH = prevFlag;
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
