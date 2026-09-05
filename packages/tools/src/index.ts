#!/usr/bin/env node
import { loadConfig, listSouls, getSoul, isValidSoulId, getPool, runMigrations, sumCostBySoul, recentCalls, addAgendaItem, getAgendaItems, isToolAllowed, resolveAllowedTools, authorizeExecution, mcpZeroTrustOn, logFullAuditEntry, sanitizeLLMResponse, validateSoulSpec, resolveSoulSpecDefaults, createSoulFromSpec, computePlanHash, canonicalJsonStringify, SOUL_SPEC_SCHEMA_VERSION, CAPABILITY_CATALOG_VERSION, DEFAULT_GLOBAL_GUARDRAILS, scanSkillDirs, parseSkillFrontmatter, listSkills, writeSkillFile, buildSkillMd, type SoulSpec, type SkillFrontmatter, type AssistenteOsConfig } from "@assistente-os/core";
import { search, LiteralEmbedder, relevancia } from "@assistente-os/memory";
import { gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill, recordLlmCall, type GrillPlanResult, setupEnvironment } from "@assistente-os/daemon";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { GUARDIAN_TOOLS, GUARDIAN_HANDLERS } from "./guardian/index.js";
import { BROWSER_TOOLS, BROWSER_HANDLERS } from "./browser/index.js";
import { ADO_TOOLS, ADO_HANDLERS } from "./ado/index.js";
import { WORKTREE_TOOLS, WORKTREE_HANDLERS } from "./worktree/index.js";
import { SKILL_TOOLS, SKILL_HANDLERS } from "./skill/index.js";
import { SOUL_CREATE_TOOLS, SOUL_CREATE_HANDLERS } from "./soulCreate/index.js";
import { SALES_TOOLS, SALES_HANDLERS } from "./sales/index.js";
import { SOULS_TOOLS, SOULS_HANDLERS } from "./souls/index.js";
import { JOURNAL_TOOLS, JOURNAL_HANDLERS } from "./journal/index.js";
import { MEMORY_TOOLS, MEMORY_HANDLERS } from "./memory/index.js";

export const SERVER_NAME = "assistente-os";
export const SERVER_VERSION = "0.1.0";

// ── Agent Authorization (Zero Trust Allowlist) ──────────────────────────

/** Tools que exigem soul_id e passam pela verificação de allowlist. */
const SOUL_SCOPED_TOOLS = new Set([
  "memory_search", "memory_index", "memory_status",
  "graph_list", "observation_add",
  "soul_context", "soul_chat",
  "soul_anotar", "soul_licao", "soul_decidir",
  "soul_record_lesson", "soul_get_lessons", "soul_generate_aiia",
  "sales_ingest_meeting", "sales_get_lead_brief",
  "spec_grill_plan",
  "soul_create",
  "skill_create",
  "mission_run",
  "action_execute",
  "browser_navigate", "browser_click", "browser_extract_text",
  "browser_screenshot", "browser_close",
  "browser_get_accessibility_tree", "browser_execute_fix", "browser_audited_screenshot",
  "ado_list_projects", "ado_list_repositories", "ado_list_work_items",
  "ado_create_work_item", "ado_get_work_item", "ado_update_work_item",
  "ado_list_pipelines", "ado_run_pipeline",
  "ado_list_pull_requests", "ado_create_pull_request",
  "editorial_add_idea", "editorial_get_pipeline_status", "editorial_generate_drafts",
]);


/**
 * Verifica se a soul tem permissão para usar a tool.
 * Lança erro se negado; registra violação no audit trail.
 */
export function authorizeTool(configHome: string, soulId: string, toolName: string): void {
  const soul = getSoul(configHome, soulId);
  const patterns = resolveAllowedTools(soul?.config?.agent);
  if (!isToolAllowed(patterns, toolName)) {
    logFullAuditEntry({
      ts: new Date().toISOString(),
      sessionId: "mcp-guard",
      soulId,
      intention: `BLOQUEIO: tentativa de usar '${toolName}'`,
      toolsCalled: [toolName],
      params: { denied: true, allowedPatterns: patterns },
    });
    throw new Error(
      `[Security 42001] Soul '${soulId}' não tem permissão para executar '${toolName}'. ` +
      `Tools permitidas: ${patterns.join(", ")}`,
    );
  }
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: Tool[] = [
  ...SOULS_TOOLS,
  ...MEMORY_TOOLS,
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
  ...JOURNAL_TOOLS,
  ...GUARDIAN_TOOLS,
  ...SALES_TOOLS,
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
  ...ADO_TOOLS,
  ...BROWSER_TOOLS,
  ...WORKTREE_TOOLS,
  ...SKILL_TOOLS,
  ...SOUL_CREATE_TOOLS,
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

interface McpServerOptions {
  home: string;
}

/**
 * Contexto passado aos handlers de família de tool (ToolHandler).
 * Expõe config, requireSoul e authorizeAgentSoul para que cada módulo
 * possa reusar a lógica sem duplicação.
 */
export interface ToolContext {
  config: AssistenteOsConfig;
  requireSoul: (id: unknown) => { id: string } | { error: string };
  authorizeAgentSoul: (toolName: string) => void;
}

/**
 * Assinatura de um handler que executa uma tool de uma família.
 * Recebe o contexto compartilhado e os argumentos, retorna o resultado da tool.
 */
export type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Tabela de dispatch por família de tool. Populada pelos módulos migrados
 * em Tasks 2-5. Consultada em executeTool antes do switch legado — se uma
 * tool estiver aqui, seu handler roda; senão, cai no switch.
 */
export const FAMILY_HANDLERS: Record<string, ToolHandler> = {};

Object.assign(FAMILY_HANDLERS, GUARDIAN_HANDLERS);
Object.assign(FAMILY_HANDLERS, BROWSER_HANDLERS);
Object.assign(FAMILY_HANDLERS, ADO_HANDLERS);
Object.assign(FAMILY_HANDLERS, WORKTREE_HANDLERS);
Object.assign(FAMILY_HANDLERS, SKILL_HANDLERS);
Object.assign(FAMILY_HANDLERS, SOUL_CREATE_HANDLERS);
Object.assign(FAMILY_HANDLERS, SALES_HANDLERS);
Object.assign(FAMILY_HANDLERS, SOULS_HANDLERS);
Object.assign(FAMILY_HANDLERS, JOURNAL_HANDLERS);
Object.assign(FAMILY_HANDLERS, MEMORY_HANDLERS);

export class McpServer {
  private config;
  private closed = false;

  constructor(private options: McpServerOptions) {
    this.config = loadConfig({ home: options.home });
  }

  async handleMessage(msg: unknown): Promise<Record<string, unknown> | null> {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return null;
    const req = msg as Record<string, unknown>;
    const method = typeof req.method === "string" ? req.method : "";
    const id = req.id;

    // notificação: sem resposta
    if (method === "notifications/initialized" || method === "notifications/cancelled" || method === "notifications/progress") {
      return null;
    }

    const respond = (result: unknown, error?: unknown): Record<string, unknown> => ({
      jsonrpc: "2.0",
      id: id as string | number,
      ...(error !== undefined ? { error: error as Record<string, unknown> } : { result: result as Record<string, unknown> }),
    });

    try {
      switch (method) {
        case "initialize":
          return respond({
            protocolVersion: req.params && typeof req.params === "object" && (req.params as { protocolVersion?: string }).protocolVersion
              ? (req.params as { protocolVersion: string }).protocolVersion
              : "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          });

        case "ping":
          return respond({});

        case "tools/list": {
          const agentSoulId = process.env.AGENT_SOUL_ID;
          let soul = null;
          try {
            soul = agentSoulId ? getSoul(this.config.home, agentSoulId) : null;
          } catch {
            soul = null;
          }
          const patterns = soul ? resolveAllowedTools(soul.config?.agent) : null;
          const filtered = patterns
            ? TOOLS.filter((t) => isToolAllowed(patterns, t.name))
            : TOOLS;
          return respond({ tools: filtered });
        }

        case "tools/call":
          return await this.handleToolCall(req, respond);

        default:
          return respond(null, { code: -32601, message: `método desconhecido: ${method}` });
      }
    } catch (err) {
      return respond(null, { code: -32603, message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleToolCall(req: Record<string, unknown>, respond: (r: unknown, e?: unknown) => Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = params.name ?? "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return respond(null, { code: -32602, message: `ferramenta desconhecida: ${name}` });

    // Zero Trust central (Onda 1): TODA tool passa por authorizeExecution —
    // allowlist + nível de risco × autonomy (este só quando MCP_ZERO_TRUST=on) +
    // fail-closed para capability fora do catálogo. Os checks por-caso
    // (`authorizeTool`/`requireSoul`) continuam como defesa em profundidade.
    const gate = this.zeroTrustGate(name, args);
    if (!gate.ok) return respond(null, { code: -32000, message: gate.message });

    const result = await this.executeTool(name, args);
    return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  }

  /**
   * Gate Zero Trust central. **`MCP_ZERO_TRUST` desligado (default) = no-op** —
   * o comportamento fica idêntico ao pré-Onda-1 (os `authorizeTool`/`requireSoul`
   * por-caso seguem valendo). Ligado: resolve a soul do chamador (`args.soul`
   * senão `AGENT_SOUL_ID`) e roda `authorizeExecution` completo — allowlist +
   * nível de risco × autonomy + fail-closed para capability fora do catálogo.
   */
  private zeroTrustGate(name: string, args: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
    if (!mcpZeroTrustOn()) return { ok: true };
    const soulId =
      (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : "") ||
      (process.env.AGENT_SOUL_ID ?? "");
    if (!soulId) {
      if (SOUL_SCOPED_TOOLS.has(name)) {
        return { ok: false, message: `[Security 42001] '${name}' exige uma soul identificada (args.soul ou AGENT_SOUL_ID)` };
      }
      return { ok: true };
    }
    let agentConfig;
    try {
      agentConfig = getSoul(this.config.home, soulId)?.config?.agent;
    } catch {
      return { ok: false, message: `[Security 42001] soul inválida: ${soulId}` };
    }
    const decision = authorizeExecution({
      soulId,
      capability: name,
      agentConfig,
      enforcePolicyGates: true,
    });
    if (!decision.allow) {
      logFullAuditEntry({
        ts: new Date().toISOString(),
        sessionId: "mcp-zt-gate",
        soulId,
        intention: `BLOQUEIO ZeroTrust: '${name}' (${decision.code})`,
        toolsCalled: [name],
        params: { denied: true, reason: decision.reason },
      });
      return { ok: false, message: `[Security 42001] ${decision.reason}` };
    }
    return { ok: true };
  }

  private requireSoul(id: unknown): { id: string } | { error: string } {
    if (typeof id !== "string" || !id.trim()) return { error: "parâmetro soul é obrigatório" };
    let soul;
    try {
      soul = getSoul(this.config.home, id);
    } catch {
      return { error: `soul inválida: ${id}` };
    }
    if (!soul) return { error: `soul não encontrada: ${id}` };
    return { id };
  }

  /**
   * Autoriza uma tool que depende de AGENT_SOUL_ID (env, não parâmetro) em vez de `soul`.
   * Fail-closed: nega se AGENT_SOUL_ID não estiver setado, em vez de pular a checagem.
   */
  private authorizeAgentSoul(toolName: string): void {
    const agentSoulId = process.env.AGENT_SOUL_ID;
    if (!agentSoulId) {
      throw new Error(
        `[Security 42001] '${toolName}' exige AGENT_SOUL_ID configurado no processo (nenhuma soul identificada).`,
      );
    }
    authorizeTool(this.config.home, agentSoulId, toolName);
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Consulta à tabela de dispatch por família. Se há um handler registrado,
    // executa-o e retorna. Senão, cai no switch legado.
    const familyHandler = FAMILY_HANDLERS[name];
    if (familyHandler) {
      const ctx: ToolContext = {
        config: this.config,
        requireSoul: (id) => this.requireSoul(id),
        authorizeAgentSoul: (toolName) => this.authorizeAgentSoul(toolName),
      };
      return familyHandler(ctx, args);
    }

    switch (name) {
      case "costs_summary": {
        const pool = getPool(this.config.databaseUrl);
        const bySoul: Record<string, number> = {};
        for (const soul of listSouls(this.config.home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
        return { bySoul, recent: await recentCalls(pool, "main", 10) };
      }

      case "router_status":
        return { tiers: this.config.routerTiers, ollamaUrl: this.config.ollamaUrl, ollamaChatModel: this.config.ollamaChatModel, ollamaEmbedModel: this.config.ollamaEmbedModel };

      case "spec_grill_plan": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const featureDraft = typeof args.featureDraft === "string" && args.featureDraft.trim() ? args.featureDraft.trim() : null;
        if (!featureDraft) throw new Error("parâmetro featureDraft é obrigatório");
        const soulDir = join(this.config.home, "souls", soul.id);
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
                pool: getPool(this.config.databaseUrl),
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

        logFullAuditEntry({
          ts: new Date().toISOString(),
          sessionId: "mcp-tool",
          soulId: soul.id,
          intention: answers ? "spec_grill_plan: plano autorizado (Fase 2)" : "spec_grill_plan: perguntas geradas (Fase 1)",
          toolsCalled: [name],
          params: { featureDraft, phase: answers ? 2 : 1 },
        });
        return result;
      }

      case "agenda_add": {
        const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : null;
        if (!title) throw new Error("parâmetro title é obrigatório");
        const soulId = typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : null;
        if (soulId && !getSoul(this.config.home, soulId)) throw new Error(`soul não encontrada: ${soulId}`);
        const body = typeof args.body === "string" && args.body.trim() ? args.body.trim() : null;
        const dueAt = typeof args.due_at === "string" && args.due_at.trim() ? args.due_at.trim() : null;
        const pool = getPool(this.config.databaseUrl);
        const item = await addAgendaItem(pool, soulId, title, body, dueAt);
        return { ok: true, item };
      }

      case "agenda_list": {
        const status = args.status === "done" || args.status === "all" ? args.status : "pending";
        const pool = getPool(this.config.databaseUrl);
        // Escopo: `soul` do parâmetro, senão AGENT_SOUL_ID do processo. Sem
        // nenhum dos dois, cai no modo administrativo (todas as souls).
        const scopeSoul =
          (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined) ??
          (process.env.AGENT_SOUL_ID || undefined);
        return { items: await getAgendaItems(pool, status, scopeSoul) };
      }

      case "editorial_add_idea": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
        const vertical = typeof args.vertical === "string" && args.vertical.trim() ? args.vertical.trim() : null;
        const source = typeof args.source === "string" && args.source.trim() ? args.source.trim() : null;
        const priority = typeof args.priority === "string" ? args.priority : "medium";
        const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
        if (!topic || !vertical || !source) {
          throw new Error("parâmetros topic, vertical e source são obrigatórios");
        }
        const dir = join(this.config.home, "souls", soul.id);
        const ideiaDir = join(dir, "editorial", "ideias");
        if (!existsSync(ideiaDir)) {
          await import("node:fs/promises").then((fs) => fs.mkdir(ideiaDir, { recursive: true }));
        }
        const ideiaId = `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ideiaPath = join(ideiaDir, `${ideiaId}.md`);
        const conteudo = `# Ideia Editorial: ${topic}\n\n**Vertical:** ${vertical}\n**Fonte:** ${source}\n**Prioridade:** ${priority}\n**Tags:** ${tags.join(", ") || "—"}\n**Status:** backlog\n**Criado em:** ${new Date().toISOString()}\n\n---\n\n${topic}\n`;
        await import("node:fs/promises").then((fs) => fs.writeFile(ideiaPath, conteudo, "utf8"));
        return { ok: true, ideaId: ideiaId, path: ideiaPath, topic, vertical, status: "backlog" };
      }

      case "editorial_get_pipeline_status": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const dir = join(this.config.home, "souls", soul.id);
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
      }

      case "editorial_generate_drafts": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const ideaIds = Array.isArray(args.ideaIds) ? args.ideaIds.filter((i): i is string => typeof i === "string") : [];
        const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p): p is string => typeof p === "string") : [];
        const tone = typeof args.tone === "string" ? args.tone : "professional";
        if (ideaIds.length === 0 || platforms.length === 0) {
          throw new Error("parâmetros ideaIds e platforms são obrigatórios");
        }
        const dir = join(this.config.home, "souls", soul.id);
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
      }

      default:
        throw new Error(`ferramenta não implementada: ${name}`);
    }
  }
}

/** Lê mensagens JSON-RPC de stdin (uma por linha) e responde em stdout. */
export async function startStdio(home: string): Promise<void> {
  const server = new McpServer({ home });
  await runMigrations(getPool(loadConfig({ home }).databaseUrl));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    void server
      .handleMessage(msg)
      .then((res) => {
        if (res) process.stdout.write(JSON.stringify(res) + "\n");
      })
      .catch(() => {
        /* ignora */
      });
  });
}

if (process.argv[1] && process.argv[1].endsWith(join("dist", "index.js"))) {
  const config = loadConfig();
  void startStdio(config.home);
}
