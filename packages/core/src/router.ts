import type { Pool } from "pg";
import { createHash } from "node:crypto";
import type { AssistenteOsConfig } from "./config.js";
import type { Soul } from "./souls.js";
import { cache } from "./cache.js";

/** Discriminador de banco/schema para chaves de cache — evita servir resultado de outro schema (testes isolados por schema). */
function poolTag(pool: Pool): string {
  const cs = (pool as unknown as { options?: { connectionString?: string } }).options?.connectionString ?? "";
  return createHash("sha1").update(cs).digest("hex").slice(0, 8);
}

export interface RouteTarget {
  tier: string;
  provider: string;
  model: string;
}

export type RouterProbe = (target: RouteTarget) => Promise<RouterProbeResult>;

export interface RouterProbeResult {
  ok: boolean;
  reason?: string;
  latencyMs?: number;
  model?: string;
}

export interface RouteDecision {
  target: RouteTarget;
  latencyMs?: number;
  reason?: string;
}

/** Grava uma escolha de roteador no histórico (kernel.db), imutável. */
export interface RouterSelectionRecord {
  /** Só `.id` é usado — aceita a Soul completa ou um `{ id }` de pipeline. */
  soul: { id: string };
  target: RouteTarget;
  reason: string;
  /**
   * - `selected` — degrau escolhido antes de executar (legado; não entra em getUsageSummary).
   * - `ok`/`fail` — resultado de sonda gravado por route()/selectRoute() (linha de diagnóstico).
   * - `executed` — inferência de fato concluída neste degrau, com tokens reais/estimados.
   *   getUsageSummary() conta SÓ estas linhas (1 por turno de chat).
   */
  status?: "selected" | "ok" | "fail" | "executed";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  modelUsed?: string;
  executionMode?: string;
  /** "provider" (contagem real do LLM) ou "estimate" (heurística chars/4). Vai pro campo reason como sufixo. */
  tokenSource?: "provider" | "estimate";
  /** Latência da execução em ms. Preenche router_history.latency_ms (antes sempre null). */
  latencyMs?: number;
}

export async function recordRouterSelection(
  pool: Pool,
  input: RouterSelectionRecord,
): Promise<void> {
  const { soul, target, reason, status = "selected", promptTokens = 0, completionTokens = 0, totalTokens = 0, modelUsed, executionMode, tokenSource, latencyMs } = input;
  const reasonWithSource = tokenSource ? `${reason} [tokens:${tokenSource}]` : reason;
  await pool.query(
    `INSERT INTO router_history (ts, soul, tier, provider, model, status, latency_ms, reason, prompt_tokens, completion_tokens, total_tokens, model_used, execution_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [new Date().toISOString(), soul.id, target.tier, target.provider, target.model, status, latencyMs ?? null, reasonWithSource, promptTokens, completionTokens, totalTokens, modelUsed ?? null, executionMode ?? null],
  );
}

/**
 * Seleciona um degrau configurado, com sonda opcional e fallback pro próximo
 * degrau se o atual não responder.
 *
 * Sem `probe`, mantém o comportamento histórico (pega o primeiro degrau sem
 * checar disponibilidade) — é o que `agenda.ts`/`events.ts` querem, já que a
 * tarefa disparada em seguida tem efeitos colaterais e não deve ser tentada
 * contra vários provedores. Com `probe`, delega pra `route()` (mesma sonda
 * barata do modo "pro") — usado pelo chat em modo "fast", que antes escolhia
 * o degrau "local" incondicionalmente e nunca caía pro próximo se o Ollama
 * estivesse fora do ar, quebrando o fallback local-first que é a proposta
 * central do roteador.
 */
export async function selectRoute(
  pool: Pool,
  config: AssistenteOsConfig,
  soul: Soul,
  tiers: string[] = config.routerTiers,
  probe: RouterProbe = async () => ({ ok: true }),
): Promise<RouteDecision> {
  return route(pool, config, soul, probe, tiers);
}

/**
 * Roteador local-first: percorre os degraus em ordem e devolve o primeiro
 * que responde. Degrau padrão: "local" (Ollama) -> "zen" (grátis) -> "soul"
 * (provedor da alma). Registra cada tentativa no kernel.db (imutável).
 */
export async function route(
  pool: Pool,
  config: AssistenteOsConfig,
  soul: Soul,
  probe: RouterProbe,
  tiers: string[] = config.routerTiers,
): Promise<RouteDecision> {
  const lastError: string[] = [];
  for (const tier of tiers) {
    const target = resolveTarget(config, soul, tier);
    let result: RouterProbeResult;
    try {
      result = await probe(target);
    } catch (err) {
      result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const ts = new Date().toISOString();
    await pool.query(
      `INSERT INTO router_history (ts, soul, tier, provider, model, status, latency_ms, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ts, soul.id, target.tier, target.provider, result.model ?? target.model, result.ok ? "ok" : "fail", result.latencyMs ?? null, result.reason ?? null],
    );
    if (result.ok) {
      return { target: { ...target, model: result.model ?? target.model }, latencyMs: result.latencyMs, reason: undefined };
    }
    lastError.push(`[${tier}] ${result.reason ?? "sem resposta"}`);
  }
  return {
    target: resolveTarget(config, soul, tiers[tiers.length - 1] ?? "soul"),
    reason: lastError.join("; ") || "nenhum degrau respondeu",
  };
}

export function resolveTarget(config: AssistenteOsConfig, soul: Soul, tier: string): RouteTarget {
  switch (tier) {
    case "local": {
      const m = config.ollamaChatModel;
      // provider "ollama" customizado no opencode.jsonc (@ai-sdk/openai-compatible -> OLLAMA_URL/v1)
      const bare = m.replace(/^(ollama|openai)\//, "");
      return { tier, provider: "ollama", model: `ollama/${bare}` };
    }
    case "zen":
      return { tier, provider: "zen", model: "zen" };
    case "soul": {
      const provider = soul.config.provider ?? "zen-" + soul.id;
      return { tier, provider, model: soul.config.models?.chat ?? provider };
    }
    default:
      return { tier, provider: tier, model: tier };
  }
}

export interface UsageSummaryFilters {
  soul?: string;
  from?: string; // ISO date
  to?: string;   // ISO date
}

export interface UsageSummaryRow {
  soul: string;
  total_calls: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  by_mode: Record<string, { calls: number; tokens: number }>;
  by_model: Record<string, { calls: number; tokens: number }>;
}

/**
 * Consulta agregada de uso/tokens por soul e período.
 * Usada pelo endpoint GET /api/costs/usage e CLI `os costs usage`.
 */
export async function getUsageSummary(
  pool: Pool,
  filters: UsageSummaryFilters = {},
): Promise<UsageSummaryRow[]> {
  // Cache em camadas (E4): a aba Telemetria faz polling; ~30s de staleness é
  // aceitável e evita reagregar router_history a cada request. Redis quando
  // disponível, senão memória; degrada em silêncio se o cache falhar.
  const cacheKey = `usage:${poolTag(pool)}:${JSON.stringify(filters)}`;
  try {
    const hit = await cache.get(cacheKey);
    if (hit) return JSON.parse(hit) as UsageSummaryRow[];
  } catch {
    /* cache opcional */
  }

  // Só linhas de execução real entram na agregação de custo/uso. route()/selectRoute()
  // gravam uma linha por sonda de degrau (status 'ok'/'fail', 0 tokens) — sem este
  // filtro cada turno de chat contaria N vezes e diluía tokens com zeros.
  const conditions: string[] = ["status = 'executed'"];
  const params: (string | number)[] = [];
  let paramIdx = 1;

  if (filters.soul) {
    conditions.push(`soul = $${paramIdx++}`);
    params.push(filters.soul);
  }
  if (filters.from) {
    conditions.push(`ts >= $${paramIdx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`ts <= $${paramIdx++}`);
    params.push(filters.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Aggregation principal + breakdown por mode e model
  const { rows } = await pool.query<UsageSummaryRow>(
    `SELECT
       soul,
       COUNT(*) AS total_calls,
       COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
       COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COALESCE(
         JSON_OBJECT_AGG(
           execution_mode,
           JSON_BUILD_OBJECT('calls', mode_calls, 'tokens', mode_tokens)
         ) FILTER (WHERE execution_mode IS NOT NULL),
         '{}'::json
       ) AS by_mode,
       COALESCE(
         JSON_OBJECT_AGG(
           model_used,
           JSON_BUILD_OBJECT('calls', model_calls, 'tokens', model_tokens)
         ) FILTER (WHERE model_used IS NOT NULL),
         '{}'::json
       ) AS by_model
     FROM (
       SELECT
         soul,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         execution_mode,
         model_used,
         COUNT(*) OVER (PARTITION BY soul, execution_mode) AS mode_calls,
         SUM(total_tokens) OVER (PARTITION BY soul, execution_mode) AS mode_tokens,
         COUNT(*) OVER (PARTITION BY soul, model_used) AS model_calls,
         SUM(total_tokens) OVER (PARTITION BY soul, model_used) AS model_tokens
       FROM router_history
       ${where}
     ) sub
     GROUP BY soul
     ORDER BY total_tokens DESC`,
    params,
  );

  try {
    await cache.set(cacheKey, JSON.stringify(rows), 30);
  } catch {
    /* cache opcional */
  }
  return rows;
}
