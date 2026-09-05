import { join } from "node:path";
import { existsSync } from "node:fs";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const EDITORIAL_TOOLS: Tool[] = [
  {
    name: "editorial_add_idea",
    description: "Adiciona uma ideia ao pipeline editorial (tópico, vertical, fonte, prioridade, tags).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        topic: { type: "string", description: "tópico da ideia" },
        vertical: { type: "string", description: "vertical/cliente alvo" },
        source: { type: "string", description: "origem: call, meeting, doc, release, insight" },
        priority: { type: "string", description: "prioridade: high, medium, low", enum: ["high", "medium", "low"] },
        tags: { type: "array", items: { type: "string" }, description: "tags para categorização" },
      },
      required: ["soul", "topic", "vertical", "source"],
    },
  },
  {
    name: "editorial_get_pipeline_status",
    description: "Retorna status do pipeline editorial: ideias, em produção, publicadas, métricas por vertical.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        vertical: { type: "string", description: "filtrar por vertical (opcional)" },
        status: { type: "string", description: "filtrar por status: backlog, in_production, review, published", enum: ["backlog", "in_production", "review", "published"] },
      },
      required: ["soul"],
    },
  },
  {
    name: "editorial_generate_drafts",
    description: "Gera rascunhos multi-plataforma (Substack/DEV/Medium/LinkedIn) a partir de ideias aprovadas + conhecimento da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        ideaIds: { type: "array", items: { type: "string" }, description: "IDs das ideias aprovadas" },
        platforms: { type: "array", items: { type: "string", enum: ["substack", "dev", "medium", "linkedin"] }, description: "plataformas alvo" },
        tone: { type: "string", description: "tom: professional, casual, technical, executive", enum: ["professional", "casual", "technical", "executive"] },
      },
      required: ["soul", "ideaIds", "platforms"],
    },
  },
];

export const EDITORIAL_HANDLERS: Record<string, ToolHandler> = {
  editorial_add_idea: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_add_idea");
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
    const vertical = typeof args.vertical === "string" && args.vertical.trim() ? args.vertical.trim() : null;
    const source = typeof args.source === "string" && args.source.trim() ? args.source.trim() : null;
    const priority = typeof args.priority === "string" ? args.priority : "medium";
    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
    if (!topic || !vertical || !source) {
      throw new Error("parâmetros topic, vertical e source são obrigatórios");
    }
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    if (!existsSync(ideiaDir)) {
      await import("node:fs/promises").then((fs) => fs.mkdir(ideiaDir, { recursive: true }));
    }
    const ideiaId = `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ideiaPath = join(ideiaDir, `${ideiaId}.md`);
    const conteudo = `# Ideia Editorial: ${topic}\n\n**Vertical:** ${vertical}\n**Fonte:** ${source}\n**Prioridade:** ${priority}\n**Tags:** ${tags.join(", ") || "—"}\n**Status:** backlog\n**Criado em:** ${new Date().toISOString()}\n\n---\n\n${topic}\n`;
    await import("node:fs/promises").then((fs) => fs.writeFile(ideiaPath, conteudo, "utf8"));
    return { ok: true, ideaId: ideiaId, path: ideiaPath, topic, vertical, status: "backlog" };
  },

  editorial_get_pipeline_status: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_get_pipeline_status");
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    if (!existsSync(ideiaDir)) {
      return { ok: true, soul: soul.id, pipeline: { backlog: [], in_production: [], review: [], published: [] }, metrics: { total: 0, byVertical: {}, byStatus: {} } };
    }
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(ideiaDir);
    type PipelineStatus = "backlog" | "in_production" | "review" | "published";
    const pipeline: Record<PipelineStatus, Array<{ id: string; topic: string; vertical: string; status: PipelineStatus }>> = {
      backlog: [],
      in_production: [],
      review: [],
      published: [],
    };
    const metrics = { total: 0, byVertical: {} as Record<string, number>, byStatus: {} as Record<string, number> };
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(ideiaDir, file), "utf8");
      const verticalMatch = content.match(/\*\*Vertical:\*\*\s*(.+)/);
      const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/);
      const vertical = verticalMatch?.[1]?.trim() || "unknown";
      const status = (statusMatch?.[1]?.trim() as PipelineStatus) || "backlog";
      const topicLine = content.split("\n")[0] ?? "";
      const idea = { id: file.replace(".md", ""), topic: topicLine.replace("# Ideia Editorial: ", ""), vertical, status };
      pipeline[status].push(idea);
      metrics.total++;
      metrics.byVertical[vertical] = (metrics.byVertical[vertical] || 0) + 1;
      metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;
    }
    const verticalFilter = typeof args.vertical === "string" ? args.vertical : null;
    const statusFilter = typeof args.status === "string" ? args.status : null;
    let filtered: Record<PipelineStatus, Array<{ id: string; topic: string; vertical: string; status: PipelineStatus }>> = { ...pipeline };
    if (verticalFilter) {
      for (const k of (Object.keys(filtered) as PipelineStatus[])) {
        filtered[k] = filtered[k].filter((i) => i.vertical === verticalFilter);
      }
    }
    if (statusFilter && filtered[statusFilter as PipelineStatus]) {
      filtered = { [statusFilter]: filtered[statusFilter as PipelineStatus] } as typeof filtered;
    }
    return { ok: true, soul: soul.id, pipeline: filtered, metrics };
  },

  editorial_generate_drafts: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_generate_drafts");
    const ideaIds = Array.isArray(args.ideaIds) ? args.ideaIds.filter((i): i is string => typeof i === "string") : [];
    const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p): p is string => typeof p === "string") : [];
    const tone = typeof args.tone === "string" ? args.tone : "professional";
    if (ideaIds.length === 0 || platforms.length === 0) {
      throw new Error("parâmetros ideaIds e platforms são obrigatórios");
    }
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    const draftsDir = join(dir, "editorial", "drafts");
    if (!existsSync(draftsDir)) {
      await import("node:fs/promises").then((fs) => fs.mkdir(draftsDir, { recursive: true }));
    }
    const drafts = [];
    for (const ideaId of ideaIds) {
      const ideiaPath = join(ideiaDir, `${ideaId}.md`);
      if (!existsSync(ideiaPath)) continue;
      const content = await import("node:fs/promises").then((fs) => fs.readFile(ideiaPath, "utf8"));
      const topic = (content.split("\n")[0] ?? "").replace("# Ideia Editorial: ", "");
      const verticalMatch = content.match(/\*\*Vertical:\*\*\s*(.+)/);
      const vertical = (verticalMatch?.[1]?.trim() ?? "general");
      for (const platform of platforms) {
        const draftId = `draft-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const draftPath = join(draftsDir, `${draftId}.md`);
        const platformGuidance: Record<"substack" | "dev" | "medium" | "linkedin", string> = {
          substack: "Artigo longo, narrativo, com gancho forte no início, seções claras, call-to-action no final para newsletter.",
          dev: "Tutorial técnico prático, com código, passos reproduzíveis, foco em 'como fazer', tom developer-to-developer.",
          medium: "Storytelling reflexivo, estrutura ensaio, insights pessoais, formatação visual (subheads, bullets, quotes).",
          linkedin: "Post profissional, 1300 chars máx, gancho na 1ª linha, 3-5 bullets de valor, hashtags relevantes, CTA sutil.",
        };
        const guidance = platformGuidance[platform as "substack" | "dev" | "medium" | "linkedin"];
        const draftContent = `# Rascunho ${platform.toUpperCase()}: ${topic}\n\n**Vertical:** ${vertical}\n**Tom:** ${tone}\n**Ideia original:** ${ideaId}\n**Criado em:** ${new Date().toISOString()}\n\n---\n\n> **Guidance ${platform}:** ${guidance}\n\n## Estrutura sugerida\n\n1. **Gancho** — problema/dor da vertical ${vertical}\n2. **Contexto** — por que isso importa agora (dados do RAG/grafo da soul)\n3. **Solução/Insight** — o que o Assistente OS entrega (diferencial vs. Hermes, ROI, segurança)\n4. **Evidência** — case/métrica real (buscar no memory_search)\n5. **CTA** — próximo passo (demo, call, trial)\n\n---\n\n*Rascunho gerado automaticamente — revisar antes de publicar.*\n`;
        await import("node:fs/promises").then((fs) => fs.writeFile(draftPath, draftContent, "utf8"));
        drafts.push({ id: draftId, platform, topic, vertical, tone, path: draftPath });
        // Atualiza status da ideia para "in_production"
        const updatedContent = content.replace(/\*\*Status:\*\*\s*backlog/, "**Status:** in_production");
        await import("node:fs/promises").then((fs) => fs.writeFile(ideiaPath, updatedContent, "utf8"));
      }
    }
    return { ok: true, soul: soul.id, drafts, count: drafts.length };
  },
};
