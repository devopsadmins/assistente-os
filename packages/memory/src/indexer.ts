import type { Pool } from "@assistente-os/core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import type { Embedder } from "./embedders.js";

export interface Chunk {
  docKey: string;
  path: string;
  title?: string;
  body: string;
  embedding?: number[];
}

const MD_EXT = new Set([".md", ".markdown", ".txt"]);

/** Divide o texto em blocos ~512 chars respeitando quebras de linha. */
export function chunkText(text: string, size = 512): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length <= size) {
      out.push(trimmed);
    } else {
      let cur = trimmed;
      while (cur.length > size) {
        let cut = cur.lastIndexOf("\n", size);
        if (cut <= 0) cut = size;
        out.push(cur.slice(0, cut).trim());
        cur = cur.slice(cut).trim();
      }
      if (cur) out.push(cur);
    }
  }
  return out;
}

/** Lê recursivamente arquivos de texto de uma pasta (fonte da verdade). */
export function scanTextFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && MD_EXT.has(extname(entry.name).toLowerCase())) {
        files.push(p);
      }
    }
  };
  walk(dir);
  files.sort();
  return files;
}

/** Formato texto que o pgvector aceita como entrada para a coluna `vector`. */
function toVectorLiteral(embedding: number[] | null): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

const UPSERT_CHUNK_SQL = `
  INSERT INTO chunks (soul, doc_key, path, title, body, embedding)
  VALUES ($1, $2, $3, $4, $5, $6::vector)
  ON CONFLICT (soul, doc_key) DO UPDATE SET
    path = excluded.path, title = excluded.title, body = excluded.body, embedding = excluded.embedding
`;

/**
 * Re-sincroniza o índice: para cada arquivo .md/.txt, faz upsert idempotente
 * dos chunks (doc_key = caminho relativo::indice). Retorna total de chunks.
 */
export async function indexDirectory(pool: Pool, soul: string, root: string, embedder: Embedder): Promise<number> {
  let total = 0;
  for (const file of scanTextFiles(root)) {
    total += await indexFile(pool, soul, root, file, embedder);
  }
  return total;
}

export interface SearchResult {
  docKey: string;
  path: string;
  title: string | null;
  body: string;
  score: number;
  method: "vector" | "literal";
}

/**
 * Busca no índice. Tenta semântica via pgvector (índice HNSW, distância de
 * cosseno) se o embedder gerar vetor; senão degrada para palavra-chave
 * (ILIKE), exatamente como o modo "literal" do SLC-OS.
 */
export async function search(pool: Pool, soul: string, query: string, embedder: Embedder, max = 5): Promise<SearchResult[]> {
  const qVec = await embedder.embed(query);

  if (qVec) {
    const { rows } = await pool.query<{ doc_key: string; path: string; title: string | null; body: string; score: number }>(
      `SELECT doc_key, path, title, body, 1 - (embedding <=> $1::vector) AS score
       FROM chunks
       WHERE soul = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [toVectorLiteral(qVec), soul, max],
    );
    if (rows.length > 0) {
      return rows.map((r) => ({
        docKey: r.doc_key,
        path: r.path,
        title: r.title,
        body: r.body,
        score: Number(r.score),
        method: "vector",
      }));
    }
  }

  const { rows: lit } = await pool.query<{ doc_key: string; path: string; title: string | null; body: string }>(
    "SELECT doc_key, path, title, body FROM chunks WHERE soul = $1 AND (body ILIKE $2 OR title ILIKE $2) ORDER BY id LIMIT $3",
    [soul, `%${query}%`, max],
  );
  return lit.map((r) => ({
    docKey: r.doc_key,
    path: r.path,
    title: r.title,
    body: r.body,
    score: 1,
    method: "literal",
  }));
}

export async function indexStats(pool: Pool, soul: string): Promise<{ chunks: number; files: number }> {
  const { rows } = await pool.query<{ chunks: string; files: string }>(
    "SELECT COUNT(*) AS chunks, COUNT(DISTINCT path) AS files FROM chunks WHERE soul = $1",
    [soul],
  );
  return { chunks: Number(rows[0]?.chunks ?? 0), files: Number(rows[0]?.files ?? 0) };
}

/** Helper de raiz para permitir reindexar por arquivo (mais barato). */
export async function indexFile(pool: Pool, soul: string, root: string, file: string, embedder: Embedder): Promise<number> {
  const rel = relative(root, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  const chunks = chunkText(text);
  const title = text.split(/\r?\n/).find((l) => l.trim().startsWith("# "))?.replace(/^#\s+/, "").trim();
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? "";
    const embedding = await embedder.embed(chunk);
    await pool.query(UPSERT_CHUNK_SQL, [soul, `${rel}::${i}`, file, title ?? null, chunk, toVectorLiteral(embedding)]);
  }
  return chunks.length;
}
