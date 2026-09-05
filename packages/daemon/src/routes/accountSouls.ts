import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  listSouls,
  getSoul,
  writeSoulConfig,
  validateSoulSpec,
  resolveSoulSpecDefaults,
  createSoulFromSpec,
  computePlanHash,
  isValidSoulId,
  resolveEffectiveGuardrails,
  loadConfig,
  getPool,
  getFriendlyAllowlist,
  CAPABILITY_CATALOG,
  SOUL_SPEC_SCHEMA_VERSION,
  CAPABILITY_CATALOG_VERSION,
  DEFAULT_GLOBAL_GUARDRAILS,
  DEFAULT_SOUL_SPEC_LIMITS,
  type SoulSpec,
} from "@assistente-os/core";
import { sendJson, parseBody, requiredTrimmedString, optionalTrimmedString, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";
import { directoryTotalBytes, friendlyUploadKbLimit } from "../upload.js";

const CreateAccountSoulSchema = z.object({
  purpose: requiredTrimmedString("purpose é obrigatório — descreva no que esse assistente vai ajudar"),
  id: optionalTrimmedString(),
  capabilities: z.unknown().optional(),
  skills: z.unknown().optional(),
  dry_run: z.boolean().optional(),
  plan_hash: optionalTrimmedString(),
});

const AccountSoulPatchSchema = z.object({
  displayName: z.string().trim().optional(),
  description: z.string().optional(),
  perfilMd: z.string().optional(),
  contextoMd: z.string().optional(),
  guardrails: z
    .object({
      maxTurns: z.number().optional(),
      maxIterations: z.number().optional(),
      ragRelevanceThreshold: z.number().optional(),
    })
    .optional(),
  capabilities: z.array(z.unknown()).optional(),
  skills: z.array(z.unknown()).optional(),
});

/** Quantas souls uma conta self-service pode ter (env ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT, default 2). */
function maxSoulsPerAccount(): number {
  const n = Number(process.env.ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function slugify(text: string): string {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Valida capabilities/skills pedidas pelo cliente contra a allowlist que o
 * admin configurou (docs em friendlyAdmin.ts). Fora da allowlist = rejeita —
 * nunca aceita parcialmente nem ignora silenciosamente (silenciar dava a
 * ilusão de que a capability foi concedida quando não foi).
 */
async function validateRequestedGrants(
  pool: import("pg").Pool,
  requestedCapabilities: unknown,
  requestedSkills: unknown,
): Promise<{ ok: true; capabilities: string[]; skills: string[] } | { ok: false; error: string }> {
  const capabilities = Array.isArray(requestedCapabilities) ? requestedCapabilities.filter((x) => typeof x === "string") : [];
  const skills = Array.isArray(requestedSkills) ? requestedSkills.filter((x) => typeof x === "string") : [];
  if (capabilities.length === 0 && skills.length === 0) return { ok: true, capabilities: [], skills: [] };

  const allowlist = await getFriendlyAllowlist(pool);
  const badCap = capabilities.find((c) => !allowlist.capabilities.includes(c));
  if (badCap) return { ok: false, error: `capability '${badCap}' não está liberada pro modo amigável` };
  const badSkill = skills.find((s) => !allowlist.skills.includes(s));
  if (badSkill) return { ok: false, error: `skill '${badSkill}' não está liberada pro modo amigável` };
  return { ok: true, capabilities, skills };
}

/** Slug único: sufixa -2, -3... se colidir com uma soul existente. */
function uniqueSlug(base: string, existingIds: Set<string>): string {
  const root = base || "assistente";
  if (!existingIds.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/**
 * Wizard de criação de soul do modo amigável (Fase 2) — POST /accounts/me/souls.
 *
 * Payload deliberadamente enxuto comparado ao soul_create_questions completo
 * de docs/PLANO-CRIACAO-SOULS.md: só `purpose` (vira description) e `id`
 * opcional (auto-sugerido a partir do purpose se ausente). Tudo o mais vem de
 * default seguro — autonomy "ask", capabilities [] (zero tools por padrão;
 * escolher capabilities L3 fica para uma v2). Reusa a mesma lógica core que
 * a tool MCP soul_create já usa (dry_run → plan_hash → confirmar), só que
 * autorizada por sessão de conta em vez de AGENT_SOUL_ID.
 */
export async function handleAccountSouls(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;
  const itemMatch = path.match(/^\/accounts\/me\/souls\/([^/]+)$/);

  if (itemMatch && (req.method === "GET" || req.method === "PATCH")) {
    return handleAccountSoulItem(req, res, home, decodeURIComponent(itemMatch[1]!));
  }

  if (path === "/accounts/me/available-capabilities" && req.method === "GET") {
    if (getRequestAccountId(req) == null) {
      sendJson(res, 401, { error: "requer sessão de conta (faça login)" });
      return true;
    }
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const allowlist = await getFriendlyAllowlist(pool);
    const capabilities = CAPABILITY_CATALOG.filter((c) => allowlist.capabilities.includes(c.pattern)).map((c) => ({
      pattern: c.pattern,
      level: c.level,
      description: c.description ?? null,
    }));
    sendJson(res, 200, { capabilities, skills: allowlist.skills.map((name) => ({ name })) });
    return true;
  }

  if (path !== "/accounts/me/souls" || req.method !== "POST") return false;

  const accountId = getRequestAccountId(req);
  if (accountId == null) {
    // Token admin ou nenhuma auth: esta rota só faz sentido em nome de uma
    // conta — não há "dono" pra atribuir sem uma sessão de conta resolvida.
    sendJson(res, 401, { error: "requer sessão de conta (faça login)" });
    return true;
  }

  const parsed = await parseBody(req, CreateAccountSoulSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const body = parsed.data;
  const purpose = body.purpose;

  const existingSouls = listSouls(home);
  const ownedCount = existingSouls.filter((s) => s.config.ownerAccountId === accountId).length;
  if (ownedCount >= maxSoulsPerAccount()) {
    sendJson(res, 400, { error: `limite de ${maxSoulsPerAccount()} assistente(s) por conta atingido`, code: "E_ACCOUNT_LIMIT" });
    return true;
  }

  const pool = getPool(loadConfig({ home }).databaseUrl);
  const grants = await validateRequestedGrants(pool, body.capabilities, body.skills);
  if (!grants.ok) {
    sendJson(res, 400, { error: grants.error, code: "E_VALIDATION" });
    return true;
  }

  const existingIds = new Set(existingSouls.map((s) => s.id));
  const requestedId = body.id ?? "";
  const newId = requestedId && isValidSoulId(requestedId) && !existingIds.has(requestedId)
    ? requestedId
    : uniqueSlug(slugify(requestedId || purpose), existingIds);

  const spec: SoulSpec = {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId,
    description: purpose,
    autonomy: "ask",
    capabilities: grants.capabilities,
    skills: grants.skills,
    ownerAccountId: accountId,
  };
  const validation = validateSoulSpec(spec, { existingIds });
  const resolved = resolveSoulSpecDefaults(spec, DEFAULT_GLOBAL_GUARDRAILS);
  const planHash = computePlanHash({
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    catalogVersion: CAPABILITY_CATALOG_VERSION,
    spec: resolved,
    effectiveProvider: resolved.provider ?? "",
    effectiveModel: resolved.model ?? "",
  });

  const dryRun = body.dry_run !== false;
  if (dryRun) {
    sendJson(res, 200, { dry_run: true, ok: validation.ok, plan_hash: planHash, issues: validation.issues, soul_id: newId });
    return true;
  }
  if (!validation.ok) {
    sendJson(res, 400, { error: "spec inválida", issues: validation.issues });
    return true;
  }
  const givenHash = body.plan_hash ?? "";
  if (givenHash !== planHash) {
    sendJson(res, 409, { error: "plan_hash divergente — rode dry_run de novo e reenvie o hash", plan_hash: planHash, code: "E_STALE_HASH" });
    return true;
  }
  const result = createSoulFromSpec(home, resolved);
  if (!result.created) {
    sendJson(res, result.code === "E_CONFLICT" ? 409 : 400, { error: result.reason, code: result.code });
    return true;
  }
  sendJson(res, 201, { dry_run: false, created: true, soul_id: newId, plan_hash: planHash });
  return true;
}

function readPersonaFile(dir: string, name: string): string {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function soulSettingsView(home: string, id: string): Record<string, unknown> {
  const soul = getSoul(home, id)!;
  const eff = resolveEffectiveGuardrails(DEFAULT_GLOBAL_GUARDRAILS, soul.config.agent);
  const limitKb = friendlyUploadKbLimit();
  // 1 casa decimal, não arredondado pro inteiro mais próximo — um upload de
  // poucas dezenas de bytes (comum em teste/documento curto) virava "0 KB"
  // com Math.round, parecendo que o envio não fez nada.
  const usedKb = Math.round((directoryTotalBytes(join(soul.dir, "sources", "uploads")) / 1024) * 10) / 10;
  return {
    id: soul.id,
    displayName: soul.config.displayName ?? "",
    description: soul.config.description ?? "",
    perfilMd: readPersonaFile(soul.dir, "perfil.md"),
    contextoMd: readPersonaFile(soul.dir, "contexto.md"),
    guardrails: { maxTurns: eff.maxTurns, maxIterations: eff.maxIterations, ragRelevanceThreshold: eff.ragRelevanceThreshold },
    knowledge: { usedKb, limitKb },
    capabilities: soul.config.agent?.permissions?.tools ?? [],
    skills: soul.config.agent?.permissions?.skills ?? [],
  };
}

/**
 * Configurações escopadas do modo amigável (Fase 3) — GET/PATCH
 * /accounts/me/souls/:id. Superfície de edição: description + as duas
 * personas mais usadas (perfil/contexto) + guardrails numéricos, sempre
 * re-clampados contra o teto global (nunca afrouxa) + capabilities/skills,
 * mas só dentro da allowlist que o admin liberou (validateRequestedGrants) —
 * nunca livre. NÃO dá pra mudar autonomy/connectors/provider/model/
 * ownerAccountId por aqui — isso fica fixo desde a criação (v1).
 *
 * writeSoulConfig() não é atômico feito createSoulFull() — aceitável aqui:
 * é update de uma soul já existente e válida, não criação; pior caso de
 * falha no meio é tentar de novo, não uma soul pela metade.
 */
async function handleAccountSoulItem(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  id: string,
): Promise<boolean> {
  const accountId = getRequestAccountId(req);
  if (accountId == null) {
    sendJson(res, 401, { error: "requer sessão de conta (faça login)" });
    return true;
  }
  const soul = getSoul(home, id);
  if (!soul || soul.config.ownerAccountId !== accountId) {
    sendJson(res, 403, { error: "soul não pertence a esta conta" });
    return true;
  }

  if (req.method === "GET") {
    sendJson(res, 200, soulSettingsView(home, id));
    return true;
  }

  // PATCH
  const parsed = await parseBody(req, AccountSoulPatchSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const body = parsed.data;
  const limit = DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes;

  const displayName = body.displayName ?? soul.config.displayName;
  const description = body.description ?? soul.config.description;
  const perfilMd = body.perfilMd;
  const contextoMd = body.contextoMd;
  for (const [field, value] of [["displayName", displayName], ["description", description], ["perfilMd", perfilMd], ["contextoMd", contextoMd]] as const) {
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > limit) {
      sendJson(res, 400, { error: `${field} excede ${limit} bytes`, code: "E_VALIDATION" });
      return true;
    }
  }

  const g = body.guardrails ?? {};
  const currentGuardrails = soul.config.agent?.guardrails;
  const eff = resolveEffectiveGuardrails(DEFAULT_GLOBAL_GUARDRAILS, {
    permissions: soul.config.agent?.permissions ?? { tools: [] },
    guardrails: {
      maxTurns: g.maxTurns ?? currentGuardrails?.maxTurns,
      maxIterations: g.maxIterations ?? currentGuardrails?.maxIterations,
      ragRelevanceThreshold: g.ragRelevanceThreshold ?? currentGuardrails?.ragRelevanceThreshold,
    },
  });

  // capabilities/skills só mudam se vierem no body (array explícito — mesmo
  // [] vazio conta como "trocar pra nada"); ausente = mantém o que já tinha.
  // Sempre revalidado contra a allowlist do admin, nunca aceita livre.
  let tools = soul.config.agent?.permissions?.tools ?? [];
  let skills = soul.config.agent?.permissions?.skills ?? [];
  if (body.capabilities !== undefined || body.skills !== undefined) {
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const grants = await validateRequestedGrants(
      pool,
      body.capabilities !== undefined ? body.capabilities : tools,
      body.skills !== undefined ? body.skills : skills,
    );
    if (!grants.ok) {
      sendJson(res, 400, { error: grants.error, code: "E_VALIDATION" });
      return true;
    }
    tools = grants.capabilities;
    skills = grants.skills;
  }

  writeSoulConfig(soul.dir, {
    ...soul.config,
    displayName,
    description,
    agent: {
      ...soul.config.agent,
      permissions: { ...soul.config.agent?.permissions, tools, skills },
      autonomy: soul.config.agent?.autonomy ?? "ask",
      guardrails: { maxTurns: eff.maxTurns, maxIterations: eff.maxIterations, ragRelevanceThreshold: eff.ragRelevanceThreshold },
    },
  });
  if (perfilMd !== undefined) writeFileSync(join(soul.dir, "perfil.md"), perfilMd, "utf8");
  if (contextoMd !== undefined) writeFileSync(join(soul.dir, "contexto.md"), contextoMd, "utf8");

  sendJson(res, 200, soulSettingsView(home, id));
  return true;
}
