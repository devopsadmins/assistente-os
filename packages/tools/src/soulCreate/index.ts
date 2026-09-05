import { listSouls, validateSoulSpec, resolveSoulSpecDefaults, createSoulFromSpec, computePlanHash, canonicalJsonStringify, SOUL_SPEC_SCHEMA_VERSION, CAPABILITY_CATALOG_VERSION, DEFAULT_GLOBAL_GUARDRAILS, type SoulSpec } from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

/** Mapeia o payload wire (snake_case) da tool soul_create para o SoulSpec de domínio. */
function soulSpecFromWire(a: Record<string, unknown>): SoulSpec {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const csv = (v: unknown): string[] | undefined => {
    const s = str(v);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  };
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const autonomyRaw = str(a.autonomy);
  const autonomy = autonomyRaw === "suggest" || autonomyRaw === "auto" ? autonomyRaw : "ask";
  return {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId: String(a.soul_id ?? ""),
    description: str(a.purpose),
    perfilMd: str(a.perfil_md),
    contextoMd: str(a.contexto_md),
    pessoasMd: str(a.pessoas_md),
    soulMd: str(a.soul_md),
    autonomy,
    capabilities: csv(a.capabilities) ?? [],
    connectors: csv(a.connectors),
    skills: csv(a.skills),
    provider: str(a.provider),
    model: str(a.model),
    guardrails: {
      maxTurns: num(a.max_turns),
      dailyLimitTokens: num(a.daily_limit),
    },
  };
}

export const SOUL_CREATE_TOOLS: Tool[] = [
  {
    name: "soul_create",
    description:
      "Cria uma nova soul de forma guiada. dry_run=true (default) valida e devolve plan_hash + preview sem escrever; " +
      "dry_run=false exige o plan_hash do dry-run anterior e materializa a soul atomicamente. Efeito estrutural (L3).",
    inputSchema: {
      type: "object",
      properties: {
        soul_id: { type: "string", description: "id da nova soul (slug: a-z, 0-9, hífen)" },
        purpose: { type: "string", description: "descrição curta do propósito da soul" },
        autonomy: { type: "string", description: "suggest | ask | auto (default: ask)" },
        provider: { type: "string", description: "provider do opencode (ex.: zen-sousa)" },
        model: { type: "string", description: "modelo de chat" },
        capabilities: { type: "string", description: "CSV de capabilities do catálogo L1/L2/L3 (ex.: 'memory:*,graph_list')" },
        connectors: { type: "string", description: "CSV de conectores" },
        skills: { type: "string", description: "CSV de skills" },
        daily_limit: { type: "number", description: "teto de gasto diário (unidades do provider)" },
        max_turns: { type: "number", description: "limite de turnos por sessão" },
        perfil_md: { type: "string", description: "conteúdo de perfil.md" },
        contexto_md: { type: "string", description: "conteúdo de contexto.md" },
        pessoas_md: { type: "string", description: "conteúdo de pessoas.md" },
        soul_md: { type: "string", description: "conteúdo de soul.md" },
        dry_run: { type: "boolean", description: "default true — só valida e devolve plan_hash" },
        plan_hash: { type: "string", description: "obrigatório quando dry_run=false: o hash devolvido pelo dry-run" },
      },
      required: ["soul_id", "purpose"],
    },
  },
];

export const SOUL_CREATE_HANDLERS: Record<string, ToolHandler> = {
  soul_create: async (ctx, args) => {
    ctx.authorizeAgentSoul("soul_create"); // efeito estrutural: L3 pela política da soul chamadora
    const spec = soulSpecFromWire(args);
    const existingIds = new Set(listSouls(ctx.config.home).map((s) => s.id));
    const validation = validateSoulSpec(spec, { existingIds });
    const resolved = resolveSoulSpecDefaults(spec, DEFAULT_GLOBAL_GUARDRAILS);
    const planHash = computePlanHash({
      schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
      catalogVersion: CAPABILITY_CATALOG_VERSION,
      spec: resolved,
      effectiveProvider: resolved.provider ?? "",
      effectiveModel: resolved.model ?? "",
    });
    const dryRun = args.dry_run !== false;
    if (dryRun) {
      return {
        dry_run: true,
        ok: validation.ok,
        plan_hash: planHash,
        issues: validation.issues,
        resolved_spec: resolved,
        would_create: [
          `souls/${spec.newId}/config.json`,
          `souls/${spec.newId}/{perfil,contexto,licoes,pessoas,soul}.md`,
          `souls/${spec.newId}/{sessoes,sources,decisoes}/`,
        ],
      };
    }
    if (!validation.ok) {
      throw new Error(`soul_create: spec inválida — ${validation.issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
    }
    const givenHash = typeof args.plan_hash === "string" ? args.plan_hash.trim() : "";
    if (givenHash !== planHash) {
      throw new Error(
        `soul_create: plan_hash divergente (esperado ${planHash}). Rode dry_run novamente e reenvie o hash — a spec mudou entre planejar e aplicar.`,
      );
    }
    const result = createSoulFromSpec(ctx.config.home, resolved);
    if (!result.created) {
      throw new Error(`soul_create: ${result.code} — ${result.reason}`);
    }
    return { dry_run: false, created: true, soul_id: spec.newId, plan_hash: planHash };
  },
};
