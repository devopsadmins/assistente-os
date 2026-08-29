/**
 * Etapa 10 do refino — sub-suíte nomeada de testes de INTEGRAÇÃO dos caminhos
 * "wired" que os toggles ligam. O padrão da jornada foi teste de unidade forte
 * + zero teste do comportamento montado; aqui cada toggle ganha ao menos 1
 * teste do caminho real (retrieve → cache → resultado).
 *
 * Critério de saída (Etapa 10): todo caminho que um toggle liga tem ≥ 1 teste
 * de integração.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedder } from "../embedders.js";
import { indexDirectory } from "../indexer.js";
import { retrieveContext } from "../rag-chain.js";
import { __resetRagSemanticCache } from "../rag-semantic-cache.js";
import { createTestSchema } from "./pgTestHelper.js";

/**
 * Embedder determinístico bag-of-words em 768 dims (a dimensão da coluna
 * `chunks.embedding`). Tokeniza em minúsculas, hasheia cada token num índice e
 * acumula a contagem. Duas frases com o MESMO multiconjunto de tokens (só a
 * ordem/pontuação muda) produzem vetores idênticos → cosseno 1.0; frases de
 * tópicos disjuntos → cosseno 0. Sem rede, sem modelo.
 */
class BagOfWordsEmbedder implements Embedder {
  constructor(private readonly d = 768) {}
  dims(): number {
    return this.d;
  }
  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.d).fill(0);
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % this.d] += 1;
    }
    return v;
  }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k]!;
  }
  return fn().finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });
}

test("[wired] RAG_SEMANTIC_CACHE=on: retrieveContext serve HIT semântico para query parafraseada", async () => {
  await __resetRagSemanticCache();
  const dir = mkdtempSync(join(tmpdir(), "aos-integ-semhit-"));
  const db = await createTestSchema();
  const embedder = new BagOfWordsEmbedder();
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "infra.md"),
      "# pm2\n\ncomo configurar o pm2 no servidor de producao\n",
    );
    await indexDirectory(db.pool, "integ-sem", join(dir, "docs"), embedder);

    await withEnv({ RAG_SEMANTIC_CACHE: "on" }, async () => {
      // 1ª query: popula o cache semântico (miss em ambas as camadas).
      const first = await retrieveContext(db.pool, "integ-sem", "pm2 no servidor de producao", 5, {
        embedder,
      });
      assert.equal(first.cacheHit, undefined, "1ª chamada não é hit");

      // 2ª query: string diferente, MESMO multiconjunto de tokens → o cache
      // exato (sha1 da string) erra, o semântico (cosseno do embedding) acerta.
      const second = await retrieveContext(db.pool, "integ-sem", "producao de servidor no pm2", 5, {
        embedder,
      });
      assert.equal(second.cacheHit, "semantic", "2ª chamada parafraseada vem do cache semântico");
      assert.equal(second.context, first.context, "payload do hit semântico é o da 1ª recuperação");
      assert.equal(second.sources.length, first.sources.length);

      // query de tópico disjunto → nenhum hit semântico.
      const other = await retrieveContext(db.pool, "integ-sem", "backup do banco postgres", 5, {
        embedder,
      });
      assert.notEqual(other.cacheHit, "semantic", "tópico disjunto não casa o cache semântico");
    });
  } finally {
    await __resetRagSemanticCache();
    rmSync(dir, { recursive: true, force: true });
    await db.cleanup();
  }
});

test("[wired] RAG_SEMANTIC_CACHE ausente (default): nenhuma consulta ao cache semântico", async () => {
  await __resetRagSemanticCache();
  const dir = mkdtempSync(join(tmpdir(), "aos-integ-semoff-"));
  const db = await createTestSchema();
  const embedder = new BagOfWordsEmbedder();
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "a.md"), "# tema\n\nconteudo sobre pm2 no servidor\n");
    await indexDirectory(db.pool, "integ-semoff", join(dir, "docs"), embedder);

    await withEnv({ RAG_SEMANTIC_CACHE: undefined }, async () => {
      const a = await retrieveContext(db.pool, "integ-semoff", "pm2 no servidor", 5, { embedder });
      const b = await retrieveContext(db.pool, "integ-semoff", "servidor no pm2", 5, { embedder });
      assert.equal(a.cacheHit, undefined);
      assert.notEqual(b.cacheHit, "semantic");
    });
  } finally {
    await __resetRagSemanticCache();
    rmSync(dir, { recursive: true, force: true });
    await db.cleanup();
  }
});
