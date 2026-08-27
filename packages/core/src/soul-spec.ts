/**
 * SoulSpec: payload de domínio para a criação guiada de souls
 * (docs/PLANO-CRIACAO-SOULS.md §5.2), validação centralizada e planHash.
 *
 * Campos em camelCase (tipo de domínio idiomático) — o payload de wire da
 * tool MCP `soul_create` usa snake_case (§5.2 do doc); o mapeamento entre os
 * dois é responsabilidade da tool (fora de escopo aqui).
 *
 * `validateSoulSpec` nunca lança — acumula issues, porque o `dry_run` precisa
 * reportar todos os problemas de uma vez, não parar no primeiro erro.
 */

import { createHash } from "node:crypto";
import { isValidSoulId, createSoulFull, type SoulConfig, type SoulFileName, type CreateSoulFullResult } from "./souls.js";
import { isKnownCapability } from "./policy.js";
import {
  resolveEffectiveGuardrails,
  DEFAULT_GLOBAL_GUARDRAILS,
  DEFAULT_MEMORY_POLICY,
  type AgentConfig,
  type Autonomy,
  type DataClassification,
  type GlobalGuardrails,
  type MemoryPolicy,
} from "./types/agent.js";

export const SOUL_SPEC_SCHEMA_VERSION = 1;

export interface SoulSpecGuardrails {
  maxTurns?: number;
  maxIterations?: number;
  ragRelevanceThreshold?: number;
  allowedOrigins?: string[];
  dailyLimitTokens?: number;
}

export interface SoulSpec {
  schemaVersion: number;
  newId: string;
  description?: string;
  perfilMd?: string;
  contextoMd?: string;
  pessoasMd?: string;
  soulMd?: string;
  mission?: string;
  nonGoals?: string;
  dataClassification?: DataClassification;
  eventTriggers?: string;
  outputContract?: string;
  autonomy: Autonomy;
  approvalPolicy?: string[];
  memoryPolicy?: MemoryPolicy;
  /** Já resolvidas a nomes concretos — a resolução real de wildcard→nomes é responsabilidade do chamador. */
  capabilities: string[];
  connectors?: string[];
  skills?: string[];
  guardrails?: SoulSpecGuardrails;
  provider?: string;
  model?: string;
  indexMemory?: boolean;
  setActive?: boolean;
}

// ── Limites (docs/PLANO-CRIACAO-SOULS.md §6) ─────────────────────────────

export interface SoulSpecLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSkills: number;
  maxConnectors: number;
  maxConfigJsonBytes: number;
}

export const DEFAULT_SOUL_SPEC_LIMITS: SoulSpecLimits = {
  maxFileBytes: 32 * 1024,
  maxTotalBytes: 128 * 1024,
  maxSkills: 20,
  maxConnectors: 10,
  maxConfigJsonBytes: 64 * 1024,
};

// ── Validação centralizada ────────────────────────────────────────────

export interface SoulSpecValidationIssue {
  field: string;
  code: "E_VALIDATION";
  message: string;
}

export interface SoulSpecValidationResult {
  ok: boolean;
  issues: SoulSpecValidationIssue[];
}

const TEXT_FIELDS: Array<keyof SoulSpec> = [
  "description",
  "perfilMd",
  "contextoMd",
  "pessoasMd",
  "soulMd",
  "mission",
  "nonGoals",
  "eventTriggers",
  "outputContract",
];

function issue(field: string, message: string): SoulSpecValidationIssue {
  return { field, code: "E_VALIDATION", message };
}

export function validateSoulSpec(
  spec: SoulSpec,
  opts: { existingIds: Set<string>; limits?: Partial<SoulSpecLimits> },
): SoulSpecValidationResult {
  const limits = { ...DEFAULT_SOUL_SPEC_LIMITS, ...opts.limits };
  const issues: SoulSpecValidationIssue[] = [];

  if (!isValidSoulId(spec.newId)) {
    issues.push(issue("newId", `id inválido: ${JSON.stringify(spec.newId)}`));
  } else if (opts.existingIds.has(spec.newId)) {
    issues.push(issue("newId", `soul '${spec.newId}' já existe`));
  }

  let totalBytes = 0;
  for (const field of TEXT_FIELDS) {
    const value = spec[field];
    if (typeof value !== "string" || value.length === 0) continue;
    const bytes = Buffer.byteLength(value, "utf8");
    totalBytes += bytes;
    if (bytes > limits.maxFileBytes) {
      issues.push(issue(field, `conteúdo excede ${limits.maxFileBytes} bytes (${bytes} bytes)`));
    }
  }
  if (totalBytes > limits.maxTotalBytes) {
    issues.push(issue("_total", `conteúdo total excede ${limits.maxTotalBytes} bytes (${totalBytes} bytes)`));
  }

  for (const cap of spec.capabilities ?? []) {
    if (!isKnownCapability(cap)) {
      issues.push(issue("capabilities", `capability desconhecida no catálogo: '${cap}'`));
    }
  }

  const skillsCount = spec.skills?.length ?? 0;
  if (skillsCount > limits.maxSkills) {
    issues.push(issue("skills", `número de skills (${skillsCount}) excede o limite de ${limits.maxSkills}`));
  }

  const connectorsCount = spec.connectors?.length ?? 0;
  if (connectorsCount > limits.maxConnectors) {
    issues.push(
      issue("connectors", `número de conectores (${connectorsCount}) excede o limite de ${limits.maxConnectors}`),
    );
  }

  const predictedConfigBytes = Buffer.byteLength(
    JSON.stringify(buildAgentConfigFromSpec(spec, DEFAULT_GLOBAL_GUARDRAILS)),
    "utf8",
  );
  if (predictedConfigBytes > limits.maxConfigJsonBytes) {
    issues.push(
      issue("_config", `config.json previsto excede ${limits.maxConfigJsonBytes} bytes (${predictedConfigBytes} bytes)`),
    );
  }

  return { ok: issues.length === 0, issues };
}

// ── Composição de AgentConfig a partir do spec ───────────────────────────

export function buildAgentConfigFromSpec(spec: SoulSpec, global: GlobalGuardrails): AgentConfig {
  return {
    provider: spec.provider,
    model: spec.model,
    permissions: {
      tools: spec.capabilities,
      skills: spec.skills ?? [],
      connectors: spec.connectors ?? [],
    },
    guardrails: resolveEffectiveGuardrails(global, {
      permissions: { tools: [] },
      guardrails: {
        maxTurns: spec.guardrails?.maxTurns,
        maxIterations: spec.guardrails?.maxIterations,
        ragRelevanceThreshold: spec.guardrails?.ragRelevanceThreshold,
        allowedOrigins: spec.guardrails?.allowedOrigins,
        dailyLimitTokens: spec.guardrails?.dailyLimitTokens,
      },
    }),
    autonomy: spec.autonomy,
    approvalPolicy: spec.approvalPolicy ?? [],
    memoryPolicy: spec.memoryPolicy ?? DEFAULT_MEMORY_POLICY,
  };
}

/** Aplica defaults + clamp de guardrails contra o global, produzindo a forma "efetiva" usada no hash e no preview. */
export function resolveSoulSpecDefaults(spec: SoulSpec, global: GlobalGuardrails): SoulSpec {
  const effective = resolveEffectiveGuardrails(global, {
    permissions: { tools: [] },
    guardrails: {
      maxTurns: spec.guardrails?.maxTurns,
      maxIterations: spec.guardrails?.maxIterations,
      ragRelevanceThreshold: spec.guardrails?.ragRelevanceThreshold,
      allowedOrigins: spec.guardrails?.allowedOrigins,
      dailyLimitTokens: spec.guardrails?.dailyLimitTokens,
    },
  });
  return {
    ...spec,
    guardrails: {
      maxTurns: effective.maxTurns,
      maxIterations: effective.maxIterations,
      ragRelevanceThreshold: effective.ragRelevanceThreshold,
      allowedOrigins: effective.allowedOrigins,
      dailyLimitTokens: effective.dailyLimitTokens,
    },
    memoryPolicy: spec.memoryPolicy ?? DEFAULT_MEMORY_POLICY,
    approvalPolicy: spec.approvalPolicy ?? [],
    connectors: spec.connectors ?? [],
    skills: spec.skills ?? [],
  };
}

// ── planHash ──────────────────────────────────────────────────────────

/** JSON com chaves ordenadas recursivamente. Arrays mantêm a ordem original (são semânticos). */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export interface PlanHashInput {
  schemaVersion: number;
  catalogVersion: string;
  /** Spec já com defaults/clamps resolvidos — ver resolveSoulSpecDefaults(). */
  spec: SoulSpec;
  effectiveProvider: string;
  effectiveModel: string;
}

export function computePlanHash(input: PlanHashInput): string {
  const canonical = canonicalJsonStringify({
    schemaVersion: input.schemaVersion,
    catalogVersion: input.catalogVersion,
    spec: input.spec,
    provider: input.effectiveProvider,
    model: input.effectiveModel,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ── Commit: SoulSpec → createSoulFull ────────────────────────────────────

/**
 * Materializa um SoulSpec já resolvido (ver resolveSoulSpecDefaults) em disco
 * via createSoulFull() — atômico, sem diretório residual em falha/corrida.
 *
 * O mapeamento wire (snake_case) → SoulSpec fica na tool MCP `soul_create`;
 * aqui a entrada já é o tipo de domínio.
 */
export function createSoulFromSpec(configHome: string, spec: SoulSpec): CreateSoulFullResult {
  const agent = buildAgentConfigFromSpec(spec, DEFAULT_GLOBAL_GUARDRAILS);
  const config: SoulConfig = {
    name: spec.newId,
    description: spec.description,
    provider: spec.provider,
    models: spec.model ? { chat: spec.model } : undefined,
    maxTurns: spec.guardrails?.maxTurns,
    agent,
  };
  const files: Partial<Record<SoulFileName, string>> = {
    "perfil.md": spec.perfilMd ?? "",
    "contexto.md": spec.contextoMd ?? "",
    "pessoas.md": spec.pessoasMd ?? "",
    "soul.md": spec.soulMd ?? "",
    "licoes.md": "",
  };
  return createSoulFull(configHome, spec.newId, config, files);
}
