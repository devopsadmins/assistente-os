import type { Pool } from "pg";
import type { AssistenteOsConfig } from "./config.js";
import type { Soul } from "./souls.js";

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

/**
 * Seleciona o primeiro degrau configurado sem executar uma tarefa.
 *
 * Use esta função quando a operação que seguirá a seleção tiver efeitos
 * colaterais (por exemplo, um prompt que pode alterar arquivos). `route()`
 * continua existindo para sondas que são comprovadamente seguras de repetir.
 */
/** Grava uma escolha de roteador no histórico (kernel.db), imutável. */
export async function recordRouterSelection(
  pool: Pool,
  soul: Soul,
  target: RouteTarget,
  reason: string,
  status: "selected" | "ok" | "fail" = "selected",
): Promise<void> {
  await pool.query(
    `INSERT INTO router_history (ts, soul, tier, provider, model, status, latency_ms, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [new Date().toISOString(), soul.id, target.tier, target.provider, target.model, status, null, reason],
  );
}

export async function selectRoute(
  pool: Pool,
  config: AssistenteOsConfig,
  soul: Soul,
  tiers: string[] = config.routerTiers,
): Promise<RouteDecision> {
  const tier = tiers[0] ?? "soul";
  const target = resolveTarget(config, soul, tier);
  await recordRouterSelection(pool, soul, target, "seleção sem sonda");
  return { target };
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
