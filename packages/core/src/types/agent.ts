/**
 * Schema unificado de agente: permissões de tools, skills e guardrails.
 * Cada soul pode ter um campo `agent` no config.json que define
 * quais tools pode usar e quais restrições apply.
 *
 * Filosofia: Strict Allowlist (Zero Trust).
 * Se a soul não declarar tools, usa DEFAULT_ALLOWED_TOOLS.
 */

// ── Tipos ──────────────────────────────────────────────────────────────

export type ToolPattern = string;

export interface AgentPermissions {
  /** Strict allowlist de tools. Suporta wildcards: "memory:*", "ado_list_*". */
  tools: ToolPattern[];
  /** Skills vinculadas a este agente (nomes dos .opencode/skills/). */
  skills?: string[];
}

export interface AgentGuardrails {
  /** Teto de tokens por dia (units do provedor). */
  dailyLimitTokens?: number;
  /** Máximo de turnos (prompts) por sessão. */
  maxTurns?: number;
  /** Máximo de iterações em loops agentic (LangGraph etc). */
  maxIterations?: number;
  /** Threshold de relevância RAG (0..1). Override do global 0.70. */
  ragRelevanceThreshold?: number;
  /** Domínios permitidos para browser_*, HTTP etc. ["*"] = todos. */
  allowedOrigins?: string[];
}

export interface AgentConfig {
  provider?: string;
  model?: string;
  permissions: AgentPermissions;
  guardrails: AgentGuardrails;
}

// ── Fallback Default-Safe ──────────────────────────────────────────────

/**
 * Tools permitidas quando a soul NÃO tem campo `agent` no config.json.
 * Mantém backward compatibility: todas as tools core ficam disponíveis,
 * exceto browser_* e ado_* (que exigem config explícita).
 */
export const DEFAULT_ALLOWED_TOOLS: ToolPattern[] = [
  "memory:*",
  "soul_context",
  "soul_chat",
  "graph_list",
  "observation_add",
  "soul_anotar",
  "soul_licao",
  "soul_decidir",
  "agenda_add",
  "agenda_list",
  "action_execute",
  "costs_summary",
  "router_status",
  "spec_grill_plan",
];

export const DEFAULT_GUARDRAILS: AgentGuardrails = {
  maxTurns: 10,
  maxIterations: 5,
  ragRelevanceThreshold: 0.70,
};

// ── Pattern Matching ───────────────────────────────────────────────────

/**
 * Verifica se um toolName corresponde a um padrão.
 *
 * Suporta:
 *  - Exact:     "soul_context"     → match só "soul_context"
 *  - Namespace: "memory:*"         → match "memory_search", "memory_index" etc
 *  - Wildcard:  "ado_list_*"       → match "ado_list_projects", "ado_list_repositories"
 *  - Glob:      "*"                → match tudo
 */
export function matchesToolPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true;

  if (pattern.endsWith(":*")) {
    const ns = pattern.slice(0, -2);
    return toolName === ns || toolName.startsWith(ns + "_");
  }

  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    );
    return regex.test(toolName);
  }

  return pattern === toolName;
}

/**
 * Verifica se um toolName está na allowlist.
 * Retorna true se ALGUM pattern casar.
 */
export function isToolAllowed(patterns: ToolPattern[], toolName: string): boolean {
  return patterns.some((p) => matchesToolPattern(p, toolName));
}

/**
 * Resolve as tools permitidas para uma soul, aplicando fallback.
 */
export function resolveAllowedTools(agentConfig?: AgentConfig): ToolPattern[] {
  return agentConfig?.permissions?.tools ?? DEFAULT_ALLOWED_TOOLS;
}

/**
 * Resolve os guardrails para uma soul, aplicando fallback.
 */
export function resolveGuardrails(agentConfig?: AgentConfig): Required<
  Pick<AgentGuardrails, "maxTurns" | "maxIterations" | "ragRelevanceThreshold">
> & AgentGuardrails {
  const g = agentConfig?.guardrails ?? {};
  return {
    maxTurns: g.maxTurns ?? DEFAULT_GUARDRAILS.maxTurns!,
    maxIterations: g.maxIterations ?? DEFAULT_GUARDRAILS.maxIterations!,
    ragRelevanceThreshold: g.ragRelevanceThreshold ?? DEFAULT_GUARDRAILS.ragRelevanceThreshold!,
    ...g,
  };
}
