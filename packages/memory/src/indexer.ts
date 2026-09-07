import { isDbHealthy, enqueueEntityExtraction, type Pool } from "@assistente-os/core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { createHash } from "node:crypto";
import type { Embedder } from "./embedders.js";
import { MAX_EXTRACTION_INPUT_CHARS } from "./entity-extraction.js";

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

/** Lê recursivamente arquivos de texto de uma pasta (fonte da verdade).
 *
 * Ignora diretórios ocultos (`.git`, `.obsidian`, …) — souls carregam
 * working copies git de bases de conhecimento de cliente, e o `.git` só
 * traria ruído (COMMIT_EDITMSG, hooks .sample) pro índice. Symlinks também
 * não são seguidos (readdir só marca isDirectory/isFile pra entradas reais). */
export function scanTextFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
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

/**
 * Divide um documento inteiro em segmentos de até `maxChars`, agrupando os
 * mesmos blocos de ~512 chars usados acima pro RAG — reaproveita a mesma
 * quebra por parágrafo em vez de cortar no meio de uma frase. Usado pelo hook
 * de extração de entidades (abaixo) e pelo backfill (`os memory
 * backfill-entities`): `extractEntitiesWithOllama` trunca em
 * MAX_EXTRACTION_INPUT_CHARS, então mandar um documento grande direto
 * perderia a maior parte do conteúdo em silêncio. Cada segmento vira um job
 * de extração independente — upsertEntity/upsertRelation são idempotentes,
 * então múltiplos segmentos do mesmo documento não duplicam entidades.
 */
export function segmentDocumentText(text: string, maxChars: number = MAX_EXTRACTION_INPUT_CHARS): string[] {
  const blocks = chunkText(text, 512);
  const segments: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > maxChars && current) {
      segments.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Formato texto que o pgvector aceita como entrada para a coluna `vector`. */
function toVectorLiteral(embedding: number[] | null): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

const UPSERT_CHUNK_SQL = `
  INSERT INTO chunks (soul, doc_key, path, title, body, embedding, content_hash, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6::vector, $7, now())
  ON CONFLICT (soul, doc_key) DO UPDATE SET
    path = excluded.path, title = excluded.title, body = excluded.body,
    embedding = excluded.embedding, content_hash = excluded.content_hash, updated_at = now()
`;

export interface IndexDirResult {
  /** arquivos .md/.markdown/.txt varridos */
  files: number;
  /** total de chunks presentes no índice para esta run */
  chunks: number;
  /** chunks efetivamente (re)embedados — conteúdo novo ou alterado */
  embedded: number;
  /** chunks removidos por não existirem mais no disco (arquivo apagado/renomeado) */
  deleted: number;
}

/**
 * Re-sincroniza o índice: para cada arquivo .md/.txt, faz upsert dos chunks
 * (doc_key = caminho relativo::indice), pulando o re-embed de chunks cujo
 * conteúdo não mudou (content_hash). Ao final, remove chunks órfãos — de
 * arquivos que sumiram do disco.
 */
export async function indexDirectory(
  pool: Pool,
  soul: string,
  root: string,
  embedder: Embedder,
): Promise<IndexDirResult> {
  const files = scanTextFiles(root);
  let chunks = 0;
  let embedded = 0;
  const seenKeys: string[] = [];
  for (const file of files) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const r = await indexFile(pool, soul, root, file, embedder);
    chunks += r.chunks;
    embedded += r.embedded;
    for (let i = 0; i < r.chunks; i++) seenKeys.push(`${rel}::${i}`);
  }

  // Órfãos de nível de diretório: arquivos que sumiram desde a última run.
  // Só varre quando há pelo menos um arquivo — apontar o indexador para uma
  // pasta vazia não deve zerar o índice inteiro da soul (footgun).
  let deleted = 0;
  if (files.length > 0) {
    const del = await pool.query(
      "DELETE FROM chunks WHERE soul = $1 AND doc_key <> ALL($2::text[])",
      [soul, seenKeys],
    );
    deleted = del.rowCount ?? 0;
  }

  return { files: files.length, chunks, embedded, deleted };
}

export interface SearchResult {
  docKey: string;
  path: string;
  title: string | null;
  body: string;
  score: number;
  method: "vector" | "literal";
  /** ISO 8601 — `chunks.updated_at`: quando o chunk foi (re)sincronizado no índice. */
  updatedAt: string | null;
}

/**
 * Busca no índice. Tenta semântica via pgvector (índice HNSW, distância de
 * cosseno) se o embedder gerar vetor; senão degrada para palavra-chave
 * (ILIKE), exatamente como o modo "literal" do SLC-OS.
 */
/** ef_search do HNSW fixado por env (default 40) — reprodutibilidade da busca. */
function hnswEfSearch(): number {
  const n = Math.floor(Number(process.env.RAG_HNSW_EF_SEARCH) || 40);
  return Math.max(1, Math.min(1000, n));
}

export async function search(
  pool: Pool,
  soul: string,
  query: string,
  embedder: Embedder,
  max = 5,
  precomputedVec?: number[] | null,
): Promise<SearchResult[]> {
  // `precomputedVec` evita re-embedar quando o caller já embedou a query (ex.:
  // cache semântico em retrieveContext). `undefined` = embedar aqui; `null` =
  // caller tentou e não obteve vetor → cai direto no literal.
  const qVec = precomputedVec !== undefined ? precomputedVec : await embedder.embed(query);

  if (qVec) {
    // SET LOCAL exige transação; conexão dedicada para não vazar o GUC pro pool.
    const client = await pool.connect();
    let rows: Array<{ doc_key: string; path: string; title: string | null; body: string; score: number; updated_at: string | null }>;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL hnsw.ef_search = ${hnswEfSearch()}`);
      ({ rows } = await client.query(
        `SELECT doc_key, path, title, body, updated_at, 1 - (embedding <=> $1::vector) AS score
         FROM chunks
         WHERE soul = $2 AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [toVectorLiteral(qVec), soul, max],
      ));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (rows.length > 0) {
      return rows.map((r) => ({
        docKey: r.doc_key,
        path: r.path,
        title: r.title,
        body: r.body,
        score: Number(r.score),
        method: "vector",
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      }));
    }
  }

  const { rows: lit } = await pool.query<{ doc_key: string; path: string; title: string | null; body: string; updated_at: string | null }>(
    "SELECT doc_key, path, title, body, updated_at FROM chunks WHERE soul = $1 AND (body ILIKE $2 OR title ILIKE $2) ORDER BY id LIMIT $3",
    [soul, `%${query}%`, max],
  );
  return lit.map((r) => ({
    docKey: r.doc_key,
    path: r.path,
    title: r.title,
    body: r.body,
    score: 1,
    method: "literal",
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

export async function indexStats(
  pool: Pool,
  soul: string,
): Promise<{ chunks: number; files: number; lastIndexedAt: string | null }> {
  const { rows } = await pool.query<{ chunks: string; files: string; last_indexed_at: string | null }>(
    "SELECT COUNT(*) AS chunks, COUNT(DISTINCT path) AS files, MAX(updated_at) AS last_indexed_at FROM chunks WHERE soul = $1",
    [soul],
  );
  return {
    chunks: Number(rows[0]?.chunks ?? 0),
    files: Number(rows[0]?.files ?? 0),
    lastIndexedAt: rows[0]?.last_indexed_at ? new Date(rows[0].last_indexed_at).toISOString() : null,
  };
}

export type DocumentExtractionStatus = "pending" | "queued" | "completed" | "failed";

/** Estado de extração de entidades por documento (`document_extraction_state`) —
 * usado tanto pelo hook em `indexFile` quanto pelo backfill (`os memory
 * backfill-entities`) pra saber se um documento já foi processado com o
 * conteúdo atual, sem reprocessar do zero a cada re-indexação/re-run. */
export async function setDocumentExtractionState(
  pool: Pool,
  soul: string,
  path: string,
  status: DocumentExtractionStatus,
  error?: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO document_extraction_state (soul, path, status, last_run_at, error)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (soul, path) DO UPDATE SET status = excluded.status, last_run_at = excluded.last_run_at, error = excluded.error`,
    [soul, path, status, error ?? null],
  );
}

export async function getDocumentExtractionStatus(pool: Pool, soul: string, path: string): Promise<DocumentExtractionStatus | null> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM document_extraction_state WHERE soul = $1 AND path = $2",
    [soul, path],
  );
  return (rows[0]?.status as DocumentExtractionStatus) ?? null;
}

/** Documentos distintos indexados pra uma soul (agrupamento pelo `path` de `chunks` —
 * não existe tabela de documentos própria, `path` já é a identidade de facto). */
export async function listDocumentPaths(pool: Pool, soul: string): Promise<string[]> {
  const { rows } = await pool.query<{ path: string }>(
    "SELECT DISTINCT path FROM chunks WHERE soul = $1 ORDER BY path",
    [soul],
  );
  return rows.map((r) => r.path);
}

/**
 * Reconstrói o texto de um documento juntando seus chunks na ordem original.
 * Ordena por `id` (não `doc_key`): `doc_key` é `<path>::<índice>` e um sort
 * textual colocaria "::10" antes de "::2" — `id` cresce na ordem de inserção
 * do loop de chunking (0..N) e não muda em updates (ON CONFLICT DO UPDATE
 * preserva o id original), então reflete a ordem certa mesmo após re-index.
 */
export async function getDocumentText(pool: Pool, soul: string, path: string): Promise<string> {
  const { rows } = await pool.query<{ body: string }>(
    "SELECT body FROM chunks WHERE soul = $1 AND path = $2 ORDER BY id",
    [soul, path],
  );
  return rows.map((r) => r.body).join("\n\n");
}

export interface IndexFileResult {
  /** chunks do arquivo agora no índice */
  chunks: number;
  /** quantos foram (re)embedados — 0 quando o conteúdo não mudou */
  embedded: number;
}

/**
 * (Re)indexa um único arquivo. Chunks cujo `content_hash` bate com o índice
 * não são re-embedados (só o carimbo `updated_at` é renovado). Chunks de
 * índice mais alto sobrando de uma versão maior do arquivo são removidos.
 */
export async function indexFile(
  pool: Pool,
  soul: string,
  root: string,
  file: string,
  embedder: Embedder,
): Promise<IndexFileResult> {
  // SPEC-HR1 (fatia 3, 2026-09-05): diferente de agenda/chat, não existe
  // fallback conceitual pro ingest RAG (o propósito É popular o vetorial) —
  // aqui o objetivo é só falhar rápido com mensagem clara em vez de vazar a
  // exceção crua do driver `pg`. `indexDirectory` chama esta função por
  // arquivo, então checar aqui cobre os dois pontos de entrada com uma sonda
  // só (barata quando saudável: um `SELECT 1`).
  if (!(await isDbHealthy(pool))) {
    throw new Error("Postgres indisponível no momento — a indexação RAG depende do banco vetorial; tente novamente em instantes");
  }
  const rel = relative(root, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  const chunks = chunkText(text);
  const title =
    text.split(/\r?\n/).find((l) => l.trim().startsWith("# "))?.replace(/^#\s+/, "").trim() ?? null;

  const { rows: existing } = await pool.query<{ doc_key: string; content_hash: string | null }>(
    "SELECT doc_key, content_hash FROM chunks WHERE soul = $1 AND path = $2",
    [soul, file],
  );
  const priorHash = new Map(existing.map((r) => [r.doc_key, r.content_hash]));

  const keys: string[] = [];
  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? "";
    const key = `${rel}::${i}`;
    keys.push(key);
    const hash = createHash("sha256").update(chunk).digest("hex");
    if (priorHash.get(key) === hash) {
      // Conteúdo idêntico — mantém o embedding, só renova metadados/carimbo.
      await pool.query(
        "UPDATE chunks SET path = $3, title = $4, updated_at = now() WHERE soul = $1 AND doc_key = $2",
        [soul, key, file, title],
      );
      continue;
    }
    const embedding = await embedder.embed(chunk);
    embedded++;
    await pool.query(UPSERT_CHUNK_SQL, [soul, key, file, title, chunk, toVectorLiteral(embedding), hash]);
  }

  // Órfãos do próprio arquivo: se o doc encolheu (menos chunks), apaga os
  // doc_key antigos de índice mais alto. Com `keys` vazio (arquivo virou vazio),
  // `<> ALL('{}')` é verdadeiro para todo doc_key → limpa o arquivo inteiro.
  await pool.query(
    "DELETE FROM chunks WHERE soul = $1 AND path = $2 AND doc_key <> ALL($3::text[])",
    [soul, file, keys],
  );

  // Extração de entidades/relações também sobre conteúdo indexado no RAG, não só
  // conversas (addObservation). OFF por padrão (mede antes de virar comportamento
  // sempre-ligado, como RAG_RERANK/RAG_SEMANTIC_CACHE) — ligar via
  // RAG_DOC_ENTITY_EXTRACTION=true. Só enfileira quando algo de fato mudou no
  // arquivo (embedded > 0); documento inalterado não gera trabalho novo.
  if (embedded > 0 && process.env.RAG_DOC_ENTITY_EXTRACTION === "true") {
    const segments = segmentDocumentText(text);
    for (const segment of segments) {
      await enqueueEntityExtraction(pool, soul, title ?? rel, segment, file, null);
    }
    await setDocumentExtractionState(pool, soul, file, "queued");
  }

  return { chunks: chunks.length, embedded };
}
