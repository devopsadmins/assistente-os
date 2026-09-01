import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadConfig,
  getPool,
  getFriendlyAllowlist,
  setFriendlyAllowlist,
  CAPABILITY_CATALOG,
  scanSkillDirs,
} from "@assistente-os/core";
import { sendJson, readJson, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

/**
 * Administração da allowlist de capabilities/skills liberadas pro
 * self-service (modo amigável) — GET/PUT /admin/friendly-allowlist.
 *
 * Admin-only de verdade: exige token admin, NUNCA sessão de conta — mesmo
 * que uma sessão de conta tenha passado pelo gate central (que aceita as
 * duas credenciais pra rotas fora de /souls/:id/*), esta rota se fecha
 * explicitamente pra ela, porque é aqui que se decide o que o self-service
 * PODE fazer — não faz sentido o self-service configurar os próprios
 * privilégios.
 */
export async function handleFriendlyAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (path !== "/admin/friendly-allowlist" || (req.method !== "GET" && req.method !== "PUT")) return false;
  const { home } = context;

  if (getRequestAccountId(req) != null) {
    sendJson(res, 403, { error: "rota exclusiva do token admin" });
    return true;
  }

  const config = loadConfig({ home });
  const pool = getPool(config.databaseUrl);
  const allowlist = await getFriendlyAllowlist(pool);

  if (req.method === "GET") {
    // scanSkillDirs precisa de um soulId por assinatura, mas só olhamos o
    // resultado global aqui — skill de soul específica não faz sentido
    // oferecer pro self-service (pertence a uma soul do operador).
    const globalSkills = scanSkillDirs(home, "__friendly_admin__").filter((s) => s.scope === "global");
    sendJson(res, 200, {
      capabilities: CAPABILITY_CATALOG.map((c) => ({
        pattern: c.pattern,
        level: c.level,
        description: c.description ?? null,
        allowed: allowlist.capabilities.includes(c.pattern),
      })),
      skills: globalSkills.map((s) => ({ name: s.name, allowed: allowlist.skills.includes(s.name) })),
    });
    return true;
  }

  // PUT
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
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((x: unknown) => typeof x === "string") : [];
  const skills = Array.isArray(body.skills) ? body.skills.filter((x: unknown) => typeof x === "string") : [];
  await setFriendlyAllowlist(pool, { capabilities, skills });
  const updated = await getFriendlyAllowlist(pool);
  sendJson(res, 200, updated);
  return true;
}
