/**
 * Tools LangChain para o agente LangGraph.
 *
 * Wrap das funções do Assistente OS como tools LangChain,
 * permitindo tool-calling no agente.
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listSouls,
  getSoul,
  anotar,
  registrarLicao,
  decidir,
  addAgendaItem,
  getAgendaItems,
  sumCostBySoul,
  recentCalls,
  type Pool,
} from "@assistente-os/core";
import {
  search,
  indexDirectory,
  indexStats,
  graphStats,
  listEntities,
  listRelations,
  listObservations,
  addObservation,
  getEmbedder,
} from "@assistente-os/memory";

export interface CreateToolsOptions {
  home: string;
  pool: Pool;
  soulId: string;
}

/**
 * Cria todas as tools LangChain para o agente.
 */
export function createAgentTools(options: CreateToolsOptions) {
  const { home, pool, soulId } = options;
  const embedder = getEmbedder();

  return [
    // ── Memory Tools ──────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "memory_search",
      description: "Busca RAG na memória da soul. Retorna chunks relevantes.",
      schema: z.object({
        query: z.string().describe("Consulta para buscar na memória"),
        limit: z.number().default(5).describe("Número máximo de resultados"),
      }),
      func: async ({ query, limit }) => {
        const results = await search(pool, soulId, query, embedder, limit);
        return results.map((r) => ({
          score: r.score,
          body: r.body.slice(0, 500),
          path: r.path,
          method: r.method,
        }));
      },
    }),

    new DynamicStructuredTool({
      name: "memory_index",
      description: "Indexa a pasta da soul no memory.db.",
      schema: z.object({}),
      func: async () => {
        const soul = getSoul(home, soulId);
        if (!soul) return { error: "soul não encontrada" };
        const n = await indexDirectory(pool, soulId, soul.dir, embedder);
        return { indexed: n };
      },
    }),

    new DynamicStructuredTool({
      name: "memory_status",
      description: " Retorna estatísticas da memória (chunks, entidades, relações).",
      schema: z.object({}),
      func: async () => {
        const chunks = await indexStats(pool, soulId);
        const graph = await graphStats(pool, soulId);
        return { chunks, graph };
      },
    }),

    // ── Graph Tools ───────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "graph_list",
      description: "Lista entidades, relações e observações do grafo da soul.",
      schema: z.object({}),
      func: async () => {
        const entities = await listEntities(pool, soulId);
        const relations = await listRelations(pool, soulId);
        const observations: Array<{ entity: string; body: string }> = [];
        for (const e of entities) {
          const obs = await listObservations(pool, soulId, e.name);
          for (const o of obs) {
            observations.push({ entity: e.name, body: o.body });
          }
        }
        return { entities, relations, observations };
      },
    }),

    new DynamicStructuredTool({
      name: "observation_add",
      description: "Adiciona uma observação ao grafo da soul.",
      schema: z.object({
        entity_name: z.string().describe("Nome da entidade"),
        body: z.string().describe("Corpo da observação"),
        source: z.string().optional().describe("Origem da observação"),
      }),
      func: async ({ entity_name, body, source }) => {
        await addObservation(pool, soulId, entity_name, body, source);
        return { ok: true };
      },
    }),

    // ── Soul Tools ────────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "soul_anotar",
      description: "Anota um item na sessão do dia da soul.",
      schema: z.object({
        texto: z.string().describe("Texto a anotar"),
      }),
      func: async ({ texto }) => {
        const soul = getSoul(home, soulId);
        if (!soul) return { error: "soul não encontrada" };
        anotar(soul.dir, texto);
        return { ok: true };
      },
    }),

    new DynamicStructuredTool({
      name: "soul_licao",
      description: "Registra uma lição aprendida em licoes.md da soul.",
      schema: z.object({
        texto: z.string().describe("Lição aprendida"),
      }),
      func: async ({ texto }) => {
        const soul = getSoul(home, soulId);
        if (!soul) return { error: "soul não encontrada" };
        registrarLicao(soul.dir, texto);
        return { ok: true };
      },
    }),

    new DynamicStructuredTool({
      name: "soul_decidir",
      description: "Grava uma decisão no formato ADR.",
      schema: z.object({
        titulo: z.string().describe("Título da decisão"),
        contexto: z.string().optional().describe("Contexto da decisão"),
        decisao: z.string().optional().describe("Decisão tomada"),
        alternativas: z.string().optional().describe("Alternativas consideradas"),
        consequencias: z.string().optional().describe("Consequências esperadas"),
      }),
      func: async ({ titulo, contexto, decisao, alternativas, consequencias }) => {
        const soul = getSoul(home, soulId);
        if (!soul) return { error: "soul não encontrada" };
        decidir(soul.dir, {
          titulo,
          contexto: contexto ?? "",
          decisao: decisao ?? "",
          alternativas: alternativas ?? "",
          consequencias: consequencias ?? "",
        });
        return { ok: true };
      },
    }),

    // ── Agenda Tools ──────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "agenda_add",
      description: "Agenda uma tarefa para execução futura.",
      schema: z.object({
        title: z.string().describe("Título da tarefa"),
        body: z.string().optional().describe("Descrição da tarefa"),
        due_at: z.string().optional().describe("Data/hora ISO 8601"),
      }),
      func: async ({ title, body, due_at }) => {
        const item = await addAgendaItem(pool, soulId, title, body ?? null, due_at ?? null);
        return { id: item.id, ok: true };
      },
    }),

    new DynamicStructuredTool({
      name: "agenda_list",
      description: "Lista itens da agenda por status.",
      schema: z.object({
        status: z.enum(["pending", "done", "all"]).default("pending"),
      }),
      func: async ({ status }) => {
        const items = await getAgendaItems(pool, status);
        return items;
      },
    }),

    // ── Cost Tools ────────────────────────────────────────────────
    new DynamicStructuredTool({
      name: "costs_summary",
      description: "Retorna resumo de custos da soul.",
      schema: z.object({}),
      func: async () => {
        const spent = await sumCostBySoul(pool, soulId);
        const recent = await recentCalls(pool, soulId, 10);
        return { spent, recent };
      },
    }),
  ];
}
