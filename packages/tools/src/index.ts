#!/usr/bin/env node
import { loadConfig, listSouls, getSoul, getPool, runMigrations, sumCostBySoul, recentCalls, addAgendaItem, getAgendaItems, finishAgendaItem, anotar, registrarLicao, decidir, getAdoConnection, getAdoOrg, isToolAllowed, resolveAllowedTools, logFullAuditEntry, sanitizeLLMResponse, recordAgentIncident, getLessons, auditExecution, proposeRule, listPendingRules, approveRule, rejectRule, listActiveGoldenRules } from "@assistente-os/core";
import { indexDirectory, search, searchWithVerdict, indexStats, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder, LiteralEmbedder, relevancia, type RelevanceRule } from "@assistente-os/memory";
import { runOpenCode, browserNavigate, browserClick, browserExtractText, browserScreenshot, browserClose, getAccessibilityTree, captureAuditedScreenshot, executeDynamicFix, meetingIngestPipeline, generateCloserBrief, gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill, type GrillPlanResult } from "@assistente-os/daemon";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { EOL, tmpdir } from "node:os";
import { WebApi } from "azure-devops-node-api";
import { GitRepository, GitPullRequest, GitPullRequestSearchCriteria } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { TeamProjectReference } from "azure-devops-node-api/interfaces/CoreInterfaces.js";
import { WorkItem, WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";
import { BuildDefinitionReference } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";

export const SERVER_NAME = "assistente-os";
export const SERVER_VERSION = "0.1.0";

/** Gate de relevância configurável por env (default: modo "aviso"). */
export function relevanceRule(configHome: string): RelevanceRule {
  const modo = (process.env.ASSISTENTE_OS_RELEVANCE_MODO as RelevanceRule["modo"]) || ("aviso" as const);
  return {
    modo: ["recusar", "aviso", "libre"].includes(modo) ? modo : "aviso",
    min_score: Number(process.env.ASSISTENTE_OS_RELEVANCE_MIN_SCORE) || 0.35,
    min_term_matches: Number(process.env.ASSISTENTE_OS_RELEVANCE_MIN_TERMS) || 1,
  };
}

// ── Agent Authorization (Zero Trust Allowlist) ──────────────────────────

/** Tools que exigem soul_id e passam pela verificação de allowlist. */
const SOUL_SCOPED_TOOLS = new Set([
  "memory_search", "memory_index", "memory_status",
  "graph_list", "observation_add",
  "soul_context", "soul_chat",
  "soul_anotar", "soul_licao", "soul_decidir",
  "soul_record_lesson", "soul_get_lessons",
  "sales_ingest_meeting", "sales_get_lead_brief",
  "spec_grill_plan",
  "action_execute",
  "browser_navigate", "browser_click", "browser_extract_text",
  "browser_screenshot", "browser_close",
  "browser_get_accessibility_tree", "browser_execute_fix", "browser_audited_screenshot",
  "ado_list_projects", "ado_list_repositories", "ado_list_work_items",
  "ado_create_work_item", "ado_get_work_item", "ado_update_work_item",
  "ado_list_pipelines", "ado_run_pipeline",
  "ado_list_pull_requests", "ado_create_pull_request",
]);

/**
 * Verifica se a soul tem permissão para usar a tool.
 * Lança erro se negado; registra violação no audit trail.
 */
function authorizeTool(configHome: string, soulId: string, toolName: string): void {
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

interface Tool {
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
    name: "guardian_audit_execution",
    description: "Julga a qualidade de uma execução de agente via LLM (score 0-100, ISO/IEC 42001); aprova apenas com score >= 95.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "id da tarefa avaliada" },
        targetAgent: { type: "string", description: "id/nome do agente avaliado" },
        changesSummary: { type: "string", description: "resumo das mudanças feitas" },
        testResults: { type: "string", description: "resultado dos testes (opcional)" },
      },
      required: ["taskId", "targetAgent", "changesSummary"],
    },
  },
  {
    name: "guardian_promote_golden_rule",
    description: "Propõe manualmente uma regra de ouro (fora do gatilho automático de 3 reincidências). A proposta fica pendente em guardian_pending_rules até ser aprovada com guardian_approve_rule — nada é aplicado automaticamente.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "tópico normalizado da regra" },
        ruleText: { type: "string", description: "texto da regra proposta" },
        reason: { type: "string", description: "motivo/justificativa da proposta" },
      },
      required: ["topic", "ruleText", "reason"],
    },
  },
  {
    name: "guardian_pending_rules",
    description: "Lista propostas de regra de ouro aguardando aprovação ou rejeição humana.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "guardian_approve_rule",
    description: "Aprova uma proposta pendente: grava a regra em .opencode/rules/golden-rules.md, AGENTS.md e no índice ativo consumido pelo prompt de todas as souls.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da proposta pendente (ver guardian_pending_rules)" },
      },
      required: ["id"],
    },
  },
  {
    name: "guardian_reject_rule",
    description: "Rejeita uma proposta pendente: marca como decidida sem aplicar nem propagar nada.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id da proposta pendente (ver guardian_pending_rules)" },
      },
      required: ["id"],
    },
  },
  {
    name: "guardian_get_golden_rules",
    description: "Retorna a lista consolidada de regras de ouro já aprovadas e em vigor.",
    inputSchema: { type: "object", properties: {} },
  },
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
    description: "Lista itens da agenda por status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "filtro de status", enum: ["pending", "done", "all"], default: "pending" },
      },
    },
  },
  // Azure DevOps Tools
  {
    name: "ado_list_projects",
    description: "Lista todos os projetos da organização Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
      },
      required: ["soul"],
    },
  },
  {
    name: "ado_list_repositories",
    description: "Lista repositórios de um projeto Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_list_work_items",
    description: "Lista work items de um projeto (usa WIQL).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        wiql: { type: "string", description: "Query WIQL opcional" },
        top: { type: "number", description: "Limite de resultados", default: 50 },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_create_work_item",
    description: "Cria um work item no Azure DevOps.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        type: { type: "string", description: "Tipo do work item (ex: 'Bug', 'User Story', 'Task')", default: "Task" },
        title: { type: "string", description: "Título do work item" },
        description: { type: "string", description: "Descrição (Markdown)" },
        assignedTo: { type: "string", description: "Email do assignee" },
        tags: { type: "string", description: "Tags separadas por vírgula" },
        areaPath: { type: "string", description: "Area path" },
        iterationPath: { type: "string", description: "Iteration path" },
      },
      required: ["soul", "project", "title"],
    },
  },
  {
    name: "ado_get_work_item",
    description: "Obtém detalhes de um work item específico.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        id: { type: "number", description: "ID do work item" },
        project: { type: "string", description: "Nome ou ID do projeto (opcional)" },
      },
      required: ["soul", "id"],
    },
  },
  {
    name: "ado_update_work_item",
    description: "Atualiza campos de um work item.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        id: { type: "number", description: "ID do work item" },
        fields: { type: "object", description: "Campos a atualizar (ex: { 'System.State': 'Active', 'System.Title': 'Novo título' })" },
      },
      required: ["soul", "id", "fields"],
    },
  },
  {
    name: "ado_list_pipelines",
    description: "Lista pipelines de um projeto.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
      },
      required: ["soul", "project"],
    },
  },
  {
    name: "ado_run_pipeline",
    description: "Executa um pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        pipelineId: { type: "number", description: "ID do pipeline" },
        variables: { type: "object", description: "Variáveis do pipeline" },
        branch: { type: "string", description: "Branch para rodar (padrão: default)" },
      },
      required: ["soul", "project", "pipelineId"],
    },
  },
  {
    name: "ado_list_pull_requests",
    description: "Lista pull requests de um repositório.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        repositoryId: { type: "string", description: "Nome ou ID do repositório" },
        status: { type: "string", description: "Status: 'active', 'completed', 'abandoned', 'all'", default: "active" },
        top: { type: "number", description: "Limite de resultados", default: 50 },
      },
      required: ["soul", "project", "repositoryId"],
    },
  },
  {
    name: "ado_create_pull_request",
    description: "Cria um pull request.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "ID da soul que está executando a ação" },
        project: { type: "string", description: "Nome ou ID do projeto" },
        repositoryId: { type: "string", description: "Nome ou ID do repositório" },
        sourceRefName: { type: "string", description: "Branch de origem (ex: 'refs/heads/feature')" },
        targetRefName: { type: "string", description: "Branch de destino (ex: 'refs/heads/main')" },
        title: { type: "string", description: "Título do PR" },
        description: { type: "string", description: "Descrição do PR" },
        isDraft: { type: "boolean", description: "Se é draft", default: false },
        workItemIds: { type: "array", items: { type: "number" }, description: "IDs de work items para linkar" },
        reviewers: { type: "array", items: { type: "string" }, description: "Emails dos reviewers" },
      },
      required: ["soul", "project", "repositoryId", "sourceRefName", "targetRefName", "title"],
    },
  },
  // Browser Automation Tools (Flow OS)
  {
    name: "browser_navigate",
    description: "Abre uma URL em um navegador headless. Retorna título e status HTTP. Cada tarefa tem uma sessão isolada.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa para navegar" },
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_click",
    description: "Clica em um elemento CSS na página do navegador da tarefa.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Seletor CSS do elemento" },
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_extract_text",
    description: "Extrai texto estruturado da página. Use 'table' ou 'tables' para extrair tabelas como JSON/Markdown. Use 'body' ou omita para texto completo.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Seletor CSS ('body', 'table', 'tables', ou qualquer seletor)", default: "body" },
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Captura screenshot da página como PNG (base64). Útil para auditoria multimodal.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
        fullPage: { type: "boolean", description: "Screenshot da página inteira (default: false)", default: false },
      },
    },
  },
  {
    name: "browser_close",
    description: "Fecha a sessão do navegador da tarefa e libera recursos.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional)" },
      },
    },
  },
  {
    name: "browser_get_accessibility_tree",
    description: "Retorna a árvore de acessibilidade (AccessibilityNode) da página ativa — navegação semântica resiliente a variações de CSS/IDs.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
      },
    },
  },
  {
    name: "browser_execute_fix",
    description: "Injeta um trecho de JavaScript na página ativa para contornar um bloqueio (overlay, popup, z-index). Scripts bem-sucedidos ficam em cache e a estratégia é registrada em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa" },
        scriptContent: { type: "string", description: "código JavaScript a executar no contexto da página" },
        reason: { type: "string", description: "motivo/objetivo da injeção" },
      },
      required: ["taskId", "scriptContent", "reason"],
    },
  },
  {
    name: "browser_audited_screenshot",
    description: "Captura screenshot da página ativa com timestamp, hash SHA-256 e metadata para auditoria/relatórios.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID da tarefa (opcional, default: 'default')" },
        fullPage: { type: "boolean", description: "Screenshot da página inteira (default: false)", default: false },
        metadata: { type: "object", description: "metadata adicional a anexar ao registro de auditoria" },
      },
    },
  },
];

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

    const result = await this.executeTool(name, args);
    return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
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
        const n = await indexDirectory(pool, soul.id, join(this.config.home, "souls", soul.id), getEmbedder());
        return { indexed: n };
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

      case "guardian_audit_execution": {
        const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
        const targetAgent = typeof args.targetAgent === "string" && args.targetAgent.trim() ? args.targetAgent.trim() : null;
        const changesSummary = typeof args.changesSummary === "string" && args.changesSummary.trim() ? args.changesSummary.trim() : null;
        if (!taskId || !targetAgent || !changesSummary) {
          throw new Error("parâmetros taskId, targetAgent e changesSummary são obrigatórios");
        }
        const testResults = typeof args.testResults === "string" ? args.testResults : undefined;
        const result = await auditExecution({ taskId, targetAgent, changesSummary, testResults });
        return { ok: true, ...result };
      }

      case "guardian_promote_golden_rule": {
        const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
        const ruleText = typeof args.ruleText === "string" && args.ruleText.trim() ? args.ruleText.trim() : null;
        const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
        if (!topic || !ruleText || !reason) {
          throw new Error("parâmetros topic, ruleText e reason são obrigatórios");
        }
        const rule = proposeRule(this.config.home, topic, ruleText, reason);
        return { ok: true, rule };
      }

      case "guardian_pending_rules": {
        return { ok: true, pending: listPendingRules(this.config.home) };
      }

      case "guardian_approve_rule": {
        const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
        if (!id) throw new Error("parâmetro id é obrigatório");
        const repoRoot = process.env.ASSISTENTE_OS_REPO_ROOT || process.cwd();
        const rule = approveRule(this.config.home, repoRoot, id);
        return { ok: true, rule };
      }

      case "guardian_reject_rule": {
        const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : null;
        if (!id) throw new Error("parâmetro id é obrigatório");
        rejectRule(this.config.home, id);
        return { ok: true };
      }

      case "guardian_get_golden_rules": {
        return { ok: true, rules: listActiveGoldenRules(this.config.home) };
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
          const questions = await gerarPerguntasGrill(featureDraft);
          const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
          result = { ok: true, soulId: soul.id, questions, arquivo };
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
        return { items: await getAgendaItems(pool, status) };
      }

      // Azure DevOps Tools
      case "ado_list_projects": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const connection = await getAdoConnection(this.config);
        const coreApi = await connection.getCoreApi();
        const projects = await coreApi.getProjects();
        return projects.map((p: TeamProjectReference) => ({
          id: p.id,
          name: p.name,
          url: p.url,
          state: p.state,
          description: p.description,
          lastUpdateTime: p.lastUpdateTime,
        }));
      }

      case "ado_list_repositories": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        if (!project) throw new Error("parâmetro project é obrigatório");
        const connection = await getAdoConnection(this.config);
        const gitApi = await connection.getGitApi();
        const repos = await gitApi.getRepositories(project);
        return repos.map((r: GitRepository) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          project: r.project?.name,
          defaultBranch: r.defaultBranch,
          size: r.size,
          remoteUrl: r.remoteUrl,
        }));
      }

      case "ado_list_work_items": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        if (!project) throw new Error("parâmetro project é obrigatório");
        const wiql = typeof args.wiql === "string" ? args.wiql : null;
        const top = typeof args.top === "number" ? Math.min(200, Math.max(1, args.top)) : 50;
        const connection = await getAdoConnection(this.config);
        const witApi = await connection.getWorkItemTrackingApi();

        let query = wiql;
        if (!query) {
          query = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo], [System.Tags], [System.AreaPath], [System.IterationPath], [System.CreatedDate], [System.ChangedDate] FROM WorkItems WHERE [System.TeamProject] = '${project}' ORDER BY [System.ChangedDate] DESC`;
        }

        const result = await witApi.queryByWiql({ query }, { project }, undefined, top);
        if (!result.workItems || result.workItems.length === 0) return [];

        const ids = result.workItems.slice(0, top).map(wi => wi.id!);
        const workItems = await witApi.getWorkItems(ids, undefined, undefined, WorkItemExpand.All, undefined, project);
        return workItems.map((wi: WorkItem) => ({
          id: wi.id,
          title: wi.fields?.["System.Title"],
          state: wi.fields?.["System.State"],
          type: wi.fields?.["System.WorkItemType"],
          assignedTo: wi.fields?.["System.AssignedTo"]?.displayName || wi.fields?.["System.AssignedTo"]?.uniqueName,
          tags: wi.fields?.["System.Tags"],
          areaPath: wi.fields?.["System.AreaPath"],
          iterationPath: wi.fields?.["System.IterationPath"],
          createdDate: wi.fields?.["System.CreatedDate"],
          changedDate: wi.fields?.["System.ChangedDate"],
          url: wi.url,
        }));
      }

      case "ado_create_work_item": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        const type = typeof args.type === "string" ? args.type : "Task";
        const title = typeof args.title === "string" ? args.title : null;
        const description = typeof args.description === "string" ? args.description : "";
        const assignedTo = typeof args.assignedTo === "string" ? args.assignedTo : undefined;
        const tags = typeof args.tags === "string" ? args.tags : undefined;
        const areaPath = typeof args.areaPath === "string" ? args.areaPath : undefined;
        const iterationPath = typeof args.iterationPath === "string" ? args.iterationPath : undefined;

        if (!project || !title) throw new Error("project e title são obrigatórios");

        const connection = await getAdoConnection(this.config);
        const witApi = await connection.getWorkItemTrackingApi();

        const patchOps: { op: Operation; path: string; value: unknown }[] = [
          { op: Operation.Add, path: "/fields/System.Title", value: title },
        ];

        if (description) patchOps.push({ op: Operation.Add, path: "/fields/System.Description", value: description });
        if (assignedTo) patchOps.push({ op: Operation.Add, path: "/fields/System.AssignedTo", value: assignedTo });
        if (tags) patchOps.push({ op: Operation.Add, path: "/fields/System.Tags", value: tags });
        if (areaPath) patchOps.push({ op: Operation.Add, path: "/fields/System.AreaPath", value: areaPath });
        if (iterationPath) patchOps.push({ op: Operation.Add, path: "/fields/System.IterationPath", value: iterationPath });

        const workItem = await witApi.createWorkItem({}, patchOps, project, type);
        return {
          id: workItem.id,
          title: workItem.fields?.["System.Title"],
          state: workItem.fields?.["System.State"],
          type: workItem.fields?.["System.WorkItemType"],
          url: workItem.url,
        };
      }

      case "ado_get_work_item": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const id = typeof args.id === "number" ? args.id : null;
        const project = typeof args.project === "string" ? args.project : undefined;
        if (!id) throw new Error("parâmetro id é obrigatório");

        const connection = await getAdoConnection(this.config);
        const witApi = await connection.getWorkItemTrackingApi();
        const workItem = await witApi.getWorkItem(id, undefined, undefined, WorkItemExpand.All, project);

        return {
          id: workItem.id,
          title: workItem.fields?.["System.Title"],
          state: workItem.fields?.["System.State"],
          type: workItem.fields?.["System.WorkItemType"],
          assignedTo: workItem.fields?.["System.AssignedTo"]?.displayName || workItem.fields?.["System.AssignedTo"]?.uniqueName,
          description: workItem.fields?.["System.Description"],
          tags: workItem.fields?.["System.Tags"],
          areaPath: workItem.fields?.["System.AreaPath"],
          iterationPath: workItem.fields?.["System.IterationPath"],
          createdDate: workItem.fields?.["System.CreatedDate"],
          changedDate: workItem.fields?.["System.ChangedDate"],
          url: workItem.url,
        };
      }

      case "ado_update_work_item": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const id = typeof args.id === "number" ? args.id : null;
        const fields = args.fields as Record<string, unknown> | null;
        if (!id || !fields) throw new Error("id e fields são obrigatórios");

        const connection = await getAdoConnection(this.config);
        const witApi = await connection.getWorkItemTrackingApi();

        const patchOps: { op: Operation; path: string; value: unknown }[] = Object.entries(fields).map(([key, value]) => ({
          op: Operation.Add,
          path: key.startsWith("/") ? key : `/fields/${key}`,
          value,
        }));

        const workItem = await witApi.updateWorkItem(null, patchOps, id);
        return {
          id: workItem.id,
          title: workItem.fields?.["System.Title"],
          state: workItem.fields?.["System.State"],
          type: workItem.fields?.["System.WorkItemType"],
          url: workItem.url,
        };
      }

      case "ado_list_pipelines": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        if (!project) throw new Error("parâmetro project é obrigatório");

        const connection = await getAdoConnection(this.config);
        const buildApi = await connection.getBuildApi();
        const pipelines = await buildApi.getDefinitions(project);

        return pipelines.map((p: BuildDefinitionReference) => ({
          id: p.id,
          name: p.name,
          url: p.url,
          path: p.path,
          type: p.type,
          queueStatus: p.queueStatus,
          revision: p.revision,
        }));
      }

      case "ado_run_pipeline": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        const pipelineId = typeof args.pipelineId === "number" ? args.pipelineId : null;
        const variables = args.variables as Record<string, string> | undefined;
        const branch = typeof args.branch === "string" ? args.branch : undefined;

        if (!project || !pipelineId) throw new Error("project e pipelineId são obrigatórios");

        const connection = await getAdoConnection(this.config);
        const buildApi = await connection.getBuildApi();

        const buildParams: any = {
          definition: { id: pipelineId },
        };

        if (branch) buildParams.sourceBranch = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
        if (variables) buildParams.parameters = JSON.stringify(variables);

        const build = await buildApi.queueBuild(buildParams, project);
        return {
          id: build.id,
          buildNumber: build.buildNumber,
          status: build.status,
          result: build.result,
          url: build.url,
          queueTime: build.queueTime,
          startTime: build.startTime,
          finishTime: build.finishTime,
        };
      }

      case "ado_list_pull_requests": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        const repositoryId = typeof args.repositoryId === "string" ? args.repositoryId : null;
        const status = typeof args.status === "string" ? args.status : "active";
        const top = typeof args.top === "number" ? Math.min(100, Math.max(1, args.top)) : 50;

        if (!project || !repositoryId) throw new Error("project e repositoryId são obrigatórios");

        const connection = await getAdoConnection(this.config);
        const gitApi = await connection.getGitApi();

        const searchCriteria: GitPullRequestSearchCriteria = {
          status: status as any,
        };

        const prs = await gitApi.getPullRequests(repositoryId, searchCriteria, project, undefined, undefined, top);
        return prs.map((pr: GitPullRequest) => ({
          id: pr.pullRequestId,
          title: pr.title,
          description: pr.description,
          status: pr.status,
          sourceRefName: pr.sourceRefName,
          targetRefName: pr.targetRefName,
          createdBy: pr.createdBy?.displayName,
          createdDate: pr.creationDate,
          url: pr.url,
          isDraft: pr.isDraft,
          reviewers: pr.reviewers?.map(r => r.displayName),
          workItemRefs: pr.workItemRefs?.map(w => w.id),
        }));
      }

      case "ado_create_pull_request": {
        const soul = this.requireSoul(args.soul);
        if ("error" in soul) throw new Error(soul.error);
        authorizeTool(this.config.home, soul.id, name);
        const project = typeof args.project === "string" ? args.project : null;
        const repositoryId = typeof args.repositoryId === "string" ? args.repositoryId : null;
        const sourceRefName = typeof args.sourceRefName === "string" ? args.sourceRefName : null;
        const targetRefName = typeof args.targetRefName === "string" ? args.targetRefName : null;
        const title = typeof args.title === "string" ? args.title : null;
        const description = typeof args.description === "string" ? args.description : "";
        const isDraft = typeof args.isDraft === "boolean" ? args.isDraft : false;
        const workItemIds = Array.isArray(args.workItemIds) ? args.workItemIds : [];
        const reviewers = Array.isArray(args.reviewers) ? args.reviewers : [];

        if (!project || !repositoryId || !sourceRefName || !targetRefName || !title) {
          throw new Error("project, repositoryId, sourceRefName, targetRefName e title são obrigatórios");
        }

        const connection = await getAdoConnection(this.config);
        const gitApi = await connection.getGitApi();

        const pr = await gitApi.createPullRequest(
          {
            sourceRefName,
            targetRefName,
            title,
            description,
            isDraft,
            reviewers: reviewers.map(email => ({ reviewerUrl: undefined, displayName: email, uniqueName: email })),
            workItemRefs: workItemIds.map(id => ({ id })),
          },
          repositoryId,
          project
        );

        return {
          id: pr.pullRequestId,
          title: pr.title,
          description: pr.description,
          status: pr.status,
          sourceRefName: pr.sourceRefName,
          targetRefName: pr.targetRefName,
          createdBy: pr.createdBy?.displayName,
          createdDate: pr.creationDate,
          url: pr.url,
          isDraft: pr.isDraft,
        };
      }

      // Browser Automation Tools (Flow OS)
      case "browser_navigate": {
        const url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : null;
        if (!url) throw new Error("parâmetro url é obrigatório");
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        this.authorizeAgentSoul(name);
        return await browserNavigate(url, taskId);
      }

      case "browser_click": {
        const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : null;
        if (!selector) throw new Error("parâmetro selector é obrigatório");
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        this.authorizeAgentSoul(name);
        return await browserClick(selector, taskId);
      }

      case "browser_extract_text": {
        const selector = typeof args.selector === "string" ? args.selector.trim() : "body";
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        this.authorizeAgentSoul(name);
        return await browserExtractText(selector, taskId);
      }

      case "browser_screenshot": {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        const fullPage = typeof args.fullPage === "boolean" ? args.fullPage : false;
        this.authorizeAgentSoul(name);
        return await browserScreenshot(taskId, fullPage);
      }

      case "browser_close": {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        this.authorizeAgentSoul(name);
        return await browserClose(taskId);
      }

      case "browser_get_accessibility_tree": {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        this.authorizeAgentSoul(name);
        return await getAccessibilityTree(taskId);
      }

      case "browser_execute_fix": {
        const taskId = typeof args.taskId === "string" && args.taskId.trim() ? args.taskId.trim() : null;
        const scriptContent = typeof args.scriptContent === "string" && args.scriptContent.trim() ? args.scriptContent.trim() : null;
        const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
        if (!taskId || !scriptContent || !reason) {
          throw new Error("parâmetros taskId, scriptContent e reason são obrigatórios");
        }
        this.authorizeAgentSoul(name);
        return await executeDynamicFix(taskId, scriptContent, reason);
      }

      case "browser_audited_screenshot": {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "default";
        const fullPage = typeof args.fullPage === "boolean" ? args.fullPage : false;
        const metadata = args.metadata && typeof args.metadata === "object" ? args.metadata as Record<string, unknown> : undefined;
        this.authorizeAgentSoul(name);
        return await captureAuditedScreenshot(taskId, metadata, fullPage);
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
