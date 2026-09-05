import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadConfig, getPool, addAgendaItem, getAgendaItems, isDbHealthy, type AgendaItem } from "@assistente-os/core";
import { processDueAgenda } from "../agenda.js";
import { sendJson, parseBody, requiredTrimmedString, optionalTrimmedString, type RequestContext } from "./shared.js";

const PostAgendaSchema = z.object({
  title: requiredTrimmedString("title é obrigatório"),
  soul: optionalTrimmedString(),
  body: optionalTrimmedString(),
  due_at: optionalTrimmedString(),
});

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
    // `?soul=` restringe à soul (+ itens globais); sem ele, lista tudo (admin).
    const soulParam = url.searchParams.get("soul")?.trim() || undefined;
    const config = loadConfig({ home });
    if (soulParam) {
      const { getSoul } = await import("@assistente-os/core");
      if (!getSoul(home, soulParam)) {
        sendJson(res, 404, { error: `soul não encontrada: ${soulParam}` });
        return true;
      }
    }
    const pool = getPool(config.databaseUrl);
    // SPEC-HR1 (fatia 3, 2026-09-05): agenda é 100% Postgres, sem fallback em
    // disco — mesma sonda já usada em agenda_add/agenda_list (tool MCP) pra
    // não vazar a exceção crua do driver `pg` (timeout de conexão de 5s).
    if (!(await isDbHealthy(pool))) {
      sendJson(res, 503, { error: "Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes" });
      return true;
    }
    sendJson(res, 200, await getAgendaItems(pool, doneFilter, soulParam));
    return true;
  }

  if (req.method === "POST" && path === "/agenda") {
    const parsed = await parseBody(req, PostAgendaSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { title, soul, body: itemBody, due_at: dueAt } = parsed.data;
    if (soul) {
      const { getSoul } = await import("@assistente-os/core");
      if (!getSoul(home, soul)) {
        sendJson(res, 404, { error: `soul não encontrada: ${soul}` });
        return true;
      }
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      sendJson(res, 503, { error: "Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes" });
      return true;
    }
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
