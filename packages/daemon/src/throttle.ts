/**
 * Rate limiting e cap de concorrência do daemon (Onda 1b da remediação).
 *
 * O daemon só tinha limite de *gasto* (`dailyLimit`) e de *turnos* (`maxTurns`).
 * Nada barrava um cliente (com o token) de disparar milhares de `/chat` por
 * minuto — cada um spawna um subprocesso (`opencode run`) ou roda o grafo
 * LangGraph — até esgotar CPU / memória / conexões do Postgres.
 *
 * Dois guardas, ambos in-process (é um daemon single-process):
 *  1. **Rate limit** por cliente, janela fixa. Default 600 req / 60 s — generoso
 *     de propósito: pega loop descontrolado (milhares/s), não modela tráfego.
 *  2. **Semáforo** de execuções caras simultâneas (`/chat`, missões, pipelines).
 *     Default 8. Estouro → 503 imediato, sem enfileirar.
 *
 * `AOS_RATE_LIMIT=0` ou `AOS_MAX_CONCURRENT_EXEC=0` desliga o guarda respectivo.
 */

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

// ── Rate limit (janela fixa por cliente) ───────────────────────────────

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export function rateLimitConfig(): RateLimitConfig {
  return { max: intEnv("AOS_RATE_LIMIT", 600), windowMs: intEnv("AOS_RATE_WINDOW_SEC", 60) * 1000 };
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
}

/** Contabiliza um hit do cliente `key`. `max <= 0` desliga (sempre ok). */
export function rateLimitHit(key: string, cfg: RateLimitConfig = rateLimitConfig(), now = Date.now()): RateLimitResult {
  if (cfg.max <= 0) return { ok: true, retryAfterSec: 0, remaining: Number.POSITIVE_INFINITY };
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + cfg.windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > cfg.max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)), remaining: 0 };
  }
  return { ok: true, retryAfterSec: 0, remaining: cfg.max - b.count };
}

/** Só para testes. */
export function __resetRateLimiter(): void {
  buckets.clear();
}

// ── Semáforo de execuções caras ───────────────────────────────────────

export function maxConcurrentExec(): number {
  return intEnv("AOS_MAX_CONCURRENT_EXEC", 8);
}

let inFlight = 0;

/** Tenta pegar um slot. `false` = no limite (o chamador deve responder 503). */
export function tryAcquireExecSlot(): boolean {
  const cap = maxConcurrentExec();
  if (cap <= 0) return true;
  if (inFlight >= cap) return false;
  inFlight += 1;
  return true;
}

export function releaseExecSlot(): void {
  if (inFlight > 0) inFlight -= 1;
}

export function execInFlight(): number {
  return inFlight;
}

/** Só para testes. */
export function __resetExecSlots(): void {
  inFlight = 0;
}

/** Rotas que seguram um slot do semáforo pela duração da execução. */
const EXPENSIVE_RE = /^\/souls\/[^/]+\/chat$|^\/api\/missions\/|^\/api\/pipelines\//;

export function isExpensivePath(path: string): boolean {
  return EXPENSIVE_RE.test(path);
}
