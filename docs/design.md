# Arquitetura do terrasIA

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces
(6 pacotes). **Persistência: PostgreSQL + pgvector** — uma única instância,
sem SQLite; o daemon roda nativo, o Postgres roda via `docker compose`.
Markdown em `~/.assistant-os/souls/<id>/` é a fonte canônica de conhecimento
por soul; o Postgres é a camada derivada (RAG/grafo são reindexáveis a partir
do markdown; `cost_calls`/`agenda`/`events`/`sessions` não têm fonte fora do
banco).

> Substitui `docs/ARCHITECTURE.md` (2026-08-29) — atualizado em 2026-09-07 pra
> refletir HUD Central, agenda edit/cancel/force, custo real em $, painel de
> backfill na Telemetria e as decisões de processo de 2026-09-05/06 (branch
> `dev`/`main`, PR compliance, arquivamento de docs de processo). Histórico
> anterior a isso: `consultoria_ia` (soul, cliente SousaLima),
> `arquivo-historico/`.

## Visão geral

```
┌──────────────────────────────────────────────────────────────┐
│ opencode (agente de código) / Claude Code                    │
│   ├─ MCP assistente-os ──── packages/tools (stdio, JSON-RPC) │
│   └─ provider zen ────────── chaves OpenCode Zen em rodízio   │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/daemon — HTTP + WebSocket (node:http), porta 4310    │
│   auth: Bearer (ASSISTENTE_OS_DAEMON_TOKEN); /health público  │
│   rate limit por cliente + cap de execuções caras (throttle)  │
│   ├─ POST /souls/:id/chat  → router local/zen/soul (+langgraph)│
│   ├─ ORCA: mission runner · worktree manager (git worktree)   │
│   ├─ pipelines: email-ingest · meeting-ingest · sales         │
│   ├─ canais: WhatsApp (Baileys) · Telegram (Bot API) — opt-in │
│   ├─ voz: VAD + STT (Whisper) + TTS — opt-in                  │
│   ├─ observabilidade: /metrics (Prometheus) · Sentry · trace  │
│   │   · /telemetry/backfill-status (progresso do grafo)       │
│   └─ HUD web (13 abas, inclui "Central" e "Telemetria")       │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/core (kernel)     packages/memory (RAG + grafo)      │
│  ~/.assistant-os/            PostgreSQL + pgvector:           │
│  ├─ souls/<id>/*.md          ├─ chunks + embeddings (HNSW)    │
│  ├─ skills/<name>/           ├─ entities/relations/observations│
│  ├─ .env (credenciais)       ├─ document_extraction_state     │
│  └─ active.json              └─ LangChain LCEL RAG chain      │
│                               cache em camadas (Redis opcional) │
└──────────────────────────────────────────────────────────────┘
```

## Pacotes

### packages/core — kernel

- **config.ts** — `home` de `ASSISTENTE_OS_HOME` (padrão `~/.assistant-os`); `.env`
  carregado da home; degraus do roteador `local → zen → soul`.
- **souls.ts / soul-spec.ts** — souls como pastas (`config.json` +
  `perfil/contexto/licoes/pessoas/soul.md`); soul ativa em `active.json`; criação
  atômica validada (`SoulSpec`, limites de tamanho, capabilities do catálogo).
  `soul_create` é fail-closed: exige `AGENT_SOUL_ID` no contexto do agente —
  criação administrativa direta usa `createSoulFull` do core, não o tool MCP.
- **db.ts / migrations.ts** — pool `pg` + framework de migração append-only
  (numeradas `NNNN_nome`, idempotentes, uma transação por migração).
- **kernelDb.ts / sessions.ts / costs.ts** — tabelas Postgres: `cost_calls`
  (custo imutável, ver seção Custos), `router_history` (decisões do roteador),
  `agenda` (com `updateAgendaItem`/`cancelAgendaItem`/`getAgendaItemById` —
  edição e cancelamento são soft: `status='cancelled', done=true`, nunca
  `DELETE`), `events`, `sessions`/`session_messages`, `execution_logs`
  (+ `execution_spans` — trace por estágio), `monitors`.
  Colunas `BIGINT` (ex.: `agenda.id`) voltam do driver `pg` como **string**,
  não `number` — comparações no HUD/tools precisam de `String(a) === String(b)`.
- **pricing.ts** — `calcCost(provider, model, inputTokens, outputTokens)`:
  tabela de preço por modelo (`PRICING_TABLE`), Ollama sempre `0` (custo de
  infra, não de API), modelo desconhecido cai em `0` sem lançar. Usado nos 5
  call-sites que gravam `cost_calls` (chat, stream, agenda, events,
  `record-llm-call.ts`) — antes gravavam `cost: 0` hardcoded. Hoje os dois
  providers em uso (Ollama, Zen `nemotron-3-ultra-free`) são genuinamente
  gratuitos por token, então o número exibido não muda; a lacuna fica
  intencional e documentada, pronta para o dia em que um modelo pago entrar.
- **router.ts** — roteador local-first em degraus com sonda barata.
- **policy.ts** — catálogo de capabilities L1/L2/L3 versionado +
  `authorizeExecution()` (allowlist × risco × autonomy × budget × approvalPolicy).
- **cache.ts** — cache em camadas (Redis + fallback em memória, degrada limpo).
- **governance/** — golden rules com aprovação humana por código (Telegram),
  auditoria de execução (Guardian), gerador de AIIA.
- **security/** — content filter (12 padrões de segredo), detector de prompt
  injection, temp vault.
- **manifest.ts** — retrato reproduzível por release (git sha, catálogo,
  hash de system prompt por soul, prompts do Garden, config de RAG).

### packages/memory — RAG + grafo

- **indexer.ts** — chunking de markdown/texto, indexação idempotente
  (`UNIQUE(soul, doc_key)`), `content_hash` pula re-embed de conteúdo inalterado,
  poda de chunks órfãos; busca vetorial (HNSW, `ef_search` fixo) → fallback literal,
  ou fusão RRF com full-text nativo (`tsvector`/GIN) quando `RAG_HYBRID_SEARCH`
  está ligado (default off, ver [docs/RAG-HYBRID.md](RAG-HYBRID.md)).
  `getBackfillStatus(pool)` agrega `document_extraction_state` por soul
  (candidatos/completos/falharam/nunca tentados) — usado pelo painel de
  Telemetria.
- **embedders / embedder-fallback / embedder-local** — Xenova local
  (`multilingual-e5-base`, 768d) → Ollama → literal (ILIKE).
- **rag-chain.ts** — `retrieveContext`: busca (vetorial, ou híbrida RRF) →
  screening de prompt injection (`RAG_INJECTION_MODO`) → rerank opcional
  (`RAG_RERANK`, default off) → veredito de relevância → cache exato (TTL 60s)
  + semântico (`RAG_SEMANTIC_CACHE`, default off).
- **rag-eval.ts** — `os rag eval` (hit@k / MRR / recall@5) contra um golden set.
- **graph.ts** — entidades/relações/observações, isoladas por soul. Dois
  caminhos de extração: **automático** via chat/`addObservation()` (sempre
  ligado) e **por documento** via `RAG_DOC_ENTITY_EXTRACTION` (flag, default
  off) — quando ligado, indexação de doc enfileira extração em
  `entity_extraction_queue`; quando esteve off no passado, `os memory
  backfill-entities [--soul <id>] [--dry-run] [--limit N] [--model <nome>]`
  processa os documentos pendentes (`document_extraction_state`), resumível.
  Upsert de entidade/relação preserva histórico em `entity_history`/
  `relation_history` (só grava quando `kind`/`properties` realmente mudam) —
  ledger append-only inspirado no Utopia. Dedup por nome (`name_fold`,
  case-insensitive, sempre ativo) + opcionalmente por similaridade de
  embedding (`GRAPH_ENTITY_DEDUP`, default off) via `resolveCanonicalEntityName`.
  `walkGraph`/tool MCP `graph_walk` fazem travessia por N saltos a partir de
  uma entidade, complementando o dump plano de `graph_list`.
- **agent-workflow.ts / agent-state.ts** — grafo do agente LangGraph (tool-calling).

### packages/daemon — API-first

- **server.ts** — HTTP + `WsHub` (WebSocket manual) sobre `node:http`. Auth Bearer;
  `throttle.ts` (rate limit por cliente + semáforo de execuções caras).
- **routes/** — `chat` (o maior: router, RAG, tiers, escalonamento, streaming SSE,
  trace), `souls`, `agenda` (inclui `PATCH /agenda/:id` e
  `POST /agenda/:id/cancel`), `events`, `monitors`, `infra` (`/infra/status`,
  `/trace/:id`, `/telemetry/backfill-status`), `metrics`, `manifest`,
  `familias`, `memory`, `pipelines`, `missions`, `worktree`, `voice`,
  `whatsapp`, `telegram`, `capabilities`, `llms-txt`.
- **runner.ts** — `runOpenCode` spawna `opencode run --format json` headless
  (stdin fechado; stdout/stderr em tempo real; corta no timeout).
- **langgraph-runner.ts / langgraph-tools.ts** — agente LangGraph (opt-in,
  `LANGGRAPH_ENABLED`); tools filtradas pela allowlist da soul.
- **orchestrator/** — `router` (modo fast/pro), `mission-runner` (ORCA),
  `escalation`, `spec-grill`, `sales-intelligence`.
- **observability/** — `metrics.ts` (Prometheus), `sentry.ts`,
  `record-llm-call.ts` (helper unificado de gravação em `cost_calls`, usa
  `calcCost`).
- **web/** — HUD SPA (`index.html` + `assets/app.js`), 13 abas: dashboard,
  chat, memory, graph, langgraph, mcp, buffer, llm, observability
  ("Telemetria"), whatsapp, telegram, friendly-admin, **central** (nova).
  Padrão de aba: `.tab`/`.panel`, auto-refresh por intervalo iniciado ao
  ativar a aba e parado ao sair dela.

### packages/tools — MCP

Servidor MCP (JSON-RPC 2.0 sobre stdio): `initialize`, `tools/list`,
`tools/call`. Famílias: memory, graph, soul, agenda, costs, router,
monitores, ADO, browser, worktree, guardian, sales, spec-grill, skill,
mission, editorial — catálogo completo e descrições em `docs/MCPS.md`.
Padrão `ToolContext`/`FAMILY_HANDLERS` em `src/index.ts`.

Família `agenda` inclui `agenda_add`/`agenda_list` (leitura/criação) e, desde
2026-09-07, **`agenda_update`/`agenda_cancel`/`agenda_force`** — cada um
resolve o item via `resolveScopedAgendaItem`, que impede uma soul de
editar/cancelar/forçar um item de agenda de outra soul (só o dono ou um item
global). Isso espelha a UI da aba Central, que agora tem escopo completo de
edição/cancelamento, não só leitura.

**Zero Trust:** allowlist da soul (`config.json` → `agent.permissions.tools`)
sempre aplicada; `authorizeExecution` completo com `MCP_ZERO_TRUST=on`.
Mudança em `config.json` de uma soul exige reiniciar o daemon pra valer
(não há hot-reload de permissões).

### packages/cli — comando `os`

`status`, `souls`, `soul <id> [ativa | canvas | anota | licao | decide]`,
`chat`, `migrate`, `memory <soul> index|search|status|backfill-entities`,
`rag eval`, `prompt list|show`, `graph <soul> list`, `costs [usage]`,
`trace <id>`, `agenda`, `worktree`, `guardian`, `skill`, `manifest`,
`daemon [port]`, `voice`, `backup`.

> `npm run os -- <cmd> --flag` — o `--` separador é obrigatório; sem ele o
> npm engole flags depois do primeiro argumento silenciosamente (causou um
> backfill rodando em todas as souls em vez de uma só, numa sessão real).

### packages/voice — pipeline de voz

VAD (histerese), AudioRecorder (sox), STT (Whisper via `@xenova/transformers`),
TTS (say.js). Opt-in (`VOICE_ENABLED`).

## Roteamento local-first

Degraus: **local** (Ollama) → **zen** (provider OpenCode Zen) → **soul**
(opencode). `POST /souls/:id/chat` e o `onChat` da voz sondam o Ollama
(`GET /api/tags`, sem inferência); `local` falhando cai para `zen`. A execução
real acontece **uma vez**, no degrau vencedor. Toda tentativa em
`router_history`; custo real (via `calcCost`) em `cost_calls`.

**Escalonamento por confiança** (`ROUTER_ESCALATION`, default off —
`docs/ROUTER-ESCALATION.md`): após o tier `local`, sinais de baixa confiança
(falha · resposta vazia/curta · recusa + RAG fraco · juiz LLM local) disparam
**uma** re-tentativa no próximo degrau, com tetos por sessão.

**LangGraph** (`LANGGRAPH_ENABLED`, default off): o roteador **nunca** auto-seleciona
— só roda quando a UI força `tier: "langgraph"`. Tool-calling multi-turno com
histórico reidratado do Postgres, checkpoint por `threadId=session-<id>`.

### Multi-Zen (rodízio de chaves)

`ZEN_API_KEYS` (ou `ZEN_API_KEY_1..7` / `ZEN_API_KEY`) — round-robin por chamada
(`nextZenApiKey()`) em chat/RAG/LangGraph. Modelo padrão do tier `zen`:
`nemotron-3-ultra-free` (free tier real, sem custo por token — ver
`docs/FREE_PROVIDERS.md`). O mapeamento soul→provider ("a quem pertence")
segue pendente (decisão de posse).

## HUD — aba Central

Visão única de "o que está rodando / pendente / como iniciar trabalho",
somando dados que já existiam espalhados (agenda, missões, worktrees, router,
custos) numa aba só, com auto-refresh (15–30s) enquanto aberta:

- **Agenda** — lista + formulário "Pedir tarefa" (título, soul, data/hora,
  corpo) via `agenda_add`; editar/cancelar por item, escopado por soul.
- **Missões** (ORCA) e **worktrees** — leitura do que já existe em
  `mission_list`/`worktree_list`.
- **Router** e **custos** — snapshot de `router_status`/`costs_summary`.

Tudo lido de rotas HTTP já existentes — nenhum mecanismo novo de transporte,
só composição na UI.

## Observabilidade ("Telemetria")

- **`/metrics`** (Prometheus, atrás do token) — contadores/labels de baixa
  cardinalidade; nenhum conteúdo de prompt/resposta.
- **Trace por turno** — `x-trace-id` na resposta do chat; `execution_logs.trace_id`
  liga a linha canônica aos `execution_spans` (um por estágio:
  `chat`/`rag`/`router`/`ollama`/`langgraph`/`persistencia`). `os trace <id>` /
  `GET /trace/:id` reconstroem "onde falhou".
- **`GET /telemetry/backfill-status`** (2026-09-07) — progresso do
  `os memory backfill-entities` por soul (candidatos/completos/falharam/nunca
  tentados), lido de `document_extraction_state` via `getBackfillStatus`,
  filtrado contra `listSouls(home)` (a tabela acumula linhas órfãs de souls já
  apagadas do disco — nunca são limpas na exclusão). Renderizado como tabela
  na aba Telemetria; não faz tail de arquivo nem fala com o processo CLI em si
  — é reconstruído do estado já gravado no Postgres.
- **Sentry** — opt-in (`SENTRY_DSN`); no-op sem a var.
- **Audit trail** — `souls/<id>/sessoes/<data>.md` + `execution_logs`; telemetria
  sanitizada (`sanitizeVerdictForLog` remove conteúdo de RAG).

## Segurança

- **Auth** — Bearer único (`ASSISTENTE_OS_DAEMON_TOKEN`), `timingSafeEqual`;
  boot recusado em host não-loopback sem token. `/health` público (sem lista de
  souls).
- **Zero Trust** — catálogo L1/L2/L3 (`policy.ts`) + `authorizeExecution`;
  allowlist por soul sempre aplicada no MCP e no LangGraph; enforcement de
  autonomia com `MCP_ZERO_TRUST=on`; tools de agenda (`agenda_update` etc.)
  reforçam escopo por soul além da allowlist.
- **Rate limit / concorrência** — `AOS_RATE_LIMIT` (600/60s) + `AOS_MAX_CONCURRENT_EXEC` (8).
- **Prompt injection** — screening heurístico na entrada e nos chunks de RAG
  (`PROMPT_INJECTION_MODO` / `RAG_INJECTION_MODO`).
- **Isolamento por soul** — predicado `WHERE soul = $1` em RAG/grafo/sessões/custo;
  não há tabela de tenants nem auth por tenant (single-install; multi-tenant
  "Modo Amigável" é auth de contas sobre o mesmo Postgres, não isolamento de
  infra).

## Persistência

- **Canônico:** markdown em `~/.assistant-os/souls/<id>/` (git-friendly, fora
  do repo).
- **Derivado:** PostgreSQL + pgvector — `chunks`/embeddings (RAG),
  `entities`/`relations`/`observations` (grafo), `document_extraction_state`
  (progresso de backfill), `sessions`/`session_messages`,
  `cost_calls`/`router_history`/`execution_logs`, `agenda`/`events`/`monitors`,
  `familias` (domínio LGPD, ADR-PRIV-001).
- **Órfãos conhecidos:** apagar uma soul do disco não faz cascade delete nas
  linhas dela em `chunks`/`document_extraction_state` — rotas que agregam por
  soul (ex.: `/telemetry/backfill-status`) filtram contra `listSouls(home)`
  para não misturar lixo histórico com o estado atual.
- **Cache:** Redis opcional (`REDIS_URL`) — compartilha cache exato/semântico de
  RAG entre instâncias; sem ele, só memória do processo.
- **Backup:** `os backup` → ZIP com `souls/` + `.env` + `pg_dump --format=custom`
  em `ASSISTENTE_OS_BACKUP_DIR` (retenção 7 dias). Restore:
  `pg_restore --clean --if-exists`.

## Deploy

- **PM2** (`ecosystem.config.cjs`): `assistente-os` (daemon), `assistente-os-backup`
  (one-shot, `cron_restart` 3×/dia), `soul-rag-watcher` (observa `souls/*/` e
  reindexa via MCP quando `.md`/`.txt` mudam, debounce 20s, ignora
  `sources/uploads/`).
- **Docker** (`docker-compose.yml`): PostgreSQL (pgvector) + Cloudflare Tunnel
  (`extra_hosts: host-gateway` pra resolver `host.docker.internal`). O
  daemon roda nativo (serviço `daemon` no compose é opcional).
- **CI** (`.github/workflows/ci.yml`): job `compliance` (PR-only — 4 seções
  obrigatórias no corpo do PR: Descrição, `Plano:`, Rastreabilidade,
  `Rollback:`) + job `build-and-test` (Postgres pgvector:pg17 como serviço;
  `npm run build` → `typecheck` → migrações → `npm test` → execution
  manifest). O gate `discriminator` (LLM em CI) foi removido em 2026-09-06;
  `npm run dod` ainda roda `os discriminator` localmente.
- **Branches:** `dev` é a branch de integração (todo PR mira `dev`); `main`
  só recebe promoções `dev`→`main`. GitHub Free não tem branch protection
  técnica — convenção, não bloqueio.

## Estado

Fases F1–F9 concluídas (ver README). Desde 2026-09-06, `docs/ROADMAP.md` é o
backlog canônico — ADRs, specs e análises pontuais fechadas saíram do repo
(copiadas para a soul `consultoria_ia`, cliente SousaLima, antes de apagar).
`docs/adr/` foi reaberto para ADRs novos (`ADR-RAG-002` é o primeiro desde a
reabertura). Stitch MCP **descontinuado** (removido em 2026-08-18).
