import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, listSouls } from "@assistente-os/core";
import type { RequestContext } from "./shared.js";

/**
 * Catálogo estático das MCP tools expostas em packages/tools — duplicado
 * aqui de propósito (não importado de @assistente-os/tools) pra evitar
 * dependência circular tools→daemon. Mantenha em sincronia com o array
 * TOOLS de packages/tools/src/index.ts ao adicionar/remover tools.
 */
const MCP_TOOLS_CATALOG: Array<{ name: string; description: string }> = [
  { name: "souls_list", description: "Lista as souls disponíveis no Assistente OS." },
  { name: "soul_context", description: "Retorna o contexto (perfil/contexto/licoes/pessoas/soul.md) de uma soul." },
  { name: "soul_chat", description: "Roda opencode run headless na soul. Retorna o texto gerado." },
  { name: "memory_search", description: "Busca RAG na memória da soul (semântica com Ollama; degrada para literal)." },
  { name: "memory_index", description: "Indexa (idempotente) a pasta da soul no memory.db." },
  { name: "memory_status", description: "Contagem de chunks e grafo (entidades/relações/observações) da soul." },
  { name: "graph_list", description: "Lista entidades, relações e observações do grafo da soul." },
  { name: "costs_summary", description: "Resumo de custos por soul e últimas chamadas do kernel.db." },
  { name: "router_status", description: "Degraus do roteador e config do Ollama." },
  { name: "observation_add", description: "Adiciona uma observação ao grafo da soul." },
  { name: "action_execute", description: "Executa uma ação registrada na agenda ou dispara um fluxo de trabalho." },
  { name: "soul_anotar", description: "Anota um item cronológico na sessão do dia da soul. Idempotente na data." },
  { name: "soul_licao", description: "Registra uma lição aprendida em licoes.md da soul." },
  { name: "soul_decidir", description: "Grava uma decisão no formato ADR em decisoes/<data>-<slug>.md da soul." },
  { name: "soul_record_lesson", description: "Registra um incidente de agente (erro + causa raiz + regra corretiva); após 3 reincidências, propõe regra global." },
  { name: "soul_get_lessons", description: "Retorna as últimas lições registradas em licoes.md da soul." },
  { name: "guardian_audit_execution", description: "Julga a qualidade de uma execução de agente via LLM (score 0-100, ISO/IEC 42001)." },
  { name: "guardian_promote_golden_rule", description: "Propõe manualmente uma regra de ouro, pendente de aprovação humana." },
  { name: "guardian_pending_rules", description: "Lista propostas de regra de ouro aguardando aprovação ou rejeição." },
  { name: "guardian_approve_rule", description: "Aprova uma proposta pendente de regra de ouro." },
  { name: "guardian_reject_rule", description: "Rejeita uma proposta pendente de regra de ouro." },
  { name: "guardian_get_golden_rules", description: "Retorna a lista consolidada de regras de ouro em vigor." },
  { name: "sales_ingest_meeting", description: "Ingere uma transcrição de reunião (vtt/srt/txt), extrai decisões/ações/objeções via LLM local." },
  { name: "sales_get_lead_brief", description: "Gera um dossiê pré-call a partir do histórico de reuniões já ingeridas da soul." },
  { name: "spec_grill_plan", description: "Refina requisitos em duas fases (perguntas → respostas) antes de autorizar o modo build." },
  { name: "agenda_add", description: "Agenda uma tarefa para o daemon despachar." },
  { name: "agenda_list", description: "Lista itens da agenda por status." },
  { name: "ado_list_projects", description: "Lista projetos da organização Azure DevOps." },
  { name: "ado_list_repositories", description: "Lista repositórios de um projeto Azure DevOps." },
  { name: "ado_list_work_items", description: "Lista work items de um projeto (WIQL)." },
  { name: "ado_create_work_item", description: "Cria um work item no Azure DevOps." },
  { name: "ado_get_work_item", description: "Obtém detalhes de um work item específico." },
  { name: "ado_update_work_item", description: "Atualiza campos de um work item." },
  { name: "ado_list_pipelines", description: "Lista pipelines de um projeto." },
  { name: "ado_run_pipeline", description: "Executa um pipeline." },
  { name: "ado_list_pull_requests", description: "Lista pull requests de um repositório." },
  { name: "ado_create_pull_request", description: "Cria um pull request." },
  { name: "browser_navigate", description: "Abre uma URL em um navegador headless (sessão isolada por tarefa)." },
  { name: "browser_click", description: "Clica em um elemento CSS na página do navegador da tarefa." },
  { name: "browser_extract_text", description: "Extrai texto/tabelas estruturados da página." },
  { name: "browser_screenshot", description: "Captura screenshot da página como PNG (base64)." },
  { name: "browser_close", description: "Fecha a sessão do navegador da tarefa." },
  { name: "browser_get_accessibility_tree", description: "Retorna a árvore de acessibilidade da página ativa." },
  { name: "browser_execute_fix", description: "Injeta JavaScript na página ativa pra contornar um bloqueio." },
  { name: "browser_audited_screenshot", description: "Captura screenshot com timestamp, hash SHA-256 e metadata de auditoria." },
];

/** Lista estática das rotas REST ativas, agrupadas por domínio (ver packages/daemon/src/routes/*.ts). */
const ROUTES_CATALOG: Array<{ method: string; path: string; description: string }> = [
  { method: "GET", path: "/health", description: "Health check (público, sem token)" },
  { method: "GET", path: "/llms.txt", description: "Este catálogo, para ingestão por agentes externos" },
  { method: "GET", path: "/souls", description: "Lista todas as souls" },
  { method: "GET", path: "/souls/:id", description: "Detalhe de uma soul" },
  { method: "GET", path: "/souls/:id/context", description: "Contexto concatenado da soul" },
  { method: "GET", path: "/souls/:id/buffer", description: "Inspeciona o prompt/contexto montado (RAG incluso)" },
  { method: "POST", path: "/souls/:id/chat", description: "Chat com a soul (tier: local/zen/soul/langgraph)" },
  { method: "GET", path: "/souls/:id/langgraph/status", description: "Status do agente LangGraph" },
  { method: "GET", path: "/memory/status", description: "Stats de memória (chunks + grafo)" },
  { method: "POST", path: "/memory/search", description: "Busca RAG com gate de relevância" },
  { method: "GET", path: "/graph/:soulId", description: "Grafo (entidades/relações/observações) da soul" },
  { method: "GET", path: "/costs", description: "Resumo de custos por soul" },
  { method: "GET", path: "/router/status", description: "Degraus do roteador e config do Ollama" },
  { method: "GET", path: "/agenda", description: "Lista itens da agenda (?status=pending/done/all)" },
  { method: "POST", path: "/agenda", description: "Adiciona item na agenda" },
  { method: "GET", path: "/events", description: "Lista eventos" },
  { method: "POST", path: "/events", description: "Recebe evento (assinado por HMAC)" },
  { method: "GET", path: "/monitors", description: "Lista monitores de site" },
  { method: "POST", path: "/monitors", description: "Cria monitor de site" },
  { method: "GET", path: "/infra/status", description: "Snapshot de saúde (Ollama, Postgres, sistema, RAG)" },
  { method: "GET", path: "/api/whatsapp/status", description: "Status do canal WhatsApp" },
  { method: "GET", path: "/api/telegram/status", description: "Status do canal Telegram" },
  { method: "WS", path: "/", description: "WebSocket de eventos em tempo real (token via ?token=)" },
];

function buildLlmsTxt(home: string): string {
  const souls = listSouls(home);
  const lines: string[] = [
    "# Assistente OS",
    "",
    "Copiloto residente API-first, local-first. Cada \"soul\" é um perfil vivo de",
    "conhecimento (markdown canônico + RAG derivado em pgvector). Este documento",
    "é gerado dinamicamente para ingestão headless por agentes externos.",
    "",
    "## Rotas ativas",
    "",
    ...ROUTES_CATALOG.map((r) => `- \`${r.method} ${r.path}\` — ${r.description}`),
    "",
    "## Catálogo de MCP Tools",
    "",
    ...MCP_TOOLS_CATALOG.map((t) => `- **${t.name}**: ${t.description}`),
    "",
    "## Souls registradas",
    "",
    ...(souls.length
      ? souls.map((s) => `- \`${s.id}\`${s.config.description ? ` — ${s.config.description}` : ""}`)
      : ["_nenhuma soul registrada_"]),
    "",
    "## Autenticação",
    "",
    "Todas as rotas exigem `Authorization: Bearer <ASSISTENTE_OS_DAEMON_TOKEN>`,",
    "exceto `/health`. O WebSocket aceita o token via `?token=` na URL de conexão",
    "(o handshake do browser não permite headers customizados).",
    "",
  ];
  return lines.join("\n");
}

/** GET /llms.txt — catálogo do sistema (rotas, tools MCP, souls) para ingestão headless por agentes externos. */
export async function handleLlmsTxt(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || path !== "/llms.txt") return false;

  const config = loadConfig({ home: context.home });
  const body = buildLlmsTxt(config.home);
  res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
  res.end(body);
  return true;
}
