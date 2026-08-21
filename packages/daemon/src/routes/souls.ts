import type { IncomingMessage, ServerResponse } from "node:http";
import { getPool, sumCostBySoul } from "@assistente-os/core";
import { sendJson, type RequestContext } from "./shared.js";

/**
 * Rotas de identidade/consulta de souls e métricas de custo/sessão:
 *   GET /health, GET /souls, GET /souls/:id, GET /souls/:id/context,
 *   GET /costs, GET /sessions/stats, GET /router/status
 */
export async function handleSouls(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  if (req.method === "GET" && path === "/health") {
    const { listSouls } = await import("@assistente-os/core");
    sendJson(res, 200, { ok: true, service: "assistente-os", souls: listSouls(home).map((s) => s.id) });
    return true;
  }

  if (req.method === "GET" && path === "/souls") {
    const { listSouls } = await import("@assistente-os/core");
    sendJson(res, 200, listSouls(home).map((s) => ({ id: s.id, config: s.config })));
    return true;
  }

  if (req.method === "GET" && path === "/costs") {
    const { loadConfig, listSouls, recentCalls } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const bySoul: Record<string, number> = {};
    for (const soul of listSouls(home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
    sendJson(res, 200, { bySoul, recent: await recentCalls(pool, "main", 10) });
    return true;
  }

  if (req.method === "GET" && path === "/sessions/stats") {
    const { loadConfig, countSessions } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { total: await countSessions(pool) });
    return true;
  }

  const soulMatch = path.match(/^\/souls\/([^/]+)$/);
  if (soulMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const soul = getSoul(home, decodeURIComponent(soulMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    sendJson(res, 200, soul);
    return true;
  }

  const contextMatch = path.match(/^\/souls\/([^/]+)\/context$/);
  if (contextMatch && req.method === "GET") {
    const { getSoul } = await import("@assistente-os/core");
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const soul = getSoul(home, decodeURIComponent(contextMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const files = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];
    const parts: string[] = [];
    for (const f of files) {
      const p = join(soul.dir, f);
      if (existsSync(p)) parts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
    }
    sendJson(res, 200, { soul: soul.id, context: parts.join("\n\n") });
    return true;
  }

  if (req.method === "GET" && path === "/router/status") {
    const { loadConfig } = await import("@assistente-os/core");
    const config = loadConfig({ home });
    sendJson(res, 200, { tiers: config.routerTiers, ollamaUrl: config.ollamaUrl });
    return true;
  }

  return false;
}
