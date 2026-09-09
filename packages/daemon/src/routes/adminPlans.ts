import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadConfig, getPool, listPlans, upsertPlan, getAccountByEmail, setAccountPlan, getPlan } from "@assistente-os/core";
import { sendJson, parseBody, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

const PutPlanSchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  allowedModels: z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), z.array(z.string())),
  dailySpendLimit: z.number().nullable(),
});

const AssignPlanSchema = z.object({
  email: z.string().trim().min(1),
  planId: z.string().trim().min(1),
});

/**
 * Administração de planos de conta (modelo permitido + teto de gasto por
 * conta) — GET/PUT /admin/plans, PATCH /admin/accounts/plan. Mesma forma de
 * friendlyAdmin.ts: admin-only de verdade (nunca sessão de conta), mesmo
 * que o gate central já tenha deixado a sessão passar pra outras rotas.
 */
export async function handleAdminPlans(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  if (path === "/admin/plans" && (req.method === "GET" || req.method === "PUT")) {
    if (getRequestAccountId(req) != null) {
      sendJson(res, 403, { error: "rota exclusiva do token admin" });
      return true;
    }
    const pool = getPool(loadConfig({ home }).databaseUrl);

    if (req.method === "GET") {
      sendJson(res, 200, { plans: await listPlans(pool) });
      return true;
    }

    const parsed = await parseBody(req, PutPlanSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const plan = await upsertPlan(pool, parsed.data);
    sendJson(res, 200, plan);
    return true;
  }

  if (path === "/admin/accounts/plan" && req.method === "PATCH") {
    if (getRequestAccountId(req) != null) {
      sendJson(res, 403, { error: "rota exclusiva do token admin" });
      return true;
    }
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const parsed = await parseBody(req, AssignPlanSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const account = await getAccountByEmail(pool, parsed.data.email);
    if (!account) {
      sendJson(res, 404, { error: "conta não encontrada" });
      return true;
    }
    const plan = await getPlan(pool, parsed.data.planId);
    if (!plan) {
      sendJson(res, 400, { error: `plano '${parsed.data.planId}' não existe`, code: "E_VALIDATION" });
      return true;
    }
    await setAccountPlan(pool, account.id, plan.id);
    sendJson(res, 200, { email: account.email, planId: plan.id });
    return true;
  }

  return false;
}
