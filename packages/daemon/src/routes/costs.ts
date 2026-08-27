/**
 * Rotas REST para tracking de custos/uso (Feature 3 Orca).
 *
 * Endpoints:
 *   GET /api/costs/usage?soul=&from=&to=  -> resumo agregado por soul/mode/model
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, type RouteHandler } from "./shared.js";
import { getPool } from "@assistente-os/core";
import { getUsageSummary, type UsageSummaryFilters } from "@assistente-os/core";

async function handleCostsUsage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/costs/usage") return false;

  const soul = url.searchParams.get("soul") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const config = await import("@assistente-os/core").then((m) => m.loadConfig());
  const pool = getPool(config.databaseUrl);

  try {
    const filters: UsageSummaryFilters = {};
    if (soul) filters.soul = soul;
    if (from) filters.from = from;
    if (to) filters.to = to;

    const summary = await getUsageSummary(pool, filters);
    sendJson(res, 200, { summary });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

export const handleCosts: RouteHandler = async (req, res, url, path, context) => {
  return handleCostsUsage(req, res, url);
};