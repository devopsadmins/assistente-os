import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, getPool, addMonitor, listMonitors, deleteMonitor, getMonitor } from "@assistente-os/core";
import { checkMonitors } from "../monitors.js";
import { sendJson, readJson, type RequestContext } from "./shared.js";

/** Observabilidade: sites monitorados (up/down configurável na UI). /monitors, /monitors/check, /monitors/:id */
export async function handleMonitors(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, hub } = context;

  if (req.method === "GET" && path === "/monitors") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, await listMonitors(pool));
    return true;
  }

  if (req.method === "POST" && path === "/monitors") {
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
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
    const monitorUrl = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
    if (!name || !monitorUrl) {
      sendJson(res, 400, { error: "name e url são obrigatórios" });
      return true;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(monitorUrl);
    } catch {
      sendJson(res, 400, { error: "url inválida" });
      return true;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      sendJson(res, 400, { error: "url deve usar http(s)" });
      return true;
    }
    const expectedCode = body && typeof body.expectedCode === "number" ? Math.floor(body.expectedCode) : 200;
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const monitor = await addMonitor(pool, { name, url: monitorUrl, expectedCode });
    try {
      hub.broadcast({ type: "monitor.added", monitor });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 201, monitor);
    return true;
  }

  if (req.method === "POST" && path === "/monitors/check") {
    const monitors = await checkMonitors(home);
    try {
      hub.broadcast({ type: "monitor.updated", monitors });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 200, { ok: true, checked: monitors.length, monitors });
    return true;
  }

  const monitorDeleteMatch = path.match(/^\/monitors\/([^/]+)$/);
  if (monitorDeleteMatch && req.method === "DELETE") {
    const id = Number(monitorDeleteMatch[1]);
    if (!Number.isInteger(id) || id < 1) {
      sendJson(res, 400, { error: "id inválido" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const existing = await getMonitor(pool, id);
    if (!existing) {
      sendJson(res, 404, { error: "monitor não encontrado" });
      return true;
    }
    await deleteMonitor(pool, id);
    try {
      hub.broadcast({ type: "monitor.deleted", id });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 200, { ok: true, deleted: id });
    return true;
  }

  return false;
}
