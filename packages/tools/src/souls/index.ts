import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { EOL } from "node:os";
import { listSouls, getSoul, getPool, addAgendaItem, finishAgendaItem, sanitizeLLMResponse } from "@assistente-os/core";
import { runOpenCode } from "@assistente-os/daemon";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

/** Extrai o texto das partes NDJSON emitidas pelo `opencode run` no stdout. */
function extractOpenCodeText(stdout: string): string {
  const textLines = stdout.split(EOL).map((l) => {
    try {
      const j = JSON.parse(l) as { type?: string; part?: { text?: string } };
      return j.type === "text" && j.part?.text ? j.part.text : "";
    } catch {
      return "";
    }
  });
  return textLines.filter(Boolean).join("\n");
}

export const SOULS_TOOLS: Tool[] = [
  {
    name: "souls_list",
    description: "Lista as souls disponíveis no terrasIA.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "soul_context",
    description: "Retorna o contexto (perfil/contexto/licoes/pessoas/soul.md) de uma soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "soul_chat",
    description: "Roda opencode run headless na soul. Retorna o texto gerado.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        prompt: { type: "string", description: "instrução/consulta" },
        model: { type: "string", description: "opcional: modelo a usar" },
        timeoutSeconds: { type: "number", default: 300 },
      },
      required: ["soul", "prompt"],
    },
  },
  {
    name: "action_execute",
    description: "Executa uma ação registrada na agenda ou dispara um fluxo de trabalho.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        title: { type: "string", description: "título da ação" },
        body: { type: "string", description: "descrição da ação" },
        tier: { type: "string", description: "tier do opencode (local/zen/soul)", enum: ["local", "zen", "soul"] },
        model: { type: "string", description: "modelo a usar" },
      },
      required: ["soul", "title", "body"],
    },
  },
];

export const SOULS_HANDLERS: Record<string, ToolHandler> = {
  souls_list: async (ctx) => {
    return listSouls(ctx.config.home).map((s) => ({ id: s.id, description: s.config.description ?? null }));
  },

  soul_context: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_context");
    const files = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];
    const parts: string[] = [];
    for (const f of files) {
      const p = join(ctx.config.home, "souls", soul.id, f);
      if (existsSync(p)) parts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
    }
    return { soul: soul.id, context: parts.join("\n\n") };
  },

  soul_chat: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_chat");
    const prompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt : null;
    if (!prompt) throw new Error("parâmetro prompt é obrigatório");
    const model = typeof args.model === "string" && args.model ? args.model : undefined;
    const timeoutSeconds = typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 300;
    const result = await runOpenCode(prompt, { cwd: join(ctx.config.home, "souls", soul.id), model, timeoutSeconds });
    const rawText = extractOpenCodeText(result.stdout);
    const sanitized = sanitizeLLMResponse(rawText);
    return { ok: result.code === 0 && !result.timedOut, code: result.code, timedOut: result.timedOut, text: sanitized.sanitized, stderr: result.stderr.slice(-1000), contentFilter: sanitized.count > 0 ? { detected: sanitized.count } : undefined };
  },

  action_execute: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "action_execute");
    const title = typeof args.title === "string" && args.title.trim() ? args.title : null;
    const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
    const model = typeof args.model === "string" && args.model ? args.model : "nemotron-3-ultra-free";
    if (!title || !body) throw new Error("title e body são obrigatórios");
    // Registra na agenda e despacha de imediato (síncrono, fora do loop de dispatch do daemon)
    const pool = getPool(ctx.config.databaseUrl);
    const item = await addAgendaItem(pool, soul.id, title, body, null);
    const prompt = `[action] Execução: ${title}\n\n${body}`;
    const result = await runOpenCode(prompt, { cwd: ctx.config.home, model, timeoutSeconds: 300 });
    // Marca concluído/falho aqui mesmo: já foi despachado, não deve ser reprocessado pelo loop do daemon.
    await finishAgendaItem(
      pool,
      item.id,
      result.code === 0 && !result.timedOut ? "completed" : "failed",
      result.timedOut ? "timeout" : result.code !== 0 ? `opencode saiu com código ${result.code}` : undefined,
    );
    const rawText = extractOpenCodeText(result.stdout);
    return {
      ok: result.code === 0 && !result.timedOut,
      code: result.code,
      timedOut: result.timedOut,
      agendaId: item.id,
      title,
      text: sanitizeLLMResponse(rawText).sanitized,
      stderr: result.stderr.slice(-1000),
    };
  },
};
