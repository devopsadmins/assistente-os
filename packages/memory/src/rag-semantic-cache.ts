/**
 * Cache semântico do RAG (T2.2 de `docs/ARCHITECTURE-REVIEW.md`; Etapa 6 do
 * refino: passa a persistir via o cache em camadas do core).
 *
 * O cache exato de `retrieveContext` (chave sha1 de query+params, TTL 60s) só
 * acerta quando a pergunta é byte-a-byte igual. Esta camada extra acerta quando
 * o *embedding* da pergunta está a ≥ `threshold` de cosseno de uma pergunta
 * recente com os mesmos parâmetros de recuperação (limit, rerank, injection).
 *
 *  - **Desligado por default** (`RAG_SEMANTIC_CACHE=on` liga).
 *  - Armazenado via `cache` do `@assistente-os/core` (Redis quando o daemon
 *    chamou `cache.init()` com `REDIS_URL` — **compartilhado entre instâncias**;
 *    senão o `Map` em memória do processo). Um bucket = um valor JSON
 *    `[{v:number[], p:string}]`; o TTL do valor cobre a defasagem de reindex.
 *  - A matemática de cosseno roda em Node sobre as entradas do bucket (não há
 *    índice vetorial no Redis puro).
 *  - Cap por bucket; sem cap de nº de buckets (cada um expira sozinho pelo TTL).
 *
 * NÃO usar em geração determinística (AIIA/família): o caller passa
 * `retrieveContext(..., { semanticCache: false })`.
 */
import { cache, logger } from "@assistente-os/core";

export interface SemanticCacheConfig {
  enabled: boolean;
  /** Similaridade de cosseno mínima para considerar hit (0..1). */
  threshold: number;
  /** TTL das entradas em segundos. */
  ttlSec: number;
}

const MAX_ENTRIES_PER_BUCKET = 64;
const KEY_PREFIX = "rag:sem:";

/** Buckets tocados neste processo — só para `__resetRagSemanticCache` (testes). */
const touchedKeys = new Set<string>();

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

/** Entrada serializada no bucket: `v` vetor, `p` payload, `exp` epoch-ms de expiração. */
interface StoredEntry {
  v: number[];
  p: string;
  exp: number;
}

export interface SemanticCacheHit {
  payload: string;
  similarity: number;
}

/**
 * Lê o bucket e filtra entradas expiradas. O `exp` por-entrada dá expiração
 * preguiçosa mesmo no Map em memória (que só limpa TTL na escrita); o TTL do
 * `cache.set` cuida do descarte do bucket inteiro (real no Redis).
 */
async function readBucket(key: string): Promise<StoredEntry[]> {
  try {
    const raw = await cache.get(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEntry[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((e) => e && typeof e.exp === "number" && e.exp > now);
  } catch {
    return [];
  }
}

/** Melhor entrada do bucket com cosseno ≥ threshold; senão null. */
export async function ragSemanticCacheGet(
  bucket: string,
  queryVec: readonly number[],
  threshold: number,
): Promise<SemanticCacheHit | null> {
  const entries = await readBucket(KEY_PREFIX + bucket);
  let best: SemanticCacheHit | null = null;
  for (const e of entries) {
    const sim = cosineSim(queryVec, e.v);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { payload: e.p, similarity: sim };
    }
  }
  return best;
}

export async function ragSemanticCacheSet(
  bucket: string,
  queryVec: readonly number[],
  payload: string,
  ttlSec: number,
): Promise<void> {
  const key = KEY_PREFIX + bucket;
  // read-modify-write: corrida entre instâncias só custa um miss futuro (cache
  // de latência, não fonte de verdade) — não vale WATCH/MULTI.
  const entries = await readBucket(key);
  entries.push({ v: [...queryVec], p: payload, exp: Date.now() + ttlSec * 1000 });
  if (entries.length > MAX_ENTRIES_PER_BUCKET) {
    entries.splice(0, entries.length - MAX_ENTRIES_PER_BUCKET);
  }
  try {
    await cache.set(key, JSON.stringify(entries), ttlSec);
    touchedKeys.add(key);
  } catch {
    /* cache opcional */
  }
}

/** Só para testes. */
export async function __resetRagSemanticCache(): Promise<void> {
  for (const key of touchedKeys) {
    try {
      await cache.del(key);
    } catch {
      /* ignore */
    }
  }
  touchedKeys.clear();
}

/** Log de diagnóstico (nível debug) — sem PII, só o bucket e a similaridade. */
export function logSemanticCacheHit(bucket: string, similarity: number): void {
  logger.debug(`[rag] semantic cache hit bucket=${bucket.slice(0, 12)} sim=${similarity.toFixed(4)}`);
}
