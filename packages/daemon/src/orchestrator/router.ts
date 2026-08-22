/**
 * Modo de Roteamento Dinâmico — Fast Mode vs. Pro Mode
 *
 * Chave de execução no orquestrador que seleciona o modo de processamento
 * com base na complexidade do prompt e capacidade desejada.
 *
 * Fast Mode:
 *   - Execução linear com modelo local leve (Ollama / nemotron-3-ultra-free)
 *   - Recuperação de contexto pontual (K=3)
 *   - Limite de 2 iterações
 *   - Sem deep extraction de links/relacionamentos
 *
 * Pro Mode:
 *   - Ativação completa com busca híbrida 70/30 (semântica + literal)
 *   - Extração profunda de links/relacionamentos
 *   - Teto de até 5 iterações com feedback loop
 *   - Modelo configurável (provider da soul ou zen)
 *
 * Integra com o route() existente de @assistente-os/core para resolução
 * de tier (local/zen/soul), e com o engine de LLM do daemon.
 */

import type { Pool } from "pg";
import type { AssistenteOsConfig } from "@assistente-os/core";
import type { Soul } from "@assistente-os/core";
import { route, selectRoute, type RouteDecision, type RouterProbe } from "@assistente-os/core";

// ── Tipos ──────────────────────────────────────────────────────────────

export type ExecutionMode = "fast" | "pro";

export interface RoutingDecision {
  mode: ExecutionMode;
  maxIterations: number;
  ragTopK: number;
  ragRatio: { semantic: number; literal: number };
  model: string;
  deepExtraction: boolean;
  route: RouteDecision;
}

export interface ModeSelectionInput {
  prompt: string;
  soul?: Soul;
  explicitMode?: ExecutionMode;
}

// ── Configuração por Modo ──────────────────────────────────────────────

const FAST_CONFIG: Omit<RoutingDecision, "model" | "route"> = {
  mode: "fast",
  maxIterations: 2,
  ragTopK: 3,
  ragRatio: { semantic: 1.0, literal: 0.0 },
  deepExtraction: false,
};

const PRO_CONFIG: Omit<RoutingDecision, "model" | "route"> = {
  mode: "pro",
  maxIterations: 5,
  ragTopK: 5,
  ragRatio: { semantic: 0.7, literal: 0.3 },
  deepExtraction: true,
};

// ── Keywords de Complexidade ───────────────────────────────────────────

/**
 * Keywords que indicam necessidade de Pro Mode (pesquisa profunda,
 * análise de tabelas, scraping, relações, etc.).
 */
const PRO_KEYWORDS = [
  // Scraping/navegação
  "scrape", "raspar", "extrair dados", "web scraping",
  // Análise profunda
  "análise completa", "análise detalhada", "relatório completo",
  "comparar", "comparação", "benchmark",
  // Tabelas/dados estruturados
  "tabela", "planilha", "dados estruturados", "CSV",
  // Relações/grafo
  "relação", "relacionamento", "dependência", "impacto",
  "quem depende", "quais afetam",
  // Multi-step
  "passo a passo", "pipeline", "workflow", "fluxo",
  // Link extraction
  "links", "urls", "hyperlinks", "navegar",
];

// ── Seleção de Modo ────────────────────────────────────────────────────

/**
 * Determina o modo de execução (fast vs pro) com base no prompt.
 *
 * Critérios para Pro Mode:
 * 1. Modo explícito solicitado pelo chamador
 * 2. Prompt contém keywords de complexidade
 * 3. Prompt > 500 chars (indicativo de instrução elaborada)
 *
 * Critérios para Fast Mode (default):
 * 1. Prompt simples e direto
 * 2. Prompt < 500 chars sem keywords especiais
 */
export function selectExecutionMode(input: ModeSelectionInput): ExecutionMode {
  // 1. Modo explícito
  if (input.explicitMode === "fast" || input.explicitMode === "pro") {
    return input.explicitMode;
  }

  const promptLower = input.prompt.toLowerCase();

  // 2. Keywords de complexidade
  for (const kw of PRO_KEYWORDS) {
    if (promptLower.includes(kw)) return "pro";
  }

  // 3. Tamanho do prompt (heurística)
  if (input.prompt.length > 500) return "pro";

  // Default: fast
  return "fast";
}

// ── Roteamento Dinâmico ────────────────────────────────────────────────

/**
 * Roteamento dinâmico completo: seleciona o modo e roteia o tier.
 *
 * Fast Mode:
 *   - Usa selectRoute (sonda barata, sem efeitos colaterais)
 *   - Modelo: ollamaChatModel (local) ou nemotron-3-ultra-free
 *
 * Pro Mode:
 *   - Usa route (com probe real)
 *   - Modelo: provider da soul ou zen
 */
export async function routeWithMode(
  pool: Pool,
  config: AssistenteOsConfig,
  soul: Soul,
  probe: RouterProbe,
  explicitMode?: ExecutionMode,
): Promise<RoutingDecision> {
  const modeSelection = selectExecutionMode({ prompt: "", soul, explicitMode });
  const modeConfig = modeSelection === "fast" ? FAST_CONFIG : PRO_CONFIG;

  let routeDecision: RouteDecision;

  if (modeSelection === "fast") {
    // Fast: mesma sonda barata do pro mode, mas ainda cai pro próximo degrau
    // se o local não responder (selectRoute() delega pra route() quando
    // recebe um probe — sem isso, fast mode nunca tinha fallback de verdade).
    routeDecision = await selectRoute(pool, config, soul, config.routerTiers, probe);
  } else {
    // Pro: roteamento completo com probe
    routeDecision = await route(pool, config, soul, probe);
  }

  const model = resolveModel(modeSelection, config, soul);

  return {
    ...modeConfig,
    model,
    route: routeDecision,
  };
}

/**
 * Roteamento dinâmico a partir de um prompt (para chat endpoint).
 * Auto-detecta o modo baseado no conteúdo do prompt.
 */
export async function routeFromPrompt(
  pool: Pool,
  config: AssistenteOsConfig,
  soul: Soul,
  prompt: string,
  probe: RouterProbe,
  explicitMode?: ExecutionMode,
): Promise<RoutingDecision> {
  const mode = selectExecutionMode({ prompt, soul, explicitMode });
  const modeConfig = mode === "fast" ? FAST_CONFIG : PRO_CONFIG;

  let routeDecision: RouteDecision;

  if (mode === "fast") {
    routeDecision = await selectRoute(pool, config, soul, config.routerTiers, probe);
  } else {
    routeDecision = await route(pool, config, soul, probe);
  }

  const model = resolveModel(mode, config, soul);

  return {
    ...modeConfig,
    model,
    route: routeDecision,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function resolveModel(mode: ExecutionMode, config: AssistenteOsConfig, soul: Soul): string {
  if (mode === "fast") {
    // Fast: prioriza modelo local
    return config.ollamaChatModel;
  }
  // Pro: modelo da soul ou fallback
  return soul.config.models?.chat ?? config.ollamaChatModel;
}

/**
 * Retorna descrição legível do modo selecionado (para logging/audit).
 */
export function describeMode(decision: RoutingDecision): string {
  return [
    `Modo: ${decision.mode.toUpperCase()}`,
    `Modelo: ${decision.model}`,
    `Tier: ${decision.route.target.tier}`,
    `Max iterações: ${decision.maxIterations}`,
    `RAG top-K: ${decision.ragTopK}`,
    `Deep extraction: ${decision.deepExtraction ? "sim" : "não"}`,
  ].join(" | ");
}
