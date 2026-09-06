# Arquitetura do Assistente OS

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces
(6 pacotes). **Persistência: PostgreSQL + pgvector** (via `docker compose`); o
daemon roda nativo. Markdown em `~/.assistant-os/` é a fonte canônica — o
Postgres é a camada derivada (reindexável).

> **Nota de sincronia (2026-08-29):** este doc foi reescrito para bater com o
> código atual. Referências históricas a SQLite (`memory.db`/`kernel.db`),
> Windows como plataforma primária e "Stitch MCP" estão obsoletas — ver
> `docs/ARCHITECTURE-REVIEW.md` e `docs/ARCHITECTURE-REFINEMENT-REVIEW.md` (arquivados) para o
> histórico das mudanças.

## Visão geral

```
┌──────────────────────────────────────────────────────────────┐
│ opencode (agente de código)                                  │
│   ├─ MCP assistente-os ──── packages/tools (stdio, 56 tools) │
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
│   └─ web PWA (11 abas)                                        │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/core (kernel)     packages/memory (RAG + grafo)      │
│  ~/.assistant-os/            PostgreSQL + pgvector:           │
│  ├─ souls/<id>/*.md          ├─ chunks + embeddings (HNSW)    │
│  ├─ skills/<name>/           ├─ entities/relations/observations│
│  ├─ .env (credenciais)       └─ LangChain LCEL RAG chain      │
│  └─ active.json              cache em camadas (Redis opcional) │
└──────────────────────────────────────────────────────────────┘
```

## Pacotes

### packages/core — kernel

- **config.ts** — `home` de `ASSISTENTE_OS_HOME` (padrão `~/.assistant-os`); `.env`
  carregado da home; degraus do roteador `local → zen → soul`.
- **souls.ts / soul-spec.ts** — souls como pastas (`config.json` +
  `perfil/contexto/licoes/pessoas/soul.md`); soul ativa em `active.json`; criação
  atômica validada (`SoulSpec`, limites de tamanho, capabilities do catálogo).
- **db.ts / migrations.ts** — pool `pg` + framework de migração append-only
  (numeradas `NNNN_nome`, idempotentes, uma transação por migração).
- **kernelDb.ts / sessions.ts / costs.ts** — tabelas Postgres: `cost_calls`
  (custo imutável), `router_history` (decisões do roteador), `agenda`, `events`,
  `sessions` / `session_messages`, `execution_logs` (+ `execution_spans` — trace
  por estágio), `monitors`.
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
  poda de chunks órfãos; busca vetorial (HNSW, `ef_search` fixo) → fallback literal.
- **embedders / embedder-fallback / embedder-local** — Xenova local
  (`multilingual-e5-base`, 768d) → Ollama → literal (ILIKE).
- **rag-chain.ts** — `retrieveContext`: busca → screening de prompt injection
  (`RAG_INJECTION_MODO`) → rerank opcional (`RAG_RERANK`, default off) → veredito
  de relevância → cache exato (TTL 60s) + semântico (`RAG_SEMANTIC_CACHE`, default off).
- **rag-eval.ts** — `os rag eval` (hit@k / MRR / recall@5) contra um golden set.
- **graph.ts** — entidades/relações/observações, isoladas por soul.
- **agent-workflow.ts / agent-state.ts** — grafo do agente LangGraph (tool-calling).

### packages/daemon — API-first

- **server.ts** — HTTP + `WsHub` (WebSocket manual) sobre `node:http`. Auth Bearer;
  `throttle.ts` (rate limit por cliente + semáforo de execuções caras).
- **routes/** — `chat` (o maior: router, RAG, tiers, escalonamento, streaming SSE,
  trace), `souls`, `agenda`, `events`, `monitors`, `infra` (`/infra/status`,
  `/trace/:id`), `metrics`, `manifest`, `familias`, `memory`, `pipelines`,
  `missions`, `worktree`, `voice`, `whatsapp`, `telegram`, `capabilities`,
  `llms-txt`.
- **runner.ts** — `runOpenCode` spawna `opencode run --format json` headless
  (stdin fechado; stdout/stderr em tempo real; corta no timeout).
- **langgraph-runner.ts / langgraph-tools.ts** — agente LangGraph (opt-in,
  `LANGGRAPH_ENABLED`); tools filtradas pela allowlist da soul.
- **orchestrator/** — `router` (modo fast/pro), `mission-runner` (ORCA),
  `escalation`, `spec-grill`, `sales-intelligence`.
- **observability/** — `metrics.ts` (Prometheus), `sentry.ts`, `record-llm-call.ts`.

### packages/tools — MCP

Servidor MCP (JSON-RPC 2.0 sobre stdio): `initialize`, `tools/list`, `tools/call`.
**56 tools** (memory, graph, soul, agenda, costs, router, monitores, ADO, browser,
worktree, guardian, sales, spec-grill, skill, mission) — lista e descrições em
`docs/MCPS.md`. Gate Zero Trust: allowlist da soul sempre; `authorizeExecution`
completo com `MCP_ZERO_TRUST=on`.

### packages/cli — comando `os`

`status`, `souls`, `soul <id> [ativa | canvas | anota | licao | decide]`,
`chat`, `migrate`, `memory <soul> index|search|status`, `rag eval`, `prompt
list|show`, `graph <soul> list`, `costs [usage]`, `trace <id>`, `agenda`,
`worktree`, `guardian`, `skill`, `manifest`, `daemon [port]`, `voice`, `backup`.

### packages/voice — pipeline de voz

VAD (histerese), AudioRecorder (sox), STT (Whisper via `@xenova/transformers`),
TTS (say.js). Opt-in (`VOICE_ENABLED`).

## Roteamento local-first

Degraus: **local** (Ollama) → **zen** (provider OpenCode Zen) → **soul**
(opencode). `POST /souls/:id/chat` e o `onChat` da voz sondam o Ollama
(`GET /api/tags`, sem inferência); `local` falhando cai para `zen`. A execução
real acontece **uma vez**, no degrau vencedor. Toda tentativa em `router_history`;
custo imutável em `cost_calls`.

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
`nemotron-3-ultra-free`. O mapeamento soul→provider ("a quem pertence") segue
pendente (decisão de posse).

## Observabilidade

- **`/metrics`** (Prometheus, atrás do token) — contadores/labels de baixa
  cardinalidade; nenhum conteúdo de prompt/resposta.
- **Trace por turno** — `x-trace-id` na resposta do chat; `execution_logs.trace_id`
  liga a linha canônica aos `execution_spans` (um por estágio:
  `chat`/`rag`/`router`/`ollama`/`langgraph`/`persistencia`). `os trace <id>` /
  `GET /trace/:id` reconstroem "onde falhou".
- **Sentry** — opt-in (`SENTRY_DSN`); no-op sem a var.
- **Audit trail** — `souls/<id>/sessoes/<data>.md` + `execution_logs`; telemetria
  sanitizada (`sanitizeVerdictForLog` remove conteúdo de RAG).

## Segurança

- **Auth** — Bearer único (`ASSISTENTE_OS_DAEMON_TOKEN`), `timingSafeEqual`;
  boot recusado em host não-loopback sem token. `/health` público (sem lista de
  souls).
- **Zero Trust** — catálogo L1/L2/L3 (`policy.ts`) + `authorizeExecution`;
  allowlist por soul sempre aplicada no MCP e no LangGraph; enforcement de
  autonomia com `MCP_ZERO_TRUST=on`.
- **Rate limit / concorrência** — `AOS_RATE_LIMIT` (600/60s) + `AOS_MAX_CONCURRENT_EXEC` (8).
- **Prompt injection** — screening heurístico na entrada e nos chunks de RAG
  (`PROMPT_INJECTION_MODO` / `RAG_INJECTION_MODO`).
- **Isolamento por soul** — predicado `WHERE soul = $1` em RAG/grafo/sessões/custo;
  não há tabela de tenants nem auth por tenant (single-install).

## Persistência

- **Canônico:** markdown em `~/.assistant-os/souls/<id>/` (git-friendly).
- **Derivado:** PostgreSQL + pgvector — `chunks`/embeddings (RAG), grafo,
  `sessions`/`session_messages`, `cost_calls`/`router_history`/`execution_logs`,
  `agenda`/`events`/`monitors`, `familias` (domínio LGPD, ADR-PRIV-001).
- **Cache:** Redis opcional (`REDIS_URL`) — compartilha cache exato/semântico de
  RAG entre instâncias; sem ele, só memória do processo.
- **Backup:** `os backup` → ZIP com `souls/` + `.env` + `pg_dump --format=custom`
  em `ASSISTENTE_OS_BACKUP_DIR` (retenção 7 dias). Restore:
  `pg_restore --clean --if-exists`.

## Deploy

- **PM2** (`ecosystem.config.cjs`): `assistente-os` (daemon), `assistente-os-backup`
  (one-shot, `cron_restart` 3×/dia), `soul-rag-watcher` (observa `souls/*/` e
  reindexa via MCP quando `.md`/`.txt` mudam).
- **Docker** (`docker-compose.yml`): PostgreSQL (pgvector) + Cloudflare Tunnel. O
  daemon roda nativo (serviço `daemon` no compose é opcional).
- **CI** (`.github/workflows/ci.yml`): job `compliance` (gate de PR) + job
  `build-and-test` (Postgres pgvector:pg17 como serviço; `npm run build` →
  `typecheck` → migrações → `npm test` → execution manifest).

## Estado

Fases F1–F9 concluídas (ver README). Backlog do roadmap (E1–E10) zerado — E7
(service token do Cloudflare Access) é ação no dashboard, fora do repo.
Refino de arquitetura (10 etapas) e ondas 0–2 de remediação da análise crítica
concluídos. Stitch MCP **descontinuado** (removido em 2026-08-18).
