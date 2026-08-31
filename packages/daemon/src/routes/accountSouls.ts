import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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
  SOUL_SPEC_SCHEMA_VERSION,
  CAPABILITY_CATALOG_VERSION,
  DEFAULT_GLOBAL_GUARDRAILS,
  DEFAULT_SOUL_SPEC_LIMITS,
  type SoulSpec,
} from "@assistente-os/core";
import { sendJson, readJson, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

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

  if (path !== "/accounts/me/souls" || req.method !== "POST") return false;

  const accountId = getRequestAccountId(req);
  if (accountId == null) {
    // Token admin ou nenhuma auth: esta rota só faz sentido em nome de uma
    // conta — não há "dono" pra atribuir sem uma sessão de conta resolvida.
    sendJson(res, 401, { error: "requer sessão de conta (faça login)" });
    return true;
  }

  const parsed = await readJson(req);
  if (parsed.error === "too_large") {
    sendJson(res, 413, { error: "body excede 1 MB" });
    return true;
  }
  if (parsed.error === "invalid") {
    sendJson(res, 400, { error: "JSON inválido" });
    return true;
  }
  const body = parsed.body;
  const purpose = body && typeof body.purpose === "string" ? body.purpose.trim() : "";
  if (!purpose) {
    sendJson(res, 400, { error: "purpose é obrigatório — descreva no que esse assistente vai ajudar" });
    return true;
  }

  const existingSouls = listSouls(home);
  const ownedCount = existingSouls.filter((s) => s.config.ownerAccountId === accountId).length;
  if (ownedCount >= maxSoulsPerAccount()) {
    sendJson(res, 400, { error: `limite de ${maxSoulsPerAccount()} assistente(s) por conta atingido`, code: "E_ACCOUNT_LIMIT" });
    return true;
  }

  const existingIds = new Set(existingSouls.map((s) => s.id));
  const requestedId = body && typeof body.id === "string" ? body.id.trim() : "";
  const newId = requestedId && isValidSoulId(requestedId) && !existingIds.has(requestedId)
    ? requestedId
    : uniqueSlug(slugify(requestedId || purpose), existingIds);

  const spec: SoulSpec = {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId,
    description: purpose,
    autonomy: "ask",
    capabilities: [],
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

  const dryRun = body?.dry_run !== false;
  if (dryRun) {
    sendJson(res, 200, { dry_run: true, ok: validation.ok, plan_hash: planHash, issues: validation.issues, soul_id: newId });
    return true;
  }
  if (!validation.ok) {
    sendJson(res, 400, { error: "spec inválida", issues: validation.issues });
    return true;
  }
  const givenHash = body && typeof body.plan_hash === "string" ? body.plan_hash.trim() : "";
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
  return {
    id: soul.id,
    description: soul.config.description ?? "",
    perfilMd: readPersonaFile(soul.dir, "perfil.md"),
    contextoMd: readPersonaFile(soul.dir, "contexto.md"),
    guardrails: { maxTurns: eff.maxTurns, maxIterations: eff.maxIterations, ragRelevanceThreshold: eff.ragRelevanceThreshold },
  };
}

/**
 * Configurações escopadas do modo amigável (Fase 3) — GET/PATCH
 * /accounts/me/souls/:id. Superfície de edição deliberadamente pequena:
 * description + as duas personas mais usadas (perfil/contexto) + guardrails
 * numéricos, sempre re-clampados contra o teto global (nunca afrouxa). NÃO dá
 * pra mudar autonomy/capabilities/connectors/provider/model/ownerAccountId
 * por aqui — isso ficaria fixo desde a criação (v1), escalar privilégio via
 * "configurações" seria a mesma classe de bug que o resto do sistema evita.
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
  const parsed = await readJson(req);
  if (parsed.error === "too_large") {
    sendJson(res, 413, { error: "body excede 1 MB" });
    return true;
  }
  if (parsed.error === "invalid") {
    sendJson(res, 400, { error: "JSON inválido" });
    return true;
  }
  const body = parsed.body ?? {};
  const limit = DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes;

  const description = typeof body.description === "string" ? body.description : soul.config.description;
  const perfilMd = typeof body.perfilMd === "string" ? body.perfilMd : undefined;
  const contextoMd = typeof body.contextoMd === "string" ? body.contextoMd : undefined;
  for (const [field, value] of [["description", description], ["perfilMd", perfilMd], ["contextoMd", contextoMd]] as const) {
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > limit) {
      sendJson(res, 400, { error: `${field} excede ${limit} bytes`, code: "E_VALIDATION" });
      return true;
    }
  }

  const g = (body.guardrails ?? {}) as Record<string, unknown>;
  const currentGuardrails = soul.config.agent?.guardrails;
  const eff = resolveEffectiveGuardrails(DEFAULT_GLOBAL_GUARDRAILS, {
    permissions: soul.config.agent?.permissions ?? { tools: [] },
    guardrails: {
      maxTurns: typeof g.maxTurns === "number" ? g.maxTurns : currentGuardrails?.maxTurns,
      maxIterations: typeof g.maxIterations === "number" ? g.maxIterations : currentGuardrails?.maxIterations,
      ragRelevanceThreshold: typeof g.ragRelevanceThreshold === "number" ? g.ragRelevanceThreshold : currentGuardrails?.ragRelevanceThreshold,
    },
  });

  writeSoulConfig(soul.dir, {
    ...soul.config,
    description,
    agent: {
      ...soul.config.agent,
      permissions: soul.config.agent?.permissions ?? { tools: [] },
      autonomy: soul.config.agent?.autonomy ?? "ask",
      guardrails: { maxTurns: eff.maxTurns, maxIterations: eff.maxIterations, ragRelevanceThreshold: eff.ragRelevanceThreshold },
    },
  });
  if (perfilMd !== undefined) writeFileSync(join(soul.dir, "perfil.md"), perfilMd, "utf8");
  if (contextoMd !== undefined) writeFileSync(join(soul.dir, "contexto.md"), contextoMd, "utf8");

  sendJson(res, 200, soulSettingsView(home, id));
  return true;
}
