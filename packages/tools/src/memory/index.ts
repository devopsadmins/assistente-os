import { getPool, sanitizeLLMResponse, resolveRelevanceGate } from "@assistente-os/core";
import { indexDirectory, searchWithVerdict, indexStats, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder, type RelevanceRule } from "@assistente-os/memory";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";
import { join } from "node:path";

/** Gate de relevância configurável por env (default: modo "aviso"). */
function relevanceRule(): RelevanceRule {
  const gate = resolveRelevanceGate();
  return { modo: gate.modo, min_score: gate.minScore, min_term_matches: gate.minTerms };
}

export const MEMORY_TOOLS: Tool[] = [
  {
    name: "memory_search",
    description: "Busca RAG na memória da soul (semântica com Ollama; degrada para literal).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        query: { type: "string", description: "consulta" },
        limit: { type: "number", default: 5 },
      },
      required: ["soul", "query"],
    },
  },
  {
    name: "memory_index",
    description: "Indexa (idempotente) a pasta da soul no memory.db.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "memory_status",
    description: "Contagem de chunks e grafo (entidades/relações/observações) da soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "graph_list",
    description: "Lista entidades, relações e observações do grafo da soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "observation_add",
    description: "Adiciona uma observação ao grafo da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        entity_name: { type: "string", description: "nome da entidade" },
        body: { type: "string", description: "corpo da observação" },
        source: { type: "string", description: "origem da observação (opcional)" },
      },
      required: ["soul", "entity_name", "body"],
    },
  },
];

export const MEMORY_HANDLERS: Record<string, ToolHandler> = {
  memory_search: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_search");
    const query = typeof args.query === "string" && args.query.trim() ? args.query : null;
    if (!query) throw new Error("parâmetro query é obrigatório");
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, args.limit)) : 5;
    const pool = getPool(ctx.config.databaseUrl);
    const embedder = getEmbedder();
    const { results, verdict } = await searchWithVerdict(pool, soul.id, query, embedder, relevanceRule(), limit);
    return {
      soul: soul.id,
      query,
      verdict,
      results: results.map((r) => ({ doc: r.docKey, path: r.path, score: r.score, method: r.method, snippet: sanitizeLLMResponse(r.body.slice(0, 300)).sanitized })),
    };
  },

  memory_index: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_index");
    const pool = getPool(ctx.config.databaseUrl);
    const r = await indexDirectory(pool, soul.id, join(ctx.config.home, "souls", soul.id), getEmbedder());
    return { indexed: r.chunks, ...r };
  },

  memory_status: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_status");
    const pool = getPool(ctx.config.databaseUrl);
    return { chunks: await indexStats(pool, soul.id), graph: await graphStats(pool, soul.id) };
  },

  graph_list: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "graph_list");
    const pool = getPool(ctx.config.databaseUrl);
    return {
      entities: await listEntities(pool, soul.id),
      relations: await listRelations(pool, soul.id),
      observations: await listObservations(pool, soul.id),
    };
  },

  observation_add: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "observation_add");
    const entity_name = typeof args.entity_name === "string" && args.entity_name.trim() ? args.entity_name : null;
    const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
    const source = typeof args.source === "string" ? args.source : null;
    if (!entity_name || !body) throw new Error("entity_name e body são obrigatórios");
    const pool = getPool(ctx.config.databaseUrl);
    const now = new Date().toISOString();
    await addObservation(pool, soul.id, entity_name, body, source ?? undefined);
    return { ok: true, entity_name, body, source, ts: now };
  },
};
