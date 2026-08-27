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

/** Nível de autonomia da soul (ver docs/PLANO-CRIACAO-SOULS.md §C1). */
export type Autonomy = "suggest" | "ask" | "auto";

/** Classificação de sensibilidade de dados/memória da soul. */
export type DataClassification = "public" | "internal" | "confidential" | "restricted" | "prohibited";

export interface MemoryPolicy {
  classification: DataClassification;
  retention?: string;
  /** v1 entrega só 4 pontos mínimos de enforcement (ver §C4/§13) — sempre "partial". */
  enforcement: "partial";
}

export interface AgentPermissions {
  /** Strict allowlist de tools. Suporta wildcards: "memory:*", "ado_list_*". */
  tools: ToolPattern[];
  /** Skills vinculadas a este agente (nomes dos .opencode/skills/). */
  skills?: string[];
  /** Conectores/servidores MCP externos declarados e autorizados para esta soul. */
  connectors?: string[];
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
  /** suggest|ask|auto — ver authorizeExecution() em policy.ts. Default: "ask". */
  autonomy?: Autonomy;
  /** Capabilities que sempre exigem confirmação humana, além do que autonomy já exige. */
  approvalPolicy?: ToolPattern[];
  memoryPolicy?: MemoryPolicy;
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
  "worktree_create",
  "worktree_merge_locally",
  "worktree_destroy",
  "worktree_list",
  "git_commit_push",
];

export const DEFAULT_GUARDRAILS: AgentGuardrails = {
  maxTurns: 10,
  maxIterations: 5,
  ragRelevanceThreshold: 0.70,
};

/** Default de retrocompatibilidade para souls sem `autonomy` declarada (§9). */
export const DEFAULT_AUTONOMY: Autonomy = "ask";

/** Default de retrocompatibilidade para souls sem `memoryPolicy` declarada (§9). */
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  classification: "internal",
  enforcement: "partial",
};

/** Guardrails globais (piso de segurança) — nenhuma soul pode ampliá-los, só restringir. */
export interface GlobalGuardrails {
  maxTurns: number;
  maxIterations: number;
  ragRelevanceThreshold: number;
  dailyLimitTokens?: number;
}

export const DEFAULT_GLOBAL_GUARDRAILS: GlobalGuardrails = {
  maxTurns: 10,
  maxIterations: 5,
  ragRelevanceThreshold: 0.70,
};

/** Resolve conectores externos declarados para a soul, aplicando fallback (§9: connectors=[]). */
export function resolveConnectors(agentConfig?: AgentConfig): string[] {
  return agentConfig?.permissions?.connectors ?? [];
}

/** Resolve o nível de autonomia da soul, aplicando fallback (§9: autonomy="ask"). */
export function resolveAutonomy(agentConfig?: AgentConfig): Autonomy {
  return agentConfig?.autonomy ?? DEFAULT_AUTONOMY;
}

/** Resolve a approvalPolicy da soul, aplicando fallback (lista vazia = nada exige aprovação extra). */
export function resolveApprovalPolicy(agentConfig?: AgentConfig): ToolPattern[] {
  return agentConfig?.approvalPolicy ?? [];
}

/** Resolve a memoryPolicy da soul, aplicando fallback (§9: enforcement="partial"). */
export function resolveMemoryPolicy(agentConfig?: AgentConfig): MemoryPolicy {
  return agentConfig?.memoryPolicy ?? DEFAULT_MEMORY_POLICY;
}

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

/**
 * Clampa um limite da soul contra o teto global — "mais restritivo vence".
 * Usado para campos onde MAIOR valor = MAIS permissivo (maxTurns, maxIterations,
 * dailyLimitTokens). Não usar para ragRelevanceThreshold (ver resolveEffectiveGuardrails).
 */
export function clampMaxPermissive(globalLimit: number, soulLimit: number | undefined): number {
  return soulLimit === undefined ? globalLimit : Math.min(globalLimit, soulLimit);
}

/**
 * Resolve os guardrails efetivos de uma soul, aplicando o invariante
 * "a soul nunca amplia limite global" (docs/PLANO-CRIACAO-SOULS.md §C1):
 * effectiveLimit = min(globalLimit, soulLimit) para maxTurns/maxIterations/dailyLimitTokens.
 *
 * ragRelevanceThreshold é o caso invertido: um valor MENOR é MAIS permissivo (deixa
 * passar mais resultados no filtro RAG), então clampar "para baixo" com min() deixaria
 * a soul MAIS permissiva que o piso global — o oposto do invariante. Por isso usamos
 * max() nesse campo especificamente; não trocar de volta para min() por "consistência".
 *
 * allowedOrigins não é clampado (array, sem equivalente global hoje) — passa direto
 * da soul; validação de wildcard é responsabilidade da criação da soul (SoulSpec).
 */
export function resolveEffectiveGuardrails(
  global: GlobalGuardrails,
  agentConfig?: AgentConfig,
): Required<Pick<AgentGuardrails, "maxTurns" | "maxIterations" | "ragRelevanceThreshold">> & AgentGuardrails {
  const soul = resolveGuardrails(agentConfig);
  return {
    ...soul,
    maxTurns: clampMaxPermissive(global.maxTurns, soul.maxTurns),
    maxIterations: clampMaxPermissive(global.maxIterations, soul.maxIterations),
    ragRelevanceThreshold: Math.max(global.ragRelevanceThreshold, soul.ragRelevanceThreshold),
    dailyLimitTokens:
      global.dailyLimitTokens === undefined
        ? soul.dailyLimitTokens
        : clampMaxPermissive(global.dailyLimitTokens, soul.dailyLimitTokens),
  };
}
