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
import { SPEC_GRILL_TOOLS, SPEC_GRILL_HANDLERS } from "./specGrill/index.js";
import { MISC_TOOLS, MISC_HANDLERS } from "./misc/index.js";
import { EDITORIAL_TOOLS, EDITORIAL_HANDLERS } from "./editorial/index.js";

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
  ...MISC_TOOLS,
  ...JOURNAL_TOOLS,
  ...GUARDIAN_TOOLS,
  ...SALES_TOOLS,
  ...SPEC_GRILL_TOOLS,
  ...ADO_TOOLS,
  ...BROWSER_TOOLS,
  ...WORKTREE_TOOLS,
  ...SKILL_TOOLS,
  ...SOUL_CREATE_TOOLS,
  ...EDITORIAL_TOOLS,
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
Object.assign(FAMILY_HANDLERS, SPEC_GRILL_HANDLERS);
Object.assign(FAMILY_HANDLERS, MISC_HANDLERS);
Object.assign(FAMILY_HANDLERS, EDITORIAL_HANDLERS);

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

    throw new Error(`ferramenta não implementada: ${name}`);
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
