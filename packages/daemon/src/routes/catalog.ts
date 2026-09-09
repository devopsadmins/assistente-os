/**
 * Fonte única de verdade do contrato HTTP do daemon (Fase 0 do plano
 * "assistente-os como engine headless", docs/ENGINE-API.md).
 *
 * Antes desta tabela, `routes/llms-txt.ts` mantinha DUAS listas divergentes e
 * incompletas à mão (`ROUTES_CATALOG` e a cópia dentro de `handleCapabilities`,
 * essa última com `mcpTools: []` só como stub). `GET /llms.txt`,
 * `GET /api/capabilities` e `GET /api/openapi.json` agora derivam todos daqui.
 *
 * Ao ADICIONAR/REMOVER/RENOMEAR uma rota em `routes/*.ts`, atualize
 * `REST_ROUTES` no mesmo commit — `catalog-routes-exist.test.ts` falha se uma
 * rota GET montada não estiver catalogada (e vice-versa).
 */

import { TOOLS, TOOL_FAMILIES } from "../mcp/kernel.js";

/** Versão do contrato/servidor exposta em /llms.txt, /api/capabilities e /api/openapi.json. */
export const SERVER_VERSION = "0.1.0";

/** Como o cliente se autentica na rota. Ver o gate central em `server.ts`. */
export type RouteAuth =
  | "public" // sem credencial (/health, /metrics, signup/login)
  | "token" // token admin OU sessão de conta (Bearer)
  | "account" // só sessão de conta (self-service)
  | "admin" // só token admin (getRequestAccountId(req) == null)
  | "hmac" // assinatura HMAC no corpo (webhooks/eventos)
  | "query-token"; // token via ?token= (handshake WebSocket)

export interface RestRoute {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "WS";
  /** Caminho com placeholders `:param` — casa com o pattern-match do handler. */
  path: string;
  domain: string;
  auth: RouteAuth;
  description: string;
  /** true = resposta é `text/event-stream` (SSE), não JSON. */
  streaming?: boolean;
  /** true = verbo operacional espelhado da CLI `os` (Fase 3). */
  operational?: boolean;
}

export const REST_ROUTES: readonly RestRoute[] = [
  // ── Infra / saúde ────────────────────────────────────────────────────────
  { method: "GET", path: "/health", domain: "infra", auth: "public", description: "Liveness. Não expõe a lista de souls." },
  { method: "GET", path: "/metrics", domain: "infra", auth: "token", description: "Métricas Prometheus (fora do rate-limit; exige token quando configurado)." },
  { method: "GET", path: "/infra/status", domain: "infra", auth: "token", description: "Snapshot de saúde (Ollama, Postgres, sistema, RAG)." },
  { method: "GET", path: "/telemetry/backfill-status", domain: "infra", auth: "token", description: "Progresso do backfill de extração de entidades." },
  { method: "GET", path: "/trace/:traceId", domain: "infra", auth: "token", description: "Linha canônica + spans por estágio de um trace de chat, em ordem.", operational: true },

  // ── Contrato / descoberta ────────────────────────────────────────────────
  { method: "GET", path: "/llms.txt", domain: "contract", auth: "token", description: "Catálogo do sistema em markdown para ingestão headless. (Fase 1: candidato a público.)" },
  { method: "GET", path: "/api/capabilities", domain: "contract", auth: "token", description: "Capacidades consolidadas (rotas, tools MCP, eventos, erros) em JSON. (Fase 1: candidato a público.)" },
  { method: "GET", path: "/api/openapi.json", domain: "contract", auth: "token", description: "Especificação OpenAPI 3.1 gerada de REST_ROUTES. (Fase 1: candidato a público.)" },
  { method: "GET", path: "/api/manifest", domain: "contract", auth: "token", description: "Manifesto de capabilities/connectors declarados por soul." },

  // ── Souls: identidade e consulta ─────────────────────────────────────────
  { method: "GET", path: "/souls", domain: "souls", auth: "token", description: "Lista souls (escopo da conta quando autenticado por sessão)." },
  { method: "GET", path: "/souls/:id", domain: "souls", auth: "token", description: "Detalhe de uma soul (config completa)." },
  { method: "GET", path: "/souls/:id/context", domain: "souls", auth: "token", description: "perfil/contexto/licoes/pessoas/soul.md concatenados." },
  { method: "GET", path: "/souls/:id/buffer", domain: "souls", auth: "token", description: "Prompt/contexto montado para inspeção (RAG incluso)." },
  { method: "GET", path: "/souls/:id/health", domain: "souls", auth: "token", description: "Saúde de indexação/memória da soul." },
  { method: "GET", path: "/sessions/stats", domain: "souls", auth: "token", description: "Total de sessões de chat registradas." },
  { method: "GET", path: "/router/status", domain: "souls", auth: "token", description: "Degraus do roteador e config do Ollama." },

  // ── Chat / execução ─────────────────────────────────────────────────────
  { method: "POST", path: "/souls/:id/chat", domain: "chat", auth: "token", description: "Chat com a soul. mode fast|pro; tier local|zen|soul|langgraph. Resposta JSON bufferizada." },
  { method: "GET", path: "/souls/:id/langgraph/status", domain: "chat", auth: "token", description: "Estado do agente LangGraph da soul." },
  { method: "GET", path: "/souls/:id/threads", domain: "chat", auth: "token", description: "Lista threads de conversa da soul." },
  { method: "POST", path: "/souls/:id/threads", domain: "chat", auth: "token", description: "Cria uma thread de conversa." },
  { method: "PATCH", path: "/souls/:id/threads/:threadId", domain: "chat", auth: "token", description: "Renomeia uma thread." },
  { method: "DELETE", path: "/souls/:id/threads/:threadId", domain: "chat", auth: "token", description: "Apaga uma thread e suas mensagens." },
  { method: "GET", path: "/souls/:id/threads/:threadId/messages", domain: "chat", auth: "token", description: "Histórico de mensagens da thread." },
  { method: "POST", path: "/souls/:id/threads/:threadId/messages/stream", domain: "chat", auth: "token", streaming: true, description: "Envia mensagem e faz stream da resposta via SSE (step/token/done/error, heartbeat 15s)." },

  // ── Memória / RAG / grafo ───────────────────────────────────────────────
  { method: "GET", path: "/souls/:id/memory/status", domain: "memory", auth: "token", description: "Contagem de chunks + grafo (entidades/relações/observações)." },
  { method: "POST", path: "/souls/:id/memory/search", domain: "memory", auth: "token", description: "Busca RAG com gate de relevância (evidência insuficiente → recusa)." },
  { method: "POST", path: "/souls/:id/upload", domain: "memory", auth: "token", description: "Upload de fonte de conhecimento (PDF/DOCX/XLSX extraídos p/ sidecar .md). Teto em KB por conta." },
  { method: "POST", path: "/souls/:id/limpar", domain: "memory", auth: "token", description: "Zera o índice RAG da soul." },
  { method: "GET", path: "/souls/:id/graph", domain: "memory", auth: "token", description: "Grafo de conhecimento da soul." },
  { method: "POST", path: "/souls/:id/graph/observation", domain: "memory", auth: "token", description: "Adiciona uma observação a uma entidade do grafo." },

  // ── Alma-base (journaling) ──────────────────────────────────────────────
  { method: "POST", path: "/souls/:id/anotar", domain: "journal", auth: "token", description: "Anota item cronológico na sessão do dia. Idempotente na data." },
  { method: "POST", path: "/souls/:id/licao", domain: "journal", auth: "token", description: "Registra lição aprendida em licoes.md." },
  { method: "POST", path: "/souls/:id/decidir", domain: "journal", auth: "token", description: "Grava decisão no formato ADR em decisoes/<data>-<slug>.md." },

  // ── Agenda ─────────────────────────────────────────────────────────────
  { method: "GET", path: "/agenda", domain: "agenda", auth: "token", description: "Lista itens da agenda (?status=pending|done|all)." },
  { method: "POST", path: "/agenda", domain: "agenda", auth: "token", description: "Adiciona item na agenda." },
  { method: "PATCH", path: "/agenda/:id", domain: "agenda", auth: "token", description: "Edita título/corpo/prazo de item pending." },
  { method: "POST", path: "/agenda/:id/cancel", domain: "agenda", auth: "token", description: "Cancela (soft) item pending." },

  // ── Eventos / monitores / missões / pipelines ──────────────────────────
  { method: "GET", path: "/events", domain: "events", auth: "token", description: "Lista eventos recebidos." },
  { method: "POST", path: "/events", domain: "events", auth: "hmac", description: "Recebe evento assinado por HMAC." },
  { method: "GET", path: "/monitors", domain: "monitors", auth: "token", description: "Lista monitores de site." },
  { method: "POST", path: "/monitors", domain: "monitors", auth: "token", description: "Cria monitor de site." },
  { method: "POST", path: "/monitors/check", domain: "monitors", auth: "token", description: "Força verificação imediata dos monitores." },
  { method: "DELETE", path: "/monitors/:id", domain: "monitors", auth: "token", description: "Remove um monitor." },
  { method: "GET", path: "/api/missions", domain: "missions", auth: "token", description: "Lista missões compostas disponíveis no Mission Runner." },
  { method: "POST", path: "/api/missions/:mission/run", domain: "missions", auth: "token", description: "Executa uma missão composta." },
  { method: "POST", path: "/api/pipelines/email-ingest", domain: "pipelines", auth: "token", description: "Ingestão de e-mail → extração de decisões → atualização de contexto." },
  { method: "POST", path: "/api/pipelines/meeting-ingest", domain: "pipelines", auth: "token", description: "Ingestão de reunião → RAG + follow-up + auditoria Guardian." },

  // ── Custos ─────────────────────────────────────────────────────────────
  { method: "GET", path: "/costs", domain: "costs", auth: "token", description: "Resumo de custo por soul + últimas chamadas." },
  { method: "GET", path: "/api/costs/usage", domain: "costs", auth: "token", description: "Sumário de uso/custo agregado (FinOps)." },

  // ── Voz ────────────────────────────────────────────────────────────────
  { method: "POST", path: "/voice/start", domain: "voice", auth: "token", description: "Inicia a sessão de voz (VAD + Whisper + TTS)." },
  { method: "POST", path: "/voice/stop", domain: "voice", auth: "token", description: "Encerra a sessão de voz." },
  { method: "GET", path: "/voice/status", domain: "voice", auth: "token", description: "Estado atual da sessão de voz." },

  // ── Worktree ───────────────────────────────────────────────────────────
  { method: "GET", path: "/api/worktree", domain: "worktree", auth: "token", description: "Lista worktrees git gerenciados." },
  { method: "POST", path: "/api/worktree", domain: "worktree", auth: "token", description: "Cria um worktree." },
  { method: "POST", path: "/api/worktree/:name/merge", domain: "worktree", auth: "token", description: "Faz merge local de um worktree." },
  { method: "DELETE", path: "/api/worktree/:name", domain: "worktree", auth: "token", description: "Destrói um worktree." },

  // ── Canais: WhatsApp / Telegram ────────────────────────────────────────
  { method: "GET", path: "/api/whatsapp/status", domain: "channels", auth: "token", description: "Estado do canal WhatsApp." },
  { method: "GET", path: "/api/whatsapp/messages", domain: "channels", auth: "token", description: "Mensagens recentes do WhatsApp." },
  { method: "POST", path: "/api/whatsapp/send", domain: "channels", auth: "token", description: "Envia mensagem pelo WhatsApp." },
  { method: "GET", path: "/api/whatsapp/media/:id", domain: "channels", auth: "token", description: "Baixa mídia de uma mensagem do WhatsApp." },
  { method: "POST", path: "/api/whatsapp/transcribe", domain: "channels", auth: "token", description: "Transcreve um áudio do WhatsApp." },
  { method: "POST", path: "/api/webhooks/whatsapp", domain: "channels", auth: "hmac", description: "Webhook de entrada do WhatsApp." },
  { method: "POST", path: "/api/webhooks/whatsapp/approve", domain: "channels", auth: "hmac", description: "Aprova uma resposta pendente do WhatsApp." },
  { method: "GET", path: "/api/telegram/status", domain: "channels", auth: "token", description: "Estado do canal Telegram." },
  { method: "GET", path: "/api/telegram/messages", domain: "channels", auth: "token", description: "Mensagens recentes do Telegram." },
  { method: "POST", path: "/api/telegram/send", domain: "channels", auth: "token", description: "Envia mensagem pelo Telegram." },

  // ── Famílias (Modo Convivência / LGPD) ─────────────────────────────────
  { method: "GET", path: "/familias", domain: "familias", auth: "admin", description: "Lista famílias (souls familia_<telefone>). Sem modelo de dono self-service — admin-only." },
  { method: "POST", path: "/familias", domain: "familias", auth: "admin", description: "Cria uma família." },
  { method: "GET", path: "/familias/:id", domain: "familias", auth: "admin", description: "Detalhe de uma família." },
  { method: "DELETE", path: "/familias/:id", domain: "familias", auth: "admin", description: "Exclui uma família (direito ao apagamento, LGPD)." },
  { method: "POST", path: "/familias/:id/encerrar", domain: "familias", auth: "admin", description: "Encerra o vínculo de uma família." },
  { method: "GET", path: "/familias/:id/onboarding", domain: "familias", auth: "admin", description: "Estado do onboarding da família." },

  // ── Contas self-service (Modo Amigável) ────────────────────────────────
  { method: "POST", path: "/auth/signup", domain: "accounts", auth: "public", description: "Cria conta (e-mail/senha scrypt) e devolve sessão." },
  { method: "POST", path: "/auth/login", domain: "accounts", auth: "public", description: "Autentica e devolve sessão de 30 dias." },
  { method: "POST", path: "/auth/logout", domain: "accounts", auth: "account", description: "Revoga a sessão atual." },
  { method: "GET", path: "/auth/me", domain: "accounts", auth: "account", description: "Conta e plano da sessão atual." },
  { method: "POST", path: "/accounts/me/souls", domain: "accounts", auth: "account", description: "Cria soul self-service (grants dentro da allowlist; modelo dentro do plano)." },
  { method: "GET", path: "/accounts/me/souls/:id", domain: "accounts", auth: "account", description: "Config editável de uma soul da conta." },
  { method: "PATCH", path: "/accounts/me/souls/:id", domain: "accounts", auth: "account", description: "Edita description/perfil/contexto/guardrails (re-clampados no teto global)." },
  { method: "GET", path: "/accounts/me/available-capabilities", domain: "accounts", auth: "account", description: "Interseção do catálogo com a allowlist do Modo Amigável." },
  { method: "GET", path: "/accounts/me/available-models", domain: "accounts", auth: "account", description: "Modelos liberados pelo plano da conta ([] = sem restrição)." },

  // ── Administração (só token admin) ─────────────────────────────────────
  { method: "GET", path: "/admin/plans", domain: "admin", auth: "admin", description: "Catálogo de planos (modelos permitidos + teto diário agregado)." },
  { method: "PUT", path: "/admin/plans", domain: "admin", auth: "admin", description: "Substitui o catálogo de planos." },
  { method: "PATCH", path: "/admin/accounts/plan", domain: "admin", auth: "admin", description: "Atribui um plano a uma conta por e-mail." },
  { method: "GET", path: "/admin/friendly-allowlist", domain: "admin", auth: "admin", description: "Allowlist global de capabilities/skills do Modo Amigável." },
  { method: "PUT", path: "/admin/friendly-allowlist", domain: "admin", auth: "admin", description: "Substitui a allowlist do Modo Amigável." },
  { method: "GET", path: "/admin/api-keys", domain: "admin", auth: "admin", description: "Lista as chaves de API com escopo (sem o segredo em claro)." },
  { method: "POST", path: "/admin/api-keys", domain: "admin", auth: "admin", description: "Cria uma chave de API com escopo; devolve o segredo em claro uma única vez." },
  { method: "DELETE", path: "/admin/api-keys", domain: "admin", auth: "admin", description: "Revoga uma chave por keyHash (query ?keyHash= ou corpo)." },
  { method: "POST", path: "/admin/backup", domain: "admin", auth: "admin", description: "Backup completo (souls/ + dump do Postgres) num ZIP em backupDir; aplica a retenção de 7 dias.", operational: true },
  { method: "POST", path: "/admin/discriminator", domain: "admin", auth: "admin", description: "Gate SPEC-GR4: julga um changesSummary (commits/stat/diff, calculado pelo cliente) via Guardian.", operational: true },

  // ── MCP sobre HTTP (Fase 2) ─────────────────────────────────────────────
  { method: "POST", path: "/mcp", domain: "mcp", auth: "admin", description: "JSON-RPC 2.0 pro kernel MCP (as 65 tools de MCP_TOOL_CATALOG). Admin-only — sem ownership por conta no kernel; app cliente usa chave de API de serviço com escopo mcp/mcp:<família>." },

  // ── Tempo real ────────────────────────────────────────────────────────
  { method: "WS", path: "/", domain: "realtime", auth: "query-token", description: "WebSocket de eventos em tempo real. Token via ?token=. Eventos escopados por conta." },
] as const;

/** Converte `/souls/:id/threads/:threadId` num regex que casa o path real. */
function routeToRegex(routePath: string): RegExp {
  const escaped = routePath
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}/?$`);
}

const ROUTE_MATCHERS: { re: RegExp; route: RestRoute }[] = REST_ROUTES.filter((r) => r.method !== "WS").map((route) => ({
  re: routeToRegex(route.path),
  route,
}));

/**
 * Resolve `(method, path)` para a rota catalogada, ou `undefined` se nenhuma
 * casa. Usado pelo gate de `server.ts` para descobrir o `domain` de uma
 * requisição e checar o escopo da chave de API. Rotas não catalogadas caem
 * fora do controle de escopo (só o gate de token/conta as protege) — por isso
 * o teste de integridade exige o catálogo completo.
 */
export function matchRoute(method: string, path: string): RestRoute | undefined {
  const m = method.toUpperCase();
  for (const { re, route } of ROUTE_MATCHERS) {
    if (route.method === m && re.test(path)) return route;
  }
  return undefined;
}

/** Eventos SSE emitidos por `POST .../messages/stream` (ver `routes/sse.ts`). */
export const SSE_EVENTS: readonly { type: string; description: string }[] = [
  { type: "step", description: "Passo do pipeline (retrieve/rerank/generate/tools/…)." },
  { type: "token", description: "Fragmento incremental do texto da resposta." },
  { type: "done", description: "Fim do stream: messageId, usage {promptTokens, completionTokens, source}, sources[]." },
  { type: "error", description: "Falha durante a geração; encerra o stream." },
] as const;

/**
 * Tipos de evento do hub WebSocket (`server.ts` `WsHub.broadcast`). Eventos com
 * `scope.accountId` só chegam ao cliente daquela conta; os sistêmicos (voz,
 * monitor, agenda, canais, missão) vão só para o cliente do token admin.
 */
export const WS_EVENT_TYPES: readonly string[] = [
  "chat.step",
  "chat.done",
  "graph.step",
  "index.done",
  "upload.done",
  "entity_extraction.processed",
  "mission.step",
  "agenda.added",
  "agenda.cancelled",
  "agenda.processed",
  "event.received",
  "event.processed",
  "monitor.added",
  "monitor.updated",
  "monitor.deleted",
  "voice.ready",
  "voice.transcribing",
  "voice.transcribed",
  "voice.responding",
  "voice.spoken",
  "voice.speech-detected",
  "voice.speech-ended",
  "voice.error",
  "voice.stopped",
  "whatsapp.connected",
  "whatsapp.disconnected",
  "whatsapp.qr",
  "whatsapp.pairing_code",
  "whatsapp.message",
  "whatsapp.error",
  "telegram.connected",
  "telegram.disconnected",
  "telegram.message",
] as const;

/** Códigos de erro estáveis (`AssistenteOsError`) e o status HTTP correspondente. */
export const ERROR_CODES: readonly { code: string; httpStatus: number; description: string }[] = [
  { code: "E_AUTHZ", httpStatus: 403, description: "Credencial/escopo insuficiente para a operação." },
  { code: "E_CONNECTOR", httpStatus: 502, description: "Falha num conector externo (provider, ADO, browser…)." },
  { code: "E_BUDGET", httpStatus: 429, description: "Teto de gasto (soul ou conta) atingido." },
  { code: "E_STALE_HASH", httpStatus: 409, description: "plan_hash desatualizado — releia antes de reenviar (fluxo dry_run→commit)." },
  { code: "E_VALIDATION", httpStatus: 400, description: "Corpo/parâmetros inválidos ou fora de allowlist." },
  { code: "E_CONFLICT", httpStatus: 409, description: "Conflito de estado (recurso já existe / mudou)." },
  { code: "E_INDEX", httpStatus: 500, description: "Falha na indexação RAG." },
  { code: "E_POLICY_APPROVAL", httpStatus: 403, description: "Ação exige aprovação humana pendente (HITL)." },
] as const;

export interface McpToolEntry {
  name: string;
  family: string;
  description: string;
}

/**
 * Catálogo das MCP tools, **derivado do kernel real** (`TOOLS`/`TOOL_FAMILIES`
 * em `mcp/kernel.ts`) desde a Fase 2 (realocação do kernel MCP pra dentro do
 * daemon) — antes disso era uma lista mantida à mão porque `daemon` não podia
 * importar `packages/tools` (ciclo: tools→daemon). Sem lista manual, não tem
 * como divergir: uma tool nova aparece aqui sozinha.
 */
export const MCP_TOOL_CATALOG: readonly McpToolEntry[] = TOOLS.map((t) => ({
  name: t.name,
  family: TOOL_FAMILIES[t.name] ?? "misc",
  description: t.description,
}));

/**
 * Verbos `os <verbo>` sem chamada de rota direta hoje. `remoteViable: false`
 * = por natureza local (lê filesystem/git de quem roda a CLI, ou é o próprio
 * processo do servidor) — não é lacuna a fechar, é escopo local mesmo.
 * `backup`/`discriminator` saíram daqui na Fase 3 (viraram `POST /admin/*`,
 * ver REST_ROUTES); `trace`/`manifest` só formatam `GET /trace/:id` e
 * `GET /api/manifest`, que já existiam — a CLI ainda fala direto com o
 * Postgres em vez de consumir essas rotas (dogfood não feito, mas não é gap
 * de alcance).
 */
export const CLI_ONLY_VERBS: readonly { verb: string; description: string; remoteViable: boolean }[] = [
  { verb: "migrate", description: "Importa souls de um diretório local (formato 'almas') pra dentro de home/souls/.", remoteViable: false },
  { verb: "import-sc", description: "Importa histórico local no formato SousaConversas pra dentro de home/souls/.", remoteViable: false },
  { verb: "rag eval", description: "Roda a suíte de avaliação de RAG (golden set local ou embutido) e compara com o histórico.", remoteViable: true },
  { verb: "prompt", description: "REPL interativo de prompt contra uma soul.", remoteViable: false },
  { verb: "daemon", description: "Sobe/derruba o processo do daemon.", remoteViable: false },
];
