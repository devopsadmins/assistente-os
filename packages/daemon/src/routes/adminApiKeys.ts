import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadConfig, getPool, listApiKeys, createApiKey, revokeApiKey, getAccountById } from "@assistente-os/core";
import { sendJson, parseBody, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

const CreateKeySchema = z.object({
  label: z.string().trim().min(1),
  scopes: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []),
    z.array(z.string()).min(1, "informe ao menos um escopo (use [\"*\"] para acesso total)"),
  ),
  accountId: z.number().int().positive().nullable().optional(),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

/**
 * Administração de chaves de API com escopo — GET/POST/DELETE /admin/api-keys.
 * Exclusiva do token admin (mesma forma de adminPlans.ts / friendlyAdmin.ts):
 * o gate central pode ter deixado uma sessão de conta passar para outras
 * rotas, então re-checa `getRequestAccountId(req) == null` aqui.
 */
export async function handleAdminApiKeys(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (path !== "/admin/api-keys") return false;
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") return false;

  if (getRequestAccountId(req) != null) {
    sendJson(res, 403, { error: "rota exclusiva do token admin" });
    return true;
  }
  const pool = getPool(loadConfig({ home: context.home }).databaseUrl);

  if (req.method === "GET") {
    // keyHash não é segredo (é sha256 da chave); a chave em claro nunca é
    // relistável — quem perdeu revoga e cria outra.
    sendJson(res, 200, { keys: await listApiKeys(pool) });
    return true;
  }

  if (req.method === "POST") {
    const parsed = await parseBody(req, CreateKeySchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    if (parsed.data.accountId != null && !(await getAccountById(pool, parsed.data.accountId))) {
      sendJson(res, 400, { error: `conta ${parsed.data.accountId} não existe`, code: "E_VALIDATION" });
      return true;
    }
    const { key, record } = await createApiKey(pool, {
      label: parsed.data.label,
      scopes: parsed.data.scopes,
      accountId: parsed.data.accountId ?? null,
      expiresInDays: parsed.data.expiresInDays,
    });
    // `key` (texto em claro) só aparece nesta resposta.
    sendJson(res, 201, { key, record });
    return true;
  }

  // DELETE — revoga por keyHash (?keyHash= na query, ou corpo { keyHash }).
  let keyHash = url.searchParams.get("keyHash")?.trim() ?? "";
  if (!keyHash) {
    const parsed = await parseBody(req, z.object({ keyHash: z.string().trim().min(1) }));
    if (parsed.ok) keyHash = parsed.data.keyHash;
  }
  if (!keyHash) {
    sendJson(res, 400, { error: "keyHash é obrigatório (query ?keyHash= ou corpo { keyHash })" });
    return true;
  }
  const revoked = await revokeApiKey(pool, keyHash);
  sendJson(res, revoked ? 200 : 404, revoked ? { ok: true, keyHash } : { error: "chave não encontrada ou já revogada" });
  return true;
}
