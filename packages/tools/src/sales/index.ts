import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { meetingIngestPipeline, generateCloserBrief } from "@assistente-os/daemon";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const SALES_TOOLS: Tool[] = [
  {
    name: "sales_ingest_meeting",
    description: "Ingere uma transcrição de reunião/call (vtt/srt/txt), extrai decisões/ações/objeções via LLM local e persiste em souls/<soul>/sessoes/YYYY-MM-DD-meeting.md.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul dona da reunião" },
        transcriptContent: { type: "string", description: "conteúdo bruto da transcrição" },
        format: { type: "string", description: "formato da transcrição", enum: ["vtt", "srt", "txt"] },
      },
      required: ["soul", "transcriptContent", "format"],
    },
  },
  {
    name: "sales_get_lead_brief",
    description: "Gera um dossiê pré-call (objeções e decisões anteriores) para um lead a partir do histórico de reuniões já ingeridas da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        leadContact: { type: "string", description: "identificador do lead/contato (nome, telefone, e-mail)" },
      },
      required: ["soul", "leadContact"],
    },
  },
];

export const SALES_HANDLERS: Record<string, ToolHandler> = {
  sales_ingest_meeting: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "sales_ingest_meeting");
    const transcriptContent = typeof args.transcriptContent === "string" && args.transcriptContent.trim() ? args.transcriptContent : null;
    const format = typeof args.format === "string" ? args.format : null;
    if (!transcriptContent || !format || !["vtt", "srt", "txt"].includes(format)) {
      throw new Error("parâmetros transcriptContent e format ('vtt'|'srt'|'txt') são obrigatórios");
    }
    const tempPath = join(tmpdir(), `sales-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`);
    await writeFile(tempPath, transcriptContent, "utf8");
    try {
      const result = await meetingIngestPipeline(tempPath, soul.id);
      return { ok: true, meetingPath: result.meetingPath, meetingPayload: result.meetingPayload };
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  },

  sales_get_lead_brief: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "sales_get_lead_brief");
    const leadContact = typeof args.leadContact === "string" && args.leadContact.trim() ? args.leadContact.trim() : null;
    if (!leadContact) throw new Error("parâmetro leadContact é obrigatório");
    const brief = await generateCloserBrief(soul.id, leadContact);
    return { ok: true, brief };
  },
};
