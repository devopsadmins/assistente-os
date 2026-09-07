/**
 * Telemetria unificada de chamadas LLM fora do fluxo de chat (Epic B).
 *
 * Antes, só `routes/chat.ts` gravava o quarteto (cost_calls + execution_logs +
 * router_history status='executed' + Prometheus). Pipelines e orquestradores
 * (email-ingest, spec-grill, meeting-ingest, entity-extraction, mission-runner)
 * chamavam o Ollama e descartavam `prompt_eval_count`/`eval_count`. Este helper
 * fecha essa lacuna com uma única chamada.
 */
import type { Pool, Soul } from "@assistente-os/core";
import { recordCostCall, recordExecution, recordRouterSelection, estimateTokens, calcCost } from "@assistente-os/core";
import { tokensTotal, llmLatency } from "./metrics.js";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  source: "provider" | "estimate";
}

/**
 * Deriva `LlmUsage` de uma resposta `/api/chat` do Ollama (stream:false).
 * Usa `prompt_eval_count`/`eval_count` quando presentes (source "provider");
 * senão cai para a heurística chars/4 sobre os textos (source "estimate").
 */
export function ollamaUsage(
  data: unknown,
  startedAt: number,
  promptText: string,
  outputText: string,
): LlmUsage {
  const d = (data ?? {}) as { prompt_eval_count?: number; eval_count?: number };
  const hasProvider =
    typeof d.prompt_eval_count === "number" || typeof d.eval_count === "number";
  return {
    promptTokens: hasProvider ? d.prompt_eval_count ?? 0 : estimateTokens(promptText),
    completionTokens: hasProvider ? d.eval_count ?? 0 : estimateTokens(outputText),
    latencyMs: Date.now() - startedAt,
    source: hasProvider ? "provider" : "estimate",
  };
}

export interface LlmCallRecord {
  pool: Pool;
  /** Soul completa ou só o id — só `.id` é usado. */
  soul: Soul | { id: string };
  /** Rótulo da origem: "email-ingest" | "spec-grill" | "meeting-ingest" | "entity-extraction" | "mission:<id>" */
  route: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** "provider" quando veio de prompt_eval_count/eval_count; "estimate" quando é heurística chars/4. */
  source: "provider" | "estimate";
  status?: "ok" | "failed";
  sessionId?: number | null;
}

/**
 * Grava uma chamada LLM em cost_calls + execution_logs + router_history
 * (status='executed', para entrar em getUsageSummary) + métricas Prometheus.
 * Nunca lança — telemetria não pode derrubar a operação principal.
 */
export async function recordLlmCall(r: LlmCallRecord): Promise<void> {
  const ok = (r.status ?? "ok") === "ok";
  const promptTokens = ok ? r.promptTokens : 0;
  const completionTokens = ok ? r.completionTokens : 0;
  try {
    await recordCostCall(r.pool, {
      soul: r.soul.id,
      provider: r.provider,
      model: r.model,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cost: calcCost(r.provider, r.model, promptTokens, completionTokens),
      status: r.status ?? "ok",
      note: `route=${r.route}; latency_ms=${r.latencyMs}; tokens=${r.source}`,
    });
    await recordExecution(r.pool, {
      sessionId: r.sessionId ?? null,
      soul: r.soul.id,
      kind: r.route,
      model: r.model,
      tokensIn: promptTokens,
      tokensOut: completionTokens,
      status: r.status ?? "ok",
      note: `latency_ms=${r.latencyMs}`,
    });
    await recordRouterSelection(r.pool, {
      soul: { id: r.soul.id },
      target: { tier: r.route, provider: r.provider, model: r.model },
      reason: `pipeline ${r.route}`,
      status: "executed",
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      modelUsed: r.model,
      executionMode: r.route,
      tokenSource: r.source,
      latencyMs: r.latencyMs,
    });
  } catch {
    /* telemetria best-effort */
  }
  try {
    tokensTotal.inc(
      { soul: r.soul.id, tier: r.route, kind: "prompt", source: r.source, route: r.route },
      promptTokens,
    );
    tokensTotal.inc(
      { soul: r.soul.id, tier: r.route, kind: "completion", source: r.source, route: r.route },
      completionTokens,
    );
    llmLatency.observe({ route: r.route }, r.latencyMs / 1000);
  } catch {
    /* métricas opcionais */
  }
}
