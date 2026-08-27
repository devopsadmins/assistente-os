/**
 * Catálogo de capabilities (L1/L2/L3) e função central de política de
 * execução (docs/PLANO-CRIACAO-SOULS.md §C1, §4).
 *
 * `authorizeExecution` é uma função pura: budget e confirmação chegam já
 * resolvidos pelo chamador ({ok, reason}), nunca como callbacks — isso
 * mantém a função testável sem I/O e permite que os itens que dependem de
 * Postgres (budget real, confirmação com TTL) só precisem preencher esses
 * valores antes de chamar, sem mudar a assinatura pública.
 */

import type { StableErrorCode } from "./errors.js";
import type { AgentConfig, ToolPattern } from "./types/agent.js";
import {
  isToolAllowed,
  matchesToolPattern,
  resolveAllowedTools,
  resolveApprovalPolicy,
  resolveAutonomy,
  resolveConnectors,
} from "./types/agent.js";

// ── Catálogo de capabilities ────────────────────────────────────────────

export type RiskLevel = "L1" | "L2" | "L3";

export interface CapabilityCatalogEntry {
  pattern: ToolPattern;
  level: RiskLevel;
  description?: string;
}

export const CAPABILITY_CATALOG_VERSION = "1.0.0";

/**
 * Catálogo fechado e versionado de capabilities conhecidas, com nível de
 * risco. Duas classificações não estão explícitas no doc e foram fechadas
 * por decisão do usuário:
 *  - leituras a sistemas externos (ado_list_*, ado_get_work_item etc.): L2
 *    (sujeitas a autonomy, sem exigir confirmação individual L3).
 *  - action_execute: L3 inteiro (o doc contradiz a si mesmo entre "L2 local"
 *    e "L3"; não há hoje forma de diferenciar efeito local/externo em
 *    runtime, então tratamos a tool inteira como alto privilégio).
 */
export const CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [
  // L1 — leitura local, sem efeito persistente
  { pattern: "memory_search", level: "L1" },
  { pattern: "memory_status", level: "L1" },
  { pattern: "soul_context", level: "L1" },
  { pattern: "graph_list", level: "L1" },
  { pattern: "agenda_list", level: "L1" },
  { pattern: "router_status", level: "L1" },
  { pattern: "costs_summary", level: "L1" },
  { pattern: "soul_get_lessons", level: "L1" },
  { pattern: "souls_list", level: "L1" },
  { pattern: "soul_create_questions", level: "L1" },

  // L2 — escrita local reversível (altera estado próprio da soul)
  { pattern: "observation_add", level: "L2" },
  { pattern: "agenda_add", level: "L2" },
  { pattern: "soul_anotar", level: "L2" },
  { pattern: "soul_licao", level: "L2" },
  { pattern: "soul_decidir", level: "L2" },
  { pattern: "soul_record_lesson", level: "L2" },
  { pattern: "memory_index", level: "L2" },
  { pattern: "soul_generate_aiia", level: "L2" },

  // L2 — leituras a sistemas externos (classificação fechada com o usuário)
  { pattern: "ado_list_projects", level: "L2" },
  { pattern: "ado_list_repositories", level: "L2" },
  { pattern: "ado_list_work_items", level: "L2" },
  { pattern: "ado_get_work_item", level: "L2" },
  { pattern: "ado_list_pipelines", level: "L2" },
  { pattern: "ado_list_pull_requests", level: "L2" },

  // L3 — efeito externo / alto privilégio
  { pattern: "browser_*", level: "L3" },
  { pattern: "ado_create_work_item", level: "L3" },
  { pattern: "ado_update_work_item", level: "L3" },
  { pattern: "ado_run_pipeline", level: "L3" },
  { pattern: "ado_create_pull_request", level: "L3" },
  { pattern: "guardian_*", level: "L3" },
  { pattern: "sales_*", level: "L3" },
  { pattern: "soul_chat", level: "L3" },
  { pattern: "action_execute", level: "L3" },
  { pattern: "soul_create", level: "L3" },
  { pattern: "spec_grill_plan", level: "L3" },
  { pattern: "worktree_merge_locally", level: "L3", description: "Merge local de worktree — efeito irreversível na árvore de trabalho" },
  { pattern: "git_commit_push", level: "L3", description: "Commit + push remoto — efeito externo irreversível" },
  { pattern: "annotate_diff", level: "L2", description: "Anotação de diff no grafo da soul — escrita local reversível" },
];

/** Retorna o nível de risco de uma capability, ou undefined se desconhecida. */
export function capabilityRiskLevel(name: string): RiskLevel | undefined {
  const exact = CAPABILITY_CATALOG.find((e) => e.pattern === name);
  if (exact) return exact.level;
  const wildcardMatches = CAPABILITY_CATALOG.filter(
    (e) => e.pattern.includes("*") && matchesToolPattern(e.pattern, name),
  );
  if (wildcardMatches.length === 0) return undefined;
  // Pattern mais específico (mais longo) vence entre múltiplos wildcards.
  wildcardMatches.sort((a, b) => b.pattern.length - a.pattern.length);
  return wildcardMatches[0]?.level;
}

export function isKnownCapability(name: string): boolean {
  return capabilityRiskLevel(name) !== undefined;
}

// ── authorizeExecution() ─────────────────────────────────────────────────

export type PolicyDenyCode = Extract<StableErrorCode, "E_AUTHZ" | "E_CONNECTOR" | "E_BUDGET" | "E_POLICY_APPROVAL">;

export type PolicyDecision =
  | { allow: true; requiresApproval: boolean; approvalReason?: string }
  | { allow: false; code: PolicyDenyCode; reason: string };

/** Resultado JÁ RESOLVIDO pelo chamador — nunca um callback. */
export interface BudgetCheckResult {
  ok: boolean;
  reason?: string;
}

/** Resultado JÁ RESOLVIDO pelo chamador — nunca um callback. */
export interface ConfirmationCheckResult {
  ok: boolean;
  reason?: string;
}

export interface AuthorizeExecutionInput {
  soulId: string;
  /** Nome concreto da capability sendo invocada (não um pattern). */
  capability: string;
  agentConfig?: AgentConfig;
  /** Nome do conector/servidor MCP externo exigido por esta capability, se houver. */
  connector?: string;
  /** Hint defensivo: só pode ESCALAR o nível do catálogo, nunca rebaixar. */
  effect?: "read" | "write" | "external";
  /** undefined = não aplicável a esta capability (ex. capabilities L1 sem custo). */
  budget?: BudgetCheckResult;
  /** undefined = nenhuma confirmação vigente. */
  confirmation?: ConfirmationCheckResult;
  /** Patterns de denylist global / golden rules já resolvidos pelo chamador. */
  denylist?: string[];
}

function effectiveRiskLevel(capability: string, effect?: "read" | "write" | "external"): RiskLevel {
  const catalogLevel = capabilityRiskLevel(capability) ?? "L3"; // desconhecida = fail-closed
  if (effect === "external" && catalogLevel !== "L3") return "L3";
  return catalogLevel;
}

/**
 * Função central de autorização (docs/PLANO-CRIACAO-SOULS.md §C1). Ordem de
 * decisão — a primeira regra que casar vence:
 *   1. Denylist global / golden rules            → DENY (E_AUTHZ)
 *   2. Capability fora do snapshot resolvido      → DENY (E_AUTHZ)
 *   3. Conector não declarado em connectors[]     → DENY (E_CONNECTOR)
 *   4. Budget insuficiente                        → DENY (E_BUDGET)
 *   5. autonomy: suggest bloqueia L2+L3; ask bloqueia L3 sem confirmação; auto passa
 *   6. approvalPolicy: só ADICIONA exigência, nunca libera nada negado acima
 *   7. ALLOW
 */
export function authorizeExecution(input: AuthorizeExecutionInput): PolicyDecision {
  const { soulId, capability, agentConfig, connector, effect, budget, confirmation, denylist = [] } = input;

  // 1. Denylist global / golden rules
  if (denylist.some((p) => matchesToolPattern(p, capability))) {
    return { allow: false, code: "E_AUTHZ", reason: `capability '${capability}' bloqueada por regra global` };
  }

  // 2. Capability fora do snapshot resolvido da soul
  const allowedTools = resolveAllowedTools(agentConfig);
  if (!isToolAllowed(allowedTools, capability)) {
    return {
      allow: false,
      code: "E_AUTHZ",
      reason: `soul '${soulId}' não tem '${capability}' no snapshot resolvido`,
    };
  }

  // 3. Conector não declarado
  if (connector && !resolveConnectors(agentConfig).includes(connector)) {
    return {
      allow: false,
      code: "E_CONNECTOR",
      reason: `conector '${connector}' não declarado para a soul '${soulId}'`,
    };
  }

  // 4. Budget insuficiente
  if (budget && !budget.ok) {
    return { allow: false, code: "E_BUDGET", reason: budget.reason ?? "budget insuficiente" };
  }

  // 5. autonomy
  const level = effectiveRiskLevel(capability, effect);
  const autonomy = resolveAutonomy(agentConfig);
  if (autonomy === "suggest" && (level === "L2" || level === "L3")) {
    return {
      allow: false,
      code: "E_POLICY_APPROVAL",
      reason: `autonomy 'suggest' bloqueia '${capability}' (nível ${level})`,
    };
  }
  if (autonomy === "ask" && level === "L3" && !(confirmation && confirmation.ok)) {
    return {
      allow: false,
      code: "E_POLICY_APPROVAL",
      reason: `autonomy 'ask' exige confirmação vigente para '${capability}' (L3)`,
    };
  }
  // "auto": L3 já foi confirmado individualmente na criação/edição da soul — nada extra aqui.

  // 6. approvalPolicy — só ADICIONA exigência de aprovação, nunca libera o que foi negado acima
  const requiresApproval = resolveApprovalPolicy(agentConfig).some((p) => matchesToolPattern(p, capability));
  if (requiresApproval && !(confirmation && confirmation.ok)) {
    return {
      allow: false,
      code: "E_POLICY_APPROVAL",
      reason: `'${capability}' está em approvalPolicy e exige confirmação`,
    };
  }

  // 7. ALLOW
  return { allow: true, requiresApproval, approvalReason: requiresApproval ? "approvalPolicy" : undefined };
}
