import {
  getPool,
  sumCostBySoul,
  recentCalls,
  listSouls,
  getSoul,
  addAgendaItem,
  getAgendaItems,
  getAgendaItemById,
  updateAgendaItem,
  cancelAgendaItem,
  isDbHealthy,
  type AgendaItem,
  type Pool,
} from "@assistente-os/core";
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
  {
    name: "agenda_update",
    description: "Edita título/corpo/prazo de um item da agenda ainda pending (falha se já saiu de pending).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "id do item da agenda" },
        title: { type: "string" },
        body: { type: "string", description: "string vazia limpa o campo" },
        due_at: { type: "string", description: "ISO 8601; string vazia limpa o prazo" },
        soul: { type: "string", description: "escopo do chamador (default: AGENT_SOUL_ID do processo)" },
      },
      required: ["id"],
    },
  },
  {
    name: "agenda_cancel",
    description: "Cancela um item da agenda ainda pending (soft: status='cancelled', done=true — nunca apaga a linha).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "id do item da agenda" },
        soul: { type: "string", description: "escopo do chamador (default: AGENT_SOUL_ID do processo)" },
      },
      required: ["id"],
    },
  },
  {
    name: "agenda_force",
    description: "Força um item pending a ficar imediatamente devido (zera due_at) — o próximo ciclo do daemon (até 30s) já despacha, sem esperar o prazo original.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "id do item da agenda" },
        soul: { type: "string", description: "escopo do chamador (default: AGENT_SOUL_ID do processo)" },
      },
      required: ["id"],
    },
  },
];

/**
 * Carrega o item e confere que ele pertence ao escopo do chamador (mesma
 * soul, ou item global) antes de deixar cancelar/editar/forçar — evita que
 * uma soul mexa na agenda de outra. `scopeSoul` ausente (modo administrativo,
 * sem AGENT_SOUL_ID nem `soul` explícito) libera qualquer item.
 */
async function resolveScopedAgendaItem(pool: Pool, id: number, scopeSoul: string | undefined): Promise<AgendaItem> {
  const item = await getAgendaItemById(pool, id);
  if (!item) throw new Error(`item de agenda não encontrado: ${id}`);
  if (scopeSoul && item.soul !== null && item.soul !== scopeSoul) {
    throw new Error(`item de agenda ${id} não pertence à soul ${scopeSoul}`);
  }
  return item;
}

function callerScopeSoul(args: Record<string, unknown>): string | undefined {
  return (
    (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined) ??
    (process.env.AGENT_SOUL_ID || undefined)
  );
}

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
    // SPEC-HR1 (fatia 2, 2026-09-05): agenda é 100% Postgres, sem fallback em
    // Markdown/disco (diferente de decisões/lições, que já são fs-only) — a
    // sonda aqui evita vazar a exceção crua do driver `pg` (timeout de
    // conexão de 5s, mensagem técnica) e dá uma mensagem clara e rápida (1,5s).
    if (!(await isDbHealthy(pool))) {
      throw new Error("Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes");
    }
    const item = await addAgendaItem(pool, soulId, title, body, dueAt);
    return { ok: true, item };
  },

  agenda_list: async (ctx, args) => {
    const status = args.status === "done" || args.status === "all" ? args.status : "pending";
    const pool = getPool(ctx.config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      throw new Error("Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes");
    }
    // Escopo: `soul` do parâmetro, senão AGENT_SOUL_ID do processo. Sem
    // nenhum dos dois, cai no modo administrativo (todas as souls).
    const scopeSoul =
      (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined) ??
      (process.env.AGENT_SOUL_ID || undefined);
    return { items: await getAgendaItems(pool, status, scopeSoul) };
  },

  agenda_update: async (ctx, args) => {
    const id = Number(args.id);
    if (!Number.isInteger(id)) throw new Error("parâmetro id é obrigatório (número)");
    const pool = getPool(ctx.config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      throw new Error("Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes");
    }
    await resolveScopedAgendaItem(pool, id, callerScopeSoul(args));
    const updates: { title?: string; body?: string | null; dueAt?: string | null } = {};
    if (typeof args.title === "string" && args.title.trim()) updates.title = args.title.trim();
    if (typeof args.body === "string") updates.body = args.body.trim() || null;
    if (typeof args.due_at === "string") updates.dueAt = args.due_at.trim() || null;
    const item = await updateAgendaItem(pool, id, updates);
    if (!item) throw new Error(`item ${id} não está mais pending — não dá pra editar`);
    return { ok: true, item };
  },

  agenda_cancel: async (ctx, args) => {
    const id = Number(args.id);
    if (!Number.isInteger(id)) throw new Error("parâmetro id é obrigatório (número)");
    const pool = getPool(ctx.config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      throw new Error("Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes");
    }
    await resolveScopedAgendaItem(pool, id, callerScopeSoul(args));
    const item = await cancelAgendaItem(pool, id);
    if (!item) throw new Error(`item ${id} não está mais pending — não dá pra cancelar`);
    return { ok: true, item };
  },

  agenda_force: async (ctx, args) => {
    const id = Number(args.id);
    if (!Number.isInteger(id)) throw new Error("parâmetro id é obrigatório (número)");
    const pool = getPool(ctx.config.databaseUrl);
    if (!(await isDbHealthy(pool))) {
      throw new Error("Postgres indisponível no momento — a agenda depende do banco (sem fallback em disco); tente novamente em instantes");
    }
    await resolveScopedAgendaItem(pool, id, callerScopeSoul(args));
    const item = await updateAgendaItem(pool, id, { dueAt: null });
    if (!item) throw new Error(`item ${id} não está mais pending — não dá pra forçar`);
    return { ok: true, item, note: "due_at zerado — o próximo ciclo do daemon (até 30s) despacha" };
  },
};
