#!/usr/bin/env node
import { loadConfig, listSouls, getSoul, isValidSoulId, getPool, runMigrations, sumCostBySoul, recentCalls, addAgendaItem, getAgendaItems, finishAgendaItem, anotar, registrarLicao, decidir, getAdoOrg, isToolAllowed, resolveAllowedTools, authorizeExecution, mcpZeroTrustOn, logFullAuditEntry, sanitizeLLMResponse, recordAgentIncident, getLessons, auditExecution, proposeRule, listPendingRules, approveRule, rejectRule, resendApprovalCode, listActiveGoldenRules, generateAndWriteAiia, buscarFamiliaPorSoulId, validateSoulSpec, resolveSoulSpecDefaults, createSoulFromSpec, computePlanHash, canonicalJsonStringify, SOUL_SPEC_SCHEMA_VERSION, CAPABILITY_CATALOG_VERSION, DEFAULT_GLOBAL_GUARDRAILS, scanSkillDirs, parseSkillFrontmatter, listSkills, writeSkillFile, buildSkillMd, resolveRelevanceGate, type SoulSpec, type SkillFrontmatter, type AssistenteOsConfig } from "@assistente-os/core";
import { indexDirectory, search, searchWithVerdict, indexStats, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder, LiteralEmbedder, relevancia, type RelevanceRule } from "@assistente-os/memory";
import { runOpenCode, meetingIngestPipeline, generateCloserBrief, gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill, recordLlmCall, type GrillPlanResult, createWorktree, setupEnvironment, mergeLocally, destroyWorktree, listWorktrees, listMissions, runMission } from "@assistente-os/daemon";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { EOL, tmpdir } from "node:os";
import { GUARDIAN_TOOLS, GUARDIAN_HANDLERS } from "./guardian/index.js";
import { BROWSER_TOOLS, BROWSER_HANDLERS } from "./browser/index.js";
import { ADO_TOOLS, ADO_HANDLERS } from "./ado/index.js";

export const SERVER_NAME = "assistente-os";
export const SERVER_VERSION = "0.1.0";

/** Gate de relevância configurável por env (default: modo "aviso"). */
export function relevanceRule(_configHome: string): RelevanceRule {
  const gate = resolveRelevanceGate();
  return { modo: gate.modo, min_score: gate.minScore, min_term_matches: gate.minTerms };
}

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
  {
    name: "souls_list",
    description: "Lista as souls disponíveis no Assistente OS.",
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
  ...GUARDIAN_TOOLS,
  ...BROWSER_TOOLS,
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
  // Worktree Management Tools
  {
    name: "worktree_create",
    description: "Cria worktree isolada para tarefa agêntica paralela.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
        baseBranch: { type: "string", description: "branch base (default: main)", default: "main" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_merge_locally",
    description: "Valida testes e faz merge local da worktree na branch alvo.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
        targetBranch: { type: "string", description: "branch alvo (default: main)", default: "main" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_destroy",
    description: "Destrói worktree e limpa referências git.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        taskId: { type: "string", description: "id da tarefa" },
      },
      required: ["soul", "taskId"],
    },
  },
  {
    name: "worktree_list",
    description: "Lista as worktrees de tarefa ativas (branch/HEAD reais via git worktree list).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mission_list",
    description: "Lista as missões compostas do Mission Runner (ORCA) — id, modo (headless/guarded/full) e nº de etapas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mission_run",
    description: "Executa uma missão composta do Mission Runner. Efeito externo (browser/agenda/ingest) — L3.",
    inputSchema: {
      type: "object",
      properties: {
        mission_id: { type: "string", description: "id da missão (ver mission_list)" },
        soul: { type: "string", description: "soul para sobrescrever a das etapas (opcional)" },
      },
      required: ["mission_id"],
    },
  },
  {
    name: "skill_list",
    description:
      "Lista as skills visíveis para uma soul (SKILL.md global ou per-soul), com escopo, tools advisórias e se está na allowlist (`agent.permissions.skills`).",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul (default: AGENT_SOUL_ID ou 'main')" } },
    },
  },
  {
    name: "skill_create",
    description:
      "Cria uma skill (SKILL.md). dry_run=true (default) valida o frontmatter e devolve plan_hash sem escrever; " +
      "dry_run=false exige o plan_hash. scope 'soul' (default) grava na pasta da soul; 'global' no diretório compartilhado. Efeito estrutural (L3).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "slug da skill (a-z, 0-9, hífen; 2-64 chars)" },
        description: { type: "string", description: "1 linha (≤280) — é o que o matcher usa" },
        body: { type: "string", description: "corpo markdown com as instruções" },
        keywords: { type: "string", description: "CSV de gatilhos léxicos explícitos (frases OK)" },
        tools: { type: "string", description: "CSV de tools MCP relevantes (advisório — não eleva a allowlist)" },
        scope: { type: "string", description: "soul | global (default: soul)" },
        soul: { type: "string", description: "id da soul quando scope=soul (default: AGENT_SOUL_ID)" },
        dry_run: { type: "boolean", description: "default true — só valida e devolve plan_hash" },
        plan_hash: { type: "string", description: "obrigatório quando dry_run=false" },
      },
      required: ["name", "description", "body"],
    },
  },
  {
    name: "soul_create",
    description:
      "Cria uma nova soul de forma guiada. dry_run=true (default) valida e devolve plan_hash + preview sem escrever; " +
      "dry_run=false exige o plan_hash do dry-run anterior e materializa a soul atomicamente. Efeito estrutural (L3).",
    inputSchema: {
      type: "object",
      properties: {
        soul_id: { type: "string", description: "id da nova soul (slug: a-z, 0-9, hífen)" },
        purpose: { type: "string", description: "descrição curta do propósito da soul" },
        autonomy: { type: "string", description: "suggest | ask | auto (default: ask)" },
        provider: { type: "string", description: "provider do opencode (ex.: zen-sousa)" },
        model: { type: "string", description: "modelo de chat" },
        capabilities: { type: "string", description: "CSV de capabilities do catálogo L1/L2/L3 (ex.: 'memory:*,graph_list')" },
        connectors: { type: "string", description: "CSV de conectores" },
        skills: { type: "string", description: "CSV de skills" },
        daily_limit: { type: "number", description: "teto de gasto diário (unidades do provider)" },
        max_turns: { type: "number", description: "limite de turnos por sessão" },
        perfil_md: { type: "string", description: "conteúdo de perfil.md" },
        contexto_md: { type: "string", description: "conteúdo de contexto.md" },
        pessoas_md: { type: "string", description: "conteúdo de pessoas.md" },
        soul_md: { type: "string", description: "conteúdo de soul.md" },
        dry_run: { type: "boolean", description: "default true — só valida e devolve plan_hash" },
        plan_hash: { type: "string", description: "obrigatório quando dry_run=false: o hash devolvido pelo dry-run" },
      },
      required: ["soul_id", "purpose"],
    },
  },
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

/** Mapeia o payload wire (snake_case) da tool soul_create para o SoulSpec de domínio. */
function soulSpecFromWire(a: Record<string, unknown>): SoulSpec {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const csv = (v: unknown): string[] | undefined => {
    const s = str(v);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  };
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const autonomyRaw = str(a.autonomy);
  const autonomy = autonomyRaw === "suggest" || autonomyRaw === "auto" ? autonomyRaw : "ask";
  return {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId: String(a.soul_id ?? ""),
    description: str(a.purpose),
    perfilMd: str(a.perfil_md),
    contextoMd: str(a.contexto_md),
    pessoasMd: str(a.pessoas_md),
    soulMd: str(a.soul_md),
    autonomy,
    capabilities: csv(a.capabilities) ?? [],
    connectors: csv(a.connectors),
    skills: csv(a.skills),
    provider: str(a.provider),
    model: str(a.model),
    guardrails: {
      maxTurns: num(a.max_turns),
      dailyLimitTokens: num(a.daily_limit),
    },
  };
}

interface McpServerOptions {
  home: string;
}

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
      case "souls_list": {
        return listSouls(this.config.home).map((s) => ({ id: s.id, description: s.config.description ?? null }));
      }

      case "soul_context": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const files = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];
        const parts: string[] = [];
        for (const f of files) {
          const p = join(this.config.home, "souls", soul.id, f);
          if (existsSync(p)) parts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
        }
        return { soul: soul.id, context: parts.join("\n\n") };
      }

      case "soul_chat": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const prompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt : null;
        if (!prompt) throw new Error("parâmetro prompt é obrigatório");
        const model = typeof args.model === "string" && args.model ? args.model : undefined;
        const timeoutSeconds = typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 300;
        const result = await runOpenCode(prompt, { cwd: join(this.config.home, "souls", soul.id), model, timeoutSeconds });
        const rawText = extractOpenCodeText(result.stdout);
        const sanitized = sanitizeLLMResponse(rawText);
        return { ok: result.code === 0 && !result.timedOut, code: result.code, timedOut: result.timedOut, text: sanitized.sanitized, stderr: result.stderr.slice(-1000), contentFilter: sanitized.count > 0 ? { detected: sanitized.count } : undefined };
      }

      case "memory_search": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const query = typeof args.query === "string" && args.query.trim() ? args.query : null;
        if (!query) throw new Error("parâmetro query é obrigatório");
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, args.limit)) : 5;
        const pool = getPool(this.config.databaseUrl);
        const embedder = getEmbedder();
        const { results, verdict } = await searchWithVerdict(pool, soul.id, query, embedder, relevanceRule(this.config.home), limit);
        return {
          soul: soul.id,
          query,
          verdict,
          results: results.map((r) => ({ doc: r.docKey, path: r.path, score: r.score, method: r.method, snippet: sanitizeLLMResponse(r.body.slice(0, 300)).sanitized })),
        };
      }

      case "memory_index": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const pool = getPool(this.config.databaseUrl);
        const r = await indexDirectory(pool, soul.id, join(this.config.home, "souls", soul.id), getEmbedder());
        return { indexed: r.chunks, ...r };
      }

      case "memory_status": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const pool = getPool(this.config.databaseUrl);
        return { chunks: await indexStats(pool, soul.id), graph: await graphStats(pool, soul.id) };
      }

      case "graph_list": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const pool = getPool(this.config.databaseUrl);
        return {
          entities: await listEntities(pool, soul.id),
          relations: await listRelations(pool, soul.id),
          observations: await listObservations(pool, soul.id),
        };
      }

      case "costs_summary": {
        const pool = getPool(this.config.databaseUrl);
        const bySoul: Record<string, number> = {};
        for (const soul of listSouls(this.config.home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
        return { bySoul, recent: await recentCalls(pool, "main", 10) };
      }

      case "router_status":
        return { tiers: this.config.routerTiers, ollamaUrl: this.config.ollamaUrl, ollamaChatModel: this.config.ollamaChatModel, ollamaEmbedModel: this.config.ollamaEmbedModel };

      case "observation_add": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const entity_name = typeof args.entity_name === "string" && args.entity_name.trim() ? args.entity_name : null;
        const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
        const source = typeof args.source === "string" ? args.source : null;
        if (!entity_name || !body) throw new Error("entity_name e body são obrigatórios");
        const pool = getPool(this.config.databaseUrl);
        const now = new Date().toISOString();
        await addObservation(pool, soul.id, entity_name, body, source ?? undefined);
        return { ok: true, entity_name, body, source, ts: now };
      }

      case "action_execute": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const title = typeof args.title === "string" && args.title.trim() ? args.title : null;
        const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
        const model = typeof args.model === "string" && args.model ? args.model : "nemotron-3-ultra-free";
        if (!title || !body) throw new Error("title e body são obrigatórios");
        // Registra na agenda e despacha de imediato (síncrono, fora do loop de dispatch do daemon)
        const pool = getPool(this.config.databaseUrl);
        {
          const item = await addAgendaItem(pool, soul.id, title, body, null);
          const prompt = `[action] Execução: ${title}\n\n${body}`;
          const result = await runOpenCode(prompt, { cwd: this.config.home, model, timeoutSeconds: 300 });
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
        }
      }

      case "soul_anotar": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
        if (!texto) throw new Error("parâmetro texto é obrigatório");
        const dir = join(this.config.home, "souls", soul.id);
        const file = anotar(dir, texto);
        return { ok: true, arquivo: file, texto };
      }

      case "soul_licao": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
        if (!texto) throw new Error("parâmetro texto é obrigatório");
        const dir = join(this.config.home, "souls", soul.id);
        const file = registrarLicao(dir, texto);
        return { ok: true, arquivo: file, texto };
      }

      case "soul_decidir": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const titulo = typeof args.titulo === "string" && args.titulo.trim() ? args.titulo.trim() : null;
        if (!titulo) throw new Error("parâmetro titulo é obrigatório");
        const dir = join(this.config.home, "souls", soul.id);
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
      }

      case "soul_record_lesson": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : null;
        const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
        const mistake = typeof args.mistake === "string" && args.mistake.trim() ? args.mistake.trim() : null;
        const rootCause = typeof args.rootCause === "string" && args.rootCause.trim() ? args.rootCause.trim() : null;
        const correctiveRule = typeof args.correctiveRule === "string" && args.correctiveRule.trim() ? args.correctiveRule.trim() : null;
        if (!agentId || !topic || !mistake || !rootCause || !correctiveRule) {
          throw new Error("parâmetros agentId, topic, mistake, rootCause e correctiveRule são obrigatórios");
        }
        const result = recordAgentIncident(this.config.home, soul.id, { agentId, topic, mistake, rootCause, correctiveRule });
        return { ok: true, proposed: result.proposed };
      }

      case "soul_get_lessons": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
        const dir = join(this.config.home, "souls", soul.id);
        return { ok: true, lessons: getLessons(dir, limit) };
      }

      case "soul_generate_aiia": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const pool = getPool(this.config.databaseUrl);
        const familia = await buscarFamiliaPorSoulId(pool, soul.id);
        const path = generateAndWriteAiia(this.config.home, soul.id, {
          familia,
          globalGuardrails: this.config.globalGuardrails,
        });
        return { ok: true, path };
      }

      case "sales_ingest_meeting": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
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
      }

      case "sales_get_lead_brief": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const leadContact = typeof args.leadContact === "string" && args.leadContact.trim() ? args.leadContact.trim() : null;
        if (!leadContact) throw new Error("parâmetro leadContact é obrigatório");
        const brief = await generateCloserBrief(soul.id, leadContact);
        return { ok: true, brief };
      }

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

      // Worktree Management Tools
      case "worktree_create": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
        const baseBranch = typeof args.baseBranch === "string" && args.baseBranch.trim() ? args.baseBranch.trim() : "main";
        if (!taskId) throw new Error("parâmetro taskId é obrigatório");
        return await createWorktree(taskId, baseBranch);
      }

      case "worktree_merge_locally": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
        const targetBranch = typeof args.targetBranch === "string" && args.targetBranch.trim() ? args.targetBranch.trim() : "main";
        if (!taskId) throw new Error("parâmetro taskId é obrigatório");
        return await mergeLocally(taskId, targetBranch);
      }

      case "worktree_destroy": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
        if (!taskId) throw new Error("parâmetro taskId é obrigatório");
        await destroyWorktree(taskId);
        return { ok: true };
      }

      case "worktree_list": {
        return { worktrees: await listWorktrees() };
      }

      case "mission_list": {
        return { missions: listMissions() };
      }

      case "skill_list": {
        const soulId =
          (typeof args.soul === "string" && args.soul.trim()) || process.env.AGENT_SOUL_ID || "main";
        if (!isValidSoulId(soulId)) throw new Error(`skill_list: soul inválida: ${soulId}`);
        const soul = getSoul(this.config.home, soulId);
        const allow = new Set(soul?.config.agent?.permissions?.skills ?? []);
        const discovered = scanSkillDirs(this.config.home, soulId);
        const skills = discovered.map((d) => {
          let description = "";
          let tools: string[] = [];
          try {
            const p = parseSkillFrontmatter(readFileSync(d.path, "utf8"));
            if (p.ok) {
              description = p.frontmatter.description;
              tools = p.frontmatter.tools;
            }
          } catch {
            /* arquivo ilegível — mantém description vazia */
          }
          return { name: d.name, description, scope: d.scope, tools, inAllowlist: allow.has(d.name) };
        });
        return { soul: soulId, skills };
      }

      case "skill_create": {
        this.authorizeAgentSoul(name); // efeito estrutural: L3
        const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
        const csv = (v: unknown): string[] =>
          str(v) ? str(v).split(",").map((x) => x.trim()).filter(Boolean) : [];
        const scope = str(args.scope) === "global" ? "global" : "soul";
        const soulId = str(args.soul) || process.env.AGENT_SOUL_ID || "main";
        if (scope === "soul" && !isValidSoulId(soulId)) throw new Error(`skill_create: soul inválida: ${soulId}`);
        const fm: SkillFrontmatter = {
          name: str(args.name),
          description: str(args.description),
          keywords: csv(args.keywords),
          tools: csv(args.tools),
        };
        const body = typeof args.body === "string" ? args.body : "";
        const md = buildSkillMd(fm, body);
        const parsed = parseSkillFrontmatter(md);
        const planHash = createHash("sha256")
          .update(canonicalJsonStringify({ fm, body, scope, soulId }))
          .digest("hex");
        const dryRun = args.dry_run !== false;
        const targetPath =
          scope === "soul"
            ? `souls/${soulId}/skills/${fm.name}/SKILL.md`
            : `skills/${fm.name}/SKILL.md`;
        if (dryRun) {
          return {
            dry_run: true,
            ok: parsed.ok,
            plan_hash: planHash,
            issues: parsed.ok ? [] : parsed.issues,
            would_write: targetPath,
          };
        }
        if (!parsed.ok) throw new Error(`skill_create: frontmatter inválido — ${parsed.issues.join("; ")}`);
        if (str(args.plan_hash) !== planHash) {
          throw new Error(`skill_create: plan_hash divergente (esperado ${planHash}). Rode dry_run novamente.`);
        }
        const r = writeSkillFile(this.config.home, scope, scope === "soul" ? soulId : undefined, fm, body);
        if (!r.ok) throw new Error(`skill_create: ${r.code} — ${r.reason}`);
        return { dry_run: false, created: true, path: r.path, plan_hash: planHash };
      }

      case "mission_run": {
        this.authorizeAgentSoul(name); // efeito externo: L3 pela política da soul chamadora
        const missionId = typeof args.mission_id === "string" && args.mission_id.trim() ? args.mission_id.trim() : null;
        if (!missionId) throw new Error("parâmetro mission_id é obrigatório");
        const soul = typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined;
        if (soul !== undefined && !isValidSoulId(soul)) throw new Error(`mission_run: soul inválida: ${soul}`);
        return await runMission(missionId, { soulOverride: soul });
      }

      case "soul_create": {
        this.authorizeAgentSoul(name); // efeito estrutural: L3 pela política da soul chamadora
        const spec = soulSpecFromWire(args);
        const existingIds = new Set(listSouls(this.config.home).map((s) => s.id));
        const validation = validateSoulSpec(spec, { existingIds });
        const resolved = resolveSoulSpecDefaults(spec, DEFAULT_GLOBAL_GUARDRAILS);
        const planHash = computePlanHash({
          schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
          catalogVersion: CAPABILITY_CATALOG_VERSION,
          spec: resolved,
          effectiveProvider: resolved.provider ?? "",
          effectiveModel: resolved.model ?? "",
        });
        const dryRun = args.dry_run !== false;
        if (dryRun) {
          return {
            dry_run: true,
            ok: validation.ok,
            plan_hash: planHash,
            issues: validation.issues,
            resolved_spec: resolved,
            would_create: [
              `souls/${spec.newId}/config.json`,
              `souls/${spec.newId}/{perfil,contexto,licoes,pessoas,soul}.md`,
              `souls/${spec.newId}/{sessoes,sources,decisoes}/`,
            ],
          };
        }
        if (!validation.ok) {
          throw new Error(`soul_create: spec inválida — ${validation.issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
        }
        const givenHash = typeof args.plan_hash === "string" ? args.plan_hash.trim() : "";
        if (givenHash !== planHash) {
          throw new Error(
            `soul_create: plan_hash divergente (esperado ${planHash}). Rode dry_run novamente e reenvie o hash — a spec mudou entre planejar e aplicar.`,
          );
        }
        const result = createSoulFromSpec(this.config.home, resolved);
        if (!result.created) {
          throw new Error(`soul_create: ${result.code} — ${result.reason}`);
        }
        return { dry_run: false, created: true, soul_id: spec.newId, plan_hash: planHash };
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
