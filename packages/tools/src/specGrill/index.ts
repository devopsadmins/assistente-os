import { join } from "node:path";
import { getPool, logFullAuditEntry } from "@assistente-os/core";
import { gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill, recordLlmCall, type GrillPlanResult } from "@assistente-os/daemon";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const SPEC_GRILL_TOOLS: Tool[] = [
  {
    name: "spec_grill_plan",
    description: "Refina requisitos de uma feature em duas fases antes de autorizar o modo build. Sem 'answers': gera 3-5 perguntas de esclarecimento e persiste em contexto.md como pendente. Com 'answers' (mínimo 3): valida e autoriza o plano, retornando buildModeAuthorized=true.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul dona da feature" },
        featureDraft: { type: "string", description: "descrição da feature a especificar (mesmo texto nas duas fases)" },
        answers: { type: "array", items: { type: "string" }, description: "respostas às perguntas geradas na Fase 1 (mínimo 3) — presença dispara a Fase 2" },
      },
      required: ["soul", "featureDraft"],
    },
  },
];

export const SPEC_GRILL_HANDLERS: Record<string, ToolHandler> = {
  spec_grill_plan: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "spec_grill_plan");
    const featureDraft = typeof args.featureDraft === "string" && args.featureDraft.trim() ? args.featureDraft.trim() : null;
    if (!featureDraft) throw new Error("parâmetro featureDraft é obrigatório");
    const soulDir = join(ctx.config.home, "souls", soul.id);
    const answers = Array.isArray(args.answers) ? args.answers.filter((a): a is string => typeof a === "string") : undefined;

    let result: GrillPlanResult;
    if (answers) {
      const { arquivo } = finalizarPlanoGrill(soulDir, featureDraft, answers);
      result = { ok: true, soulId: soul.id, buildModeAuthorized: true, arquivo };
    } else {
      const { questions, usage } = await gerarPerguntasGrill(featureDraft);
      const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
      result = { ok: true, soulId: soul.id, questions, arquivo };
      if (usage) {
        try {
          await recordLlmCall({
            pool: getPool(ctx.config.databaseUrl),
            soul: { id: soul.id },
            route: "spec-grill",
            provider: "ollama",
            model: process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            latencyMs: usage.latencyMs,
            source: usage.source,
          });
        } catch {
          /* telemetria best-effort */
        }
      }
    }

    logFullAuditEntry(ctx.config.home, {
      ts: new Date().toISOString(),
      sessionId: "mcp-tool",
      soulId: soul.id,
      intention: answers ? "spec_grill_plan: plano autorizado (Fase 2)" : "spec_grill_plan: perguntas geradas (Fase 1)",
      toolsCalled: ["spec_grill_plan"],
      params: { featureDraft, phase: answers ? 2 : 1 },
    });
    return result;
  },
};
