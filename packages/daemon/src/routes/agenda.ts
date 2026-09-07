import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadConfig, getPool, addAgendaItem, getAgendaItems, updateAgendaItem, cancelAgendaItem, isDbHealthy, type AgendaItem } from "@assistente-os/core";
import { processDueAgenda } from "../agenda.js";
import { sendJson, parseBody, requiredTrimmedString, optionalTrimmedString, type RequestContext } from "./shared.js";

const PostAgendaSchema = z.object({
  title: requiredTrimmedString("title é obrigatório"),
  soul: optionalTrimmedString(),
  body: optionalTrimmedString(),
  due_at: optionalTrimmedString(),
});

// Schema dedicado pro PATCH: diferente de optionalTrimmedString() (que
// colapsa ausente/vazio pro mesmo null — certo pro POST, que sempre grava os
// três campos), aqui `undefined` precisa continuar significando "campo não
// enviado, não mexer" pra updateAgendaItem() só tocar o que foi de fato
// mandado. Vazio (string em branco) é tratado como "limpar o campo" no
// handler abaixo, não aqui no schema.
const trimmedIfString = z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string());
const PatchAgendaSchema = z.object({
  title: trimmedIfString.pipe(z.string().min(1, "title não pode ficar vazio")).optional(),
  body: trimmedIfString.optional(),
  due_at: trimmedIfString.optional(),
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

  const idMatch = path.match(/^\/agenda\/(\d+)$/);
  if (idMatch && req.method === "PATCH") {
    const id = Number(idMatch[1]);
    const parsed = await parseBody(req, PatchAgendaSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { title, body: itemBody, due_at: dueAt } = parsed.data;
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      sendJson(res, 503, { error: "Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes" });
      return true;
    }
    // vazio explícito ("") vira null (limpa o campo); ausente (undefined)
    // continua undefined, pra updateAgendaItem() não tocar nesse campo.
    const item = await updateAgendaItem(pool, id, {
      title,
      body: itemBody === undefined ? undefined : itemBody || null,
      dueAt: dueAt === undefined ? undefined : dueAt || null,
    });
    if (!item) {
      sendJson(res, 404, { error: "item não encontrado ou não está mais pendente (só dá pra editar enquanto pending)" });
      return true;
    }
    sendJson(res, 200, item);
    return true;
  }

  const cancelMatch = path.match(/^\/agenda\/(\d+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const id = Number(cancelMatch[1]);
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      sendJson(res, 503, { error: "Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes" });
      return true;
    }
    const item = await cancelAgendaItem(pool, id);
    if (!item) {
      sendJson(res, 404, { error: "item não encontrado ou não está mais pendente (só dá pra cancelar enquanto pending)" });
      return true;
    }
    try {
      hub.broadcast({ type: "agenda.cancelled", item });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 200, item);
    return true;
  }

  return false;
}
