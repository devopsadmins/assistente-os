import { join } from "node:path";
import { anotar, registrarLicao, decidir, recordAgentIncident, getLessons, generateAndWriteAiia, buscarFamiliaPorSoulId, getPool } from "@assistente-os/core";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const JOURNAL_TOOLS: Tool[] = [
  {
    name: "soul_anotar",
    description: "Anota um item cronológico na sessão do dia da soul (openclaw-style). Idempotente na data.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        texto: { type: "string", description: "nota a anotar" },
      },
      required: ["soul", "texto"],
    },
  },
  {
    name: "soul_licao",
    description: "Registra uma lição aprendida em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        texto: { type: "string", description: "lição aprendida" },
      },
      required: ["soul", "texto"],
    },
  },
  {
    name: "soul_decidir",
    description: "Grava uma decisão no formato ADR em decisoes/<data>-<slug>.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        titulo: { type: "string", description: "título da decisão" },
        contexto: { type: "string", description: "contexto/da decisão" },
        decisao: { type: "string", description: "decisão tomada" },
        alternativas: { type: "string", description: "alternativas consideradas" },
        consequencias: { type: "string", description: "consequências esperadas" },
      },
      required: ["soul", "titulo"],
    },
  },
  {
    name: "soul_record_lesson",
    description: "Registra um incidente de agente (erro + causa raiz + regra corretiva) em licoes.md da soul; após 3 reincidências do mesmo tópico, cria uma proposta de regra global aguardando aprovação humana (guardian_pending_rules/guardian_approve_rule).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        agentId: { type: "string", description: "id/nome do agente que cometeu o incidente" },
        topic: { type: "string", description: "tópico normalizado para agrupar reincidências (ex: shell-injection)" },
        mistake: { type: "string", description: "o que deu errado" },
        rootCause: { type: "string", description: "causa raiz do erro" },
        correctiveRule: { type: "string", description: "regra corretiva a seguir daqui em diante" },
      },
      required: ["soul", "agentId", "topic", "mistake", "rootCause", "correctiveRule"],
    },
  },
  {
    name: "soul_get_lessons",
    description: "Retorna as últimas lições registradas em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        limit: { type: "number", description: "quantidade máxima de lições (default 20)" },
      },
      required: ["soul"],
    },
  },
  {
    name: "soul_generate_aiia",
    description: "Gera/regrava AIIA.md (Avaliação de Impacto Algorítmico) da soul com base em capabilities, guardrails, dados pessoais/LGPD e regras de ouro atuais. Idempotente — sobrescreve o relatório anterior.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
      },
      required: ["soul"],
    },
  },
];

export const JOURNAL_HANDLERS: Record<string, ToolHandler> = {
  soul_anotar: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_anotar");
    const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
    if (!texto) throw new Error("parâmetro texto é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    const file = anotar(dir, texto);
    return { ok: true, arquivo: file, texto };
  },

  soul_licao: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_licao");
    const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
    if (!texto) throw new Error("parâmetro texto é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    const file = registrarLicao(dir, texto);
    return { ok: true, arquivo: file, texto };
  },

  soul_decidir: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_decidir");
    const titulo = typeof args.titulo === "string" && args.titulo.trim() ? args.titulo.trim() : null;
    if (!titulo) throw new Error("parâmetro titulo é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    try {
      const file = decidir(dir, {
        titulo,
        contexto: typeof args.contexto === "string" ? args.contexto : undefined,
        decisao: typeof args.decisao === "string" ? args.decisao : undefined,
        alternativas: typeof args.alternativas === "string" ? args.alternativas : undefined,
        consequencias: typeof args.consequencias === "string" ? args.consequencias : undefined,
      });
      return { ok: true, arquivo: file, titulo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  soul_record_lesson: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_record_lesson");
    const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : null;
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
    const mistake = typeof args.mistake === "string" && args.mistake.trim() ? args.mistake.trim() : null;
    const rootCause = typeof args.rootCause === "string" && args.rootCause.trim() ? args.rootCause.trim() : null;
    const correctiveRule = typeof args.correctiveRule === "string" && args.correctiveRule.trim() ? args.correctiveRule.trim() : null;
    if (!agentId || !topic || !mistake || !rootCause || !correctiveRule) {
      throw new Error("parâmetros agentId, topic, mistake, rootCause e correctiveRule são obrigatórios");
    }
    const result = recordAgentIncident(ctx.config.home, soul.id, { agentId, topic, mistake, rootCause, correctiveRule });
    return { ok: true, proposed: result.proposed };
  },

  soul_get_lessons: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_get_lessons");
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
    const dir = join(ctx.config.home, "souls", soul.id);
    return { ok: true, lessons: getLessons(dir, limit) };
  },

  soul_generate_aiia: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_generate_aiia");
    const pool = getPool(ctx.config.databaseUrl);
    const familia = await buscarFamiliaPorSoulId(pool, soul.id);
    const path = generateAndWriteAiia(ctx.config.home, soul.id, {
      familia,
      globalGuardrails: ctx.config.globalGuardrails,
    });
    return { ok: true, path };
  },
};
