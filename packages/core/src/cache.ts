/**
 * Cache em camadas para o Assistente OS:
 * 1. Redis (primary, persistente, compartilhado entre instâncias)
 * 2. Map em memória (fallback local, quando Redis cair)
 * 3. SQLite kernel.db (tertiário, para dados que precisam de query indexed)
 *
 * O que é cacheado:
 * - Embeddings: hash(texto) -> vetor serializado (JSON)
 * - Resultados RAG: query -> [{id, score, metadata}] com TTL
 *
 * O que NÃO é cacheado:
 * - Prompts compostos (sempre recomputados para consistência)
 * - Contexto volátil entre chamadas
 */
import { Redis } from "ioredis";

/** TTL padrão em segundos para entradas de cache (24h) */
const DEFAULT_TTL = 86400;

/** Chave base para embeddings no cache */
const EMBEDDING_PREFIX = "mpt:emb:";
/** Chave base para resultados RAG no cache */
const RAG_PREFIX = "mpt:rag:";

class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, string> = new Map();
  private ttlMap: Map<string, number> = new Map();
  private readonly REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  private readonly MAX_MEMORY_ENTRIES = Number(
    process.env.ASSISTENTE_OS_CACHE_MAX_ENTRIES || "1000",
  );
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    let client: Redis | null = null;
    try {
      // Falha rápido e SEM spam quando não há Redis (CI, dev sem Redis):
      // lazyConnect + connect() explícito rejeita já na 1ª tentativa; o
      // retryStrategy desiste após 3 tentativas curtas em vez de reconectar
      // pra sempre; o listener de 'error' evita o "[ioredis] Unhandled error
      // event" no stderr — a degradação para memória é silenciosa por design.
      client = new Redis(this.REDIS_URL, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
        reconnectOnError: () => false,
      });
      client.on("error", () => {
        /* silencioso — quem usa cai para o Map em memória */
      });
      await client.connect();
      const pong = await client.ping();
      this.redis = client;
      console.log("[Cache] Redis conectado com sucesso:", pong);
    } catch (err) {
      console.warn(
        "[Cache] Redis indisponível, usando fallback em memória apenas:",
        (err as Error).message,
      );
      try {
        client?.disconnect();
      } catch {
        /* já desconectado */
      }
      this.redis = null;
    }
    this.initialized = true;
  }

  /** Redis falhou em runtime → desconecta o socket e passa a usar só memória. */
  private dropRedis(op: string, err: unknown): void {
    console.warn(`[Cache] Redis ${op} falhou, mudando para memória:`, (err as Error).message);
    try {
      this.redis?.disconnect();
    } catch {
      /* já desconectado */
    }
    this.redis = null;
  }

  /** Obter valor do cache (Redis -> Memória) */
  async get(key: string): Promise<string | null> {
    // 1. Tentar Redis primeiro
    if (this.redis) {
      try {
        const value = await this.redis.get(key);
        if (value) return value;
      } catch (err) {
        this.dropRedis("GET", err);
      }
    }

    // 2. Fallback para memória
    return this.memoryCache.get(key) || null;
  }

  /** Definir valor no cache (escreve em Redis + Memória) */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    const ttlSeconds = ttl ?? DEFAULT_TTL;

    // 1. Escrever em Redis (para persistência e sharing entre instâncias)
    if (this.redis) {
      try {
        await this.redis.set(key, value, "EX", ttlSeconds);
      } catch (err) {
        this.dropRedis("SET", err);
      }
    }

    // 2. Também escrever em memória para acesso rápido local
    this.memoryCache.set(key, value);
    this.ttlMap.set(key, Date.now() + ttlSeconds * 1000);

    // Limpeza de memória se exceder limite
    this.cleanupMemory();
  }

  /** Invalidar/chave específica */
  async del(key: string): Promise<boolean> {
    if (this.redis) {
      try {
        const result = await this.redis.del(key);
        return result > 0;
      } catch {
        // continue to memory cleanup
      }
    }
    return this.memoryCache.delete(key);
  }

  /** Buscar embedding serializado por hash do texto */
  async getEmbedding(textoHash: string): Promise<string | null> {
    const key = `${EMBEDDING_PREFIX}${textoHash}`;
    return this.get(key);
  }

  /** Definir embedding no cache */
  async setEmbedding(textoHash: string, vector: string): Promise<void> {
    const key = `${EMBEDDING_PREFIX}${textoHash}`;
    await this.set(key, vector, 604800); // 1 semana TTL para embeddings
  }

  /** Buscar resultados RAG por query hash */
  async getRagResults(queryHash: string): Promise<string | null> {
    const key = `${RAG_PREFIX}${queryHash}`;
    return this.get(key);
  }

  /** Definir resultados RAG no cache */
  async setRagResults(queryHash: string, results: string): Promise<void> {
    const key = `${RAG_PREFIX}${queryHash}`;
    await this.set(key, results, 3600); // 1 hora TTL para resultados RAG (mudam mais frequentemente)
  }

  /** Limpar entradas expiradas da memória */
  private cleanupMemory(): void {
    const now = Date.now();
    // Remover entradas expiradas
    for (const [key, expiry] of this.ttlMap.entries()) {
      if (now > expiry) {
        this.memoryCache.delete(key);
        this.ttlMap.delete(key);
      }
    }
    // Se exceder limite, remover entradas mais antigas
    if (this.memoryCache.size > this.MAX_MEMORY_ENTRIES) {
      const entries = Array.from(this.memoryCache.entries());
      // Ordenar pelo tempo de expiração (mais antigos primeiro)
      entries.sort((a, b) => {
        const expiryA = this.ttlMap.get(a[0]) ?? 0;
        const expiryB = this.ttlMap.get(b[0]) ?? 0;
        return expiryA - expiryB;
      });
      const toRemove = entries.slice(0, entries.length - this.MAX_MEMORY_ENTRIES);
      for (const [key] of toRemove) {
        this.memoryCache.delete(key);
        this.ttlMap.delete(key);
      }
    }
  }

  /** Verificar se Redis está disponível */
  isRedisAvailable(): boolean {
    return this.redis !== null;
  }

  /**
   * Fecha a conexão Redis e libera o event loop.
   * Sem isto, o socket do ioredis (com reconnect automático) mantém o
   * processo vivo — o que trava runners com `--test-timeout=0`.
   */
  async close(): Promise<void> {
    if (this.redis) {
      try {
        this.redis.disconnect();
      } catch {
        // ignora — já desconectado
      }
      this.redis = null;
    }
    this.memoryCache.clear();
    this.ttlMap.clear();
    this.initialized = false;
  }

  /** Obter status do cache */
  getStatus(): {
    redis: boolean;
    memoryEntries: number;
    redisUrl: string;
  } {
    return {
      redis: this.isRedisAvailable(),
      memoryEntries: this.memoryCache.size,
      redisUrl: this.REDIS_URL,
    };
  }
}

export const cache = new CacheService();
export default CacheService;