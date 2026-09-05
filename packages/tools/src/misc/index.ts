import { getPool, sumCostBySoul, recentCalls, listSouls, getSoul, addAgendaItem, getAgendaItems } from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const MISC_TOOLS: Tool[] = [
  {
    name: "costs_summary",
    description: "Resumo de custos por soul e últimas chamadas do kernel.db.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "router_status",
    description: "Degraus do roteador e config do Ollama.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agenda_add",
    description: "Agenda uma tarefa para o daemon despachar (imediatamente se due_at ausente, ou quando devida).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul destino (opcional; usa a padrão do prompt se ausente)" },
        title: { type: "string", description: "título da tarefa" },
        body: { type: "string", description: "descrição/instrução da tarefa (opcional)" },
        due_at: { type: "string", description: "ISO 8601; omitido = despacho assim que o daemon rodar o loop" },
      },
      required: ["title"],
    },
  },
  {
    name: "agenda_list",
    description: "Lista itens da agenda por status (escopado à soul do agente; itens globais incluídos).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "filtro de status", enum: ["pending", "done", "all"], default: "pending" },
        soul: { type: "string", description: "id da soul (default: AGENT_SOUL_ID do processo)" },
      },
    },
  },
];

export const MISC_HANDLERS: Record<string, ToolHandler> = {
  costs_summary: async (ctx) => {
    const pool = getPool(ctx.config.databaseUrl);
    const bySoul: Record<string, number> = {};
    for (const soul of listSouls(ctx.config.home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
    return { bySoul, recent: await recentCalls(pool, "main", 10) };
  },

  router_status: async (ctx) => {
    return { tiers: ctx.config.routerTiers, ollamaUrl: ctx.config.ollamaUrl, ollamaChatModel: ctx.config.ollamaChatModel, ollamaEmbedModel: ctx.config.ollamaEmbedModel };
  },

  agenda_add: async (ctx, args) => {
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : null;
    if (!title) throw new Error("parâmetro title é obrigatório");
    const soulId = typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : null;
    if (soulId && !getSoul(ctx.config.home, soulId)) throw new Error(`soul não encontrada: ${soulId}`);
    const body = typeof args.body === "string" && args.body.trim() ? args.body.trim() : null;
    const dueAt = typeof args.due_at === "string" && args.due_at.trim() ? args.due_at.trim() : null;
    const pool = getPool(ctx.config.databaseUrl);
    const item = await addAgendaItem(pool, soulId, title, body, dueAt);
    return { ok: true, item };
  },

  agenda_list: async (ctx, args) => {
    const status = args.status === "done" || args.status === "all" ? args.status : "pending";
    const pool = getPool(ctx.config.databaseUrl);
    // Escopo: `soul` do parâmetro, senão AGENT_SOUL_ID do processo. Sem
    // nenhum dos dois, cai no modo administrativo (todas as souls).
    const scopeSoul =
      (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined) ??
      (process.env.AGENT_SOUL_ID || undefined);
    return { items: await getAgendaItems(pool, status, scopeSoul) };
  },
};
