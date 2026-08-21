import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, getPool, addAgendaItem, getAgendaItems, type AgendaItem } from "@assistente-os/core";
import { processDueAgenda } from "../agenda.js";
import { sendJson, readJson, type RequestContext } from "./shared.js";

/** Agendador (F2): fila de tarefas com due_at, despachada via opencode run. GET/POST /agenda */
export async function handleAgenda(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub, onAgendaDone } = context;

  if (req.method === "GET" && path === "/agenda") {
    const filter = url.searchParams.get("status");
    const doneFilter = filter === "done" || filter === "all" ? filter : "pending";
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, await getAgendaItems(pool, doneFilter));
    return true;
  }

  if (req.method === "POST" && path === "/agenda") {
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
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "";
    if (!title) {
      sendJson(res, 400, { error: "title é obrigatório" });
      return true;
    }
    const soul = typeof body.soul === "string" && body.soul.trim() ? body.soul.trim() : null;
    const itemBody = typeof body.body === "string" && body.body.trim() ? body.body.trim() : null;
    const dueAt = typeof body.due_at === "string" && body.due_at.trim() ? body.due_at.trim() : null;
    if (soul) {
      const { getSoul } = await import("@assistente-os/core");
      if (!getSoul(home, soul)) {
        sendJson(res, 404, { error: `soul não encontrada: ${soul}` });
        return true;
      }
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const item: AgendaItem = await addAgendaItem(pool, soul, title, itemBody, dueAt);
    // Despacho imediato em background se já vencido; o loop periódico cobre reinícios/atrasos.
    setImmediate(() => {
      void processDueAgenda({ home, run, onDone: onAgendaDone }).catch(() => {});
    });
    try {
      hub.broadcast({ type: "agenda.added", item });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 201, item);
    return true;
  }

  return false;
}
