/**
 * Cache semântico do RAG (T2.2 de `docs/ARCHITECTURE-REVIEW.md`).
 *
 * O cache exato de `retrieveContext` (chave sha1 de query+params, TTL 60s) só
 * acerta quando a pergunta é byte-a-byte igual. Este camada extra acerta quando
 * o *embedding* da pergunta está a ≥ `threshold` de cosseno de uma pergunta
 * recente com os mesmos parâmetros de recuperação (limit, rerank, injection).
 *
 * Conservador de propósito:
 *  - **Desligado por default** (`RAG_SEMANTIC_CACHE=on` liga) — mesma política do
 *    reranker (capacidade pronta, ativação por env após medir).
 *  - Só em memória do processo (a matemática vetorial não cabe no KV do Redis).
 *    Multi-instância = cada uma tem o seu; é cache de latência, não fonte de
 *    verdade.
 *  - TTL curto (default 60s, igual ao cache exato) cobre a defasagem de reindex —
 *    não há checagem de `updated_at` aqui, o TTL é o limite de obsolescência.
 *  - Caps por bucket e no total de buckets; evicção do mais antigo.
 *
 * NÃO usar em geração determinística (AIIA/família): o caller passa
 * `retrieveContext(..., { semanticCache: false })`.
 */
import { logger } from "@assistente-os/core";

export interface SemanticCacheConfig {
  enabled: boolean;
  /** Similaridade de cosseno mínima para considerar hit (0..1). */
  threshold: number;
  /** TTL das entradas em segundos. */
  ttlSec: number;
}

const MAX_ENTRIES_PER_BUCKET = 64;
const MAX_BUCKETS = 256;

export function semanticCacheConfig(): SemanticCacheConfig {
  const raw = (process.env.RAG_SEMANTIC_CACHE ?? "off").toLowerCase();
  const enabled = raw === "on" || raw === "1" || raw === "true";
  const threshold = clamp(Number(process.env.RAG_SEMANTIC_CACHE_THRESHOLD) || 0.85, 0.5, 0.999);
  const ttlSec = clamp(Math.floor(Number(process.env.RAG_SEMANTIC_CACHE_TTL) || 60), 1, 3600);
  return { enabled, threshold, ttlSec };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Cosseno entre dois vetores densos de mesma dimensão. 0 se dimensões diferem ou norma nula. */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface Entry {
  vec: number[];
  payload: string;
  expiresAt: number;
}

const store = new Map<string, Entry[]>();

function prune(entries: Entry[], now: number): Entry[] {
  return entries.filter((e) => e.expiresAt > now);
}

export interface SemanticCacheHit {
  payload: string;
  similarity: number;
}

/** Melhor entrada do bucket com cosseno ≥ threshold e não expirada; senão null. */
export function ragSemanticCacheGet(
  bucket: string,
  queryVec: readonly number[],
  threshold: number,
): SemanticCacheHit | null {
  const now = Date.now();
  const entries = store.get(bucket);
  if (!entries || entries.length === 0) return null;
  const live = prune(entries, now);
  if (live.length !== entries.length) store.set(bucket, live);

  let best: SemanticCacheHit | null = null;
  for (const e of live) {
    const sim = cosineSim(queryVec, e.vec);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { payload: e.payload, similarity: sim };
    }
  }
  return best;
}

export function ragSemanticCacheSet(
  bucket: string,
  queryVec: readonly number[],
  payload: string,
  ttlSec: number,
): void {
  const now = Date.now();
  const entry: Entry = { vec: [...queryVec], payload, expiresAt: now + ttlSec * 1000 };
  const entries = prune(store.get(bucket) ?? [], now);
  entries.push(entry);
  if (entries.length > MAX_ENTRIES_PER_BUCKET) entries.splice(0, entries.length - MAX_ENTRIES_PER_BUCKET);
  store.set(bucket, entries);

  if (store.size > MAX_BUCKETS) {
    // remove o bucket "mais frio" (primeiro do iterador de inserção)
    const oldest = store.keys().next().value as string | undefined;
    if (oldest !== undefined && oldest !== bucket) store.delete(oldest);
  }
}

/** Só para testes. */
export function __resetRagSemanticCache(): void {
  store.clear();
}

/** Log de diagnóstico (nível debug) — sem PII, só o bucket e a similaridade. */
export function logSemanticCacheHit(bucket: string, similarity: number): void {
  logger.debug(`[rag] semantic cache hit bucket=${bucket.slice(0, 12)} sim=${similarity.toFixed(4)}`);
}
