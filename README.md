# Assistente OS

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces com 6 pacotes, soul-based knowledge management, RAG + knowledge graph, agente LangGraph com tool-calling, interface web responsiva (PWA), canais WhatsApp/Telegram, pipeline de voz, e deploy em produção via PM2 + Cloudflare Tunnel + CI no GitHub Actions.

## Quick Start

```bash
npm install && npm run build

# CLI
npm run os status
npm run os souls

# indexar memória de uma soul
npm run os memory main index
npm run os memory main search "assuntos recentes"

# daemon REST + WebSocket (porta 4310)
npm run os daemon

# web interface
# acesse http://localhost:4310
```

O daemon escuta em `127.0.0.1` por padrão. Para acesso remoto, defina `AOS_HOST` e `ASSISTENTE_OS_DAEMON_TOKEN` — sem token configurado, o boot é **recusado** em host não-loopback (falha rápido em vez de subir exposto sem autenticação). Veja [QUICKSTART.md](QUICKSTART.md) para o passo a passo completo.

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│ opencode                                                     │
│   ├─ MCP assistente-os ─── packages/tools (stdio, 45 tools) │
│   └─ providers zen-* ──── 7 chaves OpenCode Zen (grátis)    │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/daemon (REST + WebSocket autenticado, porta 4310)   │
│   ├─ Chat com router local-first (local/zen/soul) + langgraph│
│   ├─ LangGraph agent com tool-calling (11 tools LangChain)   │
│   ├─ Canais: WhatsApp (Baileys), Telegram (Bot API)          │
│   ├─ Pipeline de voz (VAD + STT + TTS)                       │
│   └─ Web interface responsiva (PWA, 11 abas, tema cyberpunk) │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/core              packages/memory                   │
│  ~/.assistant-os/           memory.db (SQLite) + pgvector    │
│  ├─ souls/<id>/...           ├─ chunks + embeddings (RAG)    │
│  ├─ kernel.db (SQLite)       ├─ LangChain LCEL RAG chain     │
│  ├─ active.json              ├─ LangGraph agent workflow     │
│  └─ .env (credenciais)       └─ entidades/relações (grafo)   │
└──────────────────────────────────────────────────────────────┘
```

**Princípios**: local-first (Ollama fallback), zero Docker obrigatório (só Postgres usa Docker), markdown como storage primário, PostgreSQL advisory locks para concorrência. Credenciais de cada instalação (tokens, chaves de API, tunnel token) ficam só em `~/.assistant-os/.env` — nunca no repositório — para o mesmo código rodar em várias máquinas com credenciais próprias. Toda resposta de toda soul carrega uma diretriz FinOps fixa no system prompt (sem preâmbulo, sem repetir o pedido do usuário) — reduz tokens de saída sem flag de configuração.

## Pacotes

| Pacote | Papel | Capacidades |
|---|---|---|
| `core` | Kernel | Config, souls, kernel.db (agenda/costs/events/sessions), roteador local-first com fallback probado (fast e pro), migração, content filter (12 padrões), temp vault, ADO client, sessões, monitores, auditoria ISO/IEC 42001, golden rules |
| `memory` | RAG + Grafo | Chunks + embeddings (Ollama ou fallback Xenova/ILIKE), LangChain LCEL RAG, LangGraph agent workflow com tool-calling, grafo de entidades/relações/observações, gate de relevância |
| `daemon` | REST + WS | API HTTP (40+ endpoints, todos autenticados por Bearer token exceto `/health`), WebSocket autenticado, LangGraph runner, agenda dispatch, events, canais WhatsApp/Telegram, pipeline de voz, browser automation, upload com zip-slip protection |
| `tools` | MCP server | 45 tools MCP (stdio) expostas ao opencode: memory, graph, soul, agenda, costs, ADO, browser, router, monitores, guardian (golden rules), sales intelligence, spec grill |
| `cli` | Comando `os` | status, souls, soul, chat, migrate, import-sc, memory, graph, costs, agenda, daemon, voice, backup, help |
| `voice` | Pipeline de voz | VAD (hysteresis), AudioRecorder (sox), STT (Whisper local via @xenova/transformers), TTS (say.js) |

## Capacidades

### Soul System

Cada "soul" é um perfil vivo de conhecimento com markdown files (perfil, contexto, lições, pessoas, soul.md) em `~/.assistant-os/souls/<id>/`.

- **15 souls ativas** nesta instalação: aprendizado, cidadeplaza, consultoria_ia, desenvolvimento, escrita, gestaoobrigacoes, investimentos, iso, kinetiswan, main, mente_inclusiva, ministro_louvor, segundo-cerebro, slcia, suriel
- **Permissões Zero Trust**: cada soul declara (ou herda `DEFAULT_ALLOWED_TOOLS`) a allowlist de tools que pode chamar, com wildcards (`memory:*`, `ado_*`)
- **Config por soul**: provider, modelos, dailyLimit, maxTurns, guardrails de agente
- **Active tracking**: `active.json` no home directory
- **Markdown memory**: anotar (notas diárias), registrarLicao (lições), decidir (ADR decisions)

### RAG + Knowledge Graph

- **Chunks + embeddings**: indexação de markdown/txt, Ollama embeddings ou fallback Xenova/ILIKE
- **LangChain LCEL RAG**: `retrieveContext()` → `ChatPromptTemplate` → LLM
- **Grafo de conhecimento**: entidades, relações, observações em Postgres
- **Gate de relevância**: threshold configurável com modos (recusar/aviso/livre)
- **Busca híbrida**: vetorial + literal com scores

### LangGraph Agent

- **Tool-calling**: 11 tools LangChain wrapando ferramentas do Assistente OS
  - Memory: `memory_search`, `memory_index`, `memory_status`
  - Graph: `graph_list`, `observation_add`
  - Soul: `soul_anotar`, `soul_licao`, `soul_decidir`
  - Agenda: `agenda_add`, `agenda_list`
  - Costs: `costs_summary`
- **Thread persistence**: MemorySaver checkpoints, multi-turno com memória
- **Fluxo**: User → retrieve (RAG) → generate (LLM com tools) → tools executa → generate → END
- **Modelo padrão**: `qwen2.5-coder:3b` via Ollama (CPU, pode levar dezenas de segundos por chamada)
- **Painel de log ao vivo**: aba Chat mostra cada etapa da execução (sanitização, RAG, roteamento, chamada ao provider) em tempo real via WebSocket

### Roteador Local-First

- **Degraus configuráveis** (`routerTiers`, padrão `local → zen → soul`); `langgraph` é um degrau à parte, só acionado por pedido explícito do cliente
- **Modo fast** (padrão, prompts curtos): sonda barata (`GET /api/tags` no Ollama, timeout 3s) e cai pro próximo degrau se o local não responder
- **Modo pro** (prompts longos/complexos): mesma sonda, mais iterações e RAG híbrido
- **7 providers Zen**: zen-sousa, zen-devocional, zen-iecsjc, zen-evertongame, zen-escritor, zen-iso, zen-avancei
- **Histórico imutável**: cada tentativa de roteamento fica registrada em `router_history` (kernel.db)

### Segurança

- **Zero Trust permissions**: allowlist por soul para tools, skills, diretórios externos
- **API e WebSocket autenticados**: Bearer token em todas as rotas exceto `/health`; o WebSocket (que não aceita headers customizados) aceita o mesmo token via `?token=` na URL de conexão
- **Boot-guard**: recusa subir em host não-loopback sem token configurado, em vez de logar aviso e continuar exposto
- **Content filter**: 12 padrões (OpenAI, Anthropic, Azure PAT, GitHub, AWS, private keys, passwords, JWT, connection strings)
- **Temp vault**: credenciais em memória com purge automático
- **HMAC webhooks**: SHA-256 com verificação de timestamp
- **Zip-slip protection**: sanitização de nomes de arquivo no upload
- **Agent guardrails**: maxTurns, maxIterations, ragThreshold, dailyLimitTokens
- **Audit trail**: compliance ISO/IEC 42001 (`logFullAuditEntry`)
- **Credenciais por instalação**: tokens/segredos só em `~/.assistant-os/.env` (nunca no repo) — inclusive o token do Cloudflare Tunnel, lido via symlink `.env` na raiz

### Interface Web (11 abas, PWA responsiva)

| Aba | Descrição |
|-----|-----------|
| **C&C Node** | Dashboard com cards de stats, lista de souls com filtros (TODAS/ATIVA/INATIVAS), canvas de rede animado |
| **Chat** | Chat interativo com seletor de tier (local/zen/soul/langgraph), override de modelo, controles de voz, painel de log de execução em tempo real, tool calls visíveis |
| **Memória** | Status de chunks, upload de arquivos/zips, slider de threshold, busca semântica |
| **Grafo** | Visualizador de entidades, relações e observações por soul |
| **LangGraph** | Seletor de modo (retrieve/generate/tools/full), visualização SVG do grafo, tracking de steps, histórico de tool calls |
| **Buffer** | Inspector do prompt montado: arquivos, chars, tokens estimados, verdict RAG (reflete o texto atual do chat, incluindo o RAG que seria ativado) |
| **Motores LLM** | Lista de modelos Ollama, status do router |
| **MCP** | Tools LangChain categorizadas (Memória, Grafo, Soul, Agenda, Custos) |
| **WhatsApp** | Conversas em mestre-detalhe (mobile), envio de mensagens, mídia autenticada |
| **Telegram** | Conversas do bot, envio de mensagens |
| **Telemetria** | Infraestrutura (daemon, Ollama, CPU, RAM, disco, Postgres), eventos, execuções, custos por soul, monitores de site |

Instalável como PWA (manifest + service worker); responsiva abaixo de 900px (sidebar vira drawer, WhatsApp/Telegram viram mestre-detalhe).

### Pipeline de Voz

- **VAD**: Voice Activity Detection com hysteresis (threshold configurável)
- **Audio Recorder**: captura PCM via sox (16kHz, 16-bit mono)
- **STT**: Whisper via @xenova/transformers (100% local, português padrão)
- **TTS**: síntese de fala via say.js
- **Pipeline completo**: VAD detecta fala → grava áudio → transcreve → gera resposta → fala de volta

### REST API (40+ endpoints)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check (público, sem token) |
| GET | `/llms.txt` | Catálogo de rotas/tools/souls, para ingestão headless por agentes externos |
| GET | `/souls` | Lista todas as souls |
| GET | `/souls/:id` | Detalhe da soul |
| GET | `/souls/:id/context` | Contexto concatenado da soul |
| GET | `/souls/:id/buffer` | Inspeciona o prompt/contexto montado (RAG incluso) |
| POST | `/souls/:id/chat` | Chat com a soul (tier: local/zen/soul/langgraph) |
| GET | `/souls/:id/langgraph/status` \| `/history` | Status/histórico do agente LangGraph |
| POST | `/souls/:id/upload` | Upload de arquivos (zip-slip protected) |
| GET | `/souls/:id/memory/status` | Stats de memória (chunks + grafo) |
| POST | `/souls/:id/memory/search` | Busca RAG com gate de relevância |
| GET | `/souls/:id/graph` | Grafo (entidades/relações/observações) da soul |
| POST | `/souls/:id/graph/observation` | Adiciona observação ao grafo |
| POST | `/souls/:id/anotar` \| `/licao` \| `/decidir` | Escrita direta na alma da soul |
| GET | `/souls/:id/health` | Health check por soul |
| GET | `/costs` | Resumo de custos por soul |
| GET | `/router/status` | Degraus do roteador e config do Ollama |
| GET | `/sessions/stats` | Total de sessões |
| GET \| POST | `/agenda` | Lista/cria itens da agenda |
| GET \| POST | `/events` | Lista/recebe eventos (POST exige HMAC) |
| GET \| POST | `/monitors` | Lista/cria monitores de site |
| POST | `/monitors/check` | Roda a checagem de todos os monitores agora |
| DELETE | `/monitors/:id` | Remove monitor |
| GET | `/infra/status` | Snapshot de saúde (Ollama, Postgres, sistema, RAG, eventos, execuções) |
| GET \| POST | `/familias` | Domínio LGPD de famílias (onboarding, encerramento) |
| POST | `/voice/start` \| `/stop` | Liga/desliga o pipeline de voz |
| GET | `/voice/status` | Status do pipeline de voz |
| GET | `/api/whatsapp/status` \| `/messages` | Status/histórico do canal WhatsApp |
| POST | `/api/whatsapp/send` | Envia mensagem WhatsApp |
| GET | `/api/whatsapp/media/:file` | Mídia recebida (autenticada via `?token=` também) |
| GET | `/api/telegram/status` \| `/messages` | Status/histórico do canal Telegram |
| POST | `/api/telegram/send` | Envia mensagem Telegram |
| POST | `/api/pipelines/meeting-ingest` \| `/email-ingest` | Ingestão de reuniões/e-mails |
| WS | `/` | WebSocket de eventos em tempo real (token via `?token=`) |

### MCP Tools (45 tools)

**Soul**: `souls_list`, `soul_context`, `soul_chat`, `soul_anotar`, `soul_licao`, `soul_decidir`, `soul_record_lesson`, `soul_get_lessons`
**Memória**: `memory_search`, `memory_index`, `memory_status`
**Grafo**: `graph_list`, `observation_add`
**Agenda**: `agenda_add`, `agenda_list`
**Custos/Infra**: `costs_summary`, `router_status`, `action_execute`
**Guardian (golden rules)**: `guardian_audit_execution`, `guardian_promote_golden_rule`, `guardian_pending_rules`, `guardian_approve_rule`, `guardian_reject_rule`, `guardian_get_golden_rules`
**Sales Intelligence**: `sales_ingest_meeting`, `sales_get_lead_brief`
**Spec Grill**: `spec_grill_plan` (refinamento de requisitos em duas fases antes de autorizar modo build)
**Azure DevOps**: `ado_list_projects`, `ado_list_repositories`, `ado_list_work_items`, `ado_create_work_item`, `ado_get_work_item`, `ado_update_work_item`, `ado_list_pipelines`, `ado_run_pipeline`, `ado_list_pull_requests`, `ado_create_pull_request`
**Browser**: `browser_navigate`, `browser_click`, `browser_extract_text`, `browser_screenshot`, `browser_close`, `browser_get_accessibility_tree`, `browser_execute_fix`, `browser_audited_screenshot`

Tools novas entram protegidas por Zero Trust: só ficam disponíveis pra uma soul se estiverem em `DEFAULT_ALLOWED_TOOLS` (core) ou explicitamente no `agent.permissions.tools` do `config.json` da soul.

### CLI (`os`)

```
os status                    home, souls e modelo padrão
os souls                     lista as souls
os soul <id>                 config e arquivos de uma soul
os soul <id> ativa           define a soul ativa
os chat <soul> <prompt>      roda opencode run headless na soul
os migrate <src>             migra almas do SLC-OS
os import-sc <src>           importa Segundo Cérebro
os memory <soul> index       indexa pasta da soul no memory.db
os memory <soul> search <q>  busca RAG
os memory <soul> status      contagem de chunks e grafo
os graph <soul> list         entidades/relações/observações
os costs                     resumo de custos
os agenda add|list           gerenciamento de agenda
os voice                     pipeline de voz (VAD + STT + TTS)
os backup                    ZIP completo do perfil, RAG e conhecimento
os daemon [port]             inicia o daemon REST+WS (padrão 4310)
```

## Deploy

### PM2 (produção)

```bash
pm2 start ecosystem.config.cjs    # daemon com 2GB memória, autorestart
pm2 install pm2-logrotate         # rotação de log (10MB, 14 gerações, comprimido)
pm2 save                          # persiste estado
pm2 startup                       # habilita no systemd
```

- `pm2-support.service` habilitado — daemon sobrevive reboot
- `max_memory_restart: "2G"` (LangGraph + Xenova excediam 1G)

### Docker

```bash
docker compose up -d              # PostgreSQL (pgvector) + tunnel
```

- PostgreSQL com pgvector para embeddings
- Daemon roda nativamente (sem Docker) — serviço `daemon` no compose é opcional

### Cloudflare Tunnel

```bash
# Setup (uma vez por clone/máquina)
ln -s ~/.assistant-os/.env .env
echo "TUNNEL_TOKEN=<seu token>" >> ~/.assistant-os/.env

docker compose up -d tunnel
```

- Tunnel registrado: `assistente-os.coderstudio.club`
- `TUNNEL_TOKEN` nunca fica no `docker-compose.yml` — vem de `~/.assistant-os/.env` via symlink, cada instalação com o seu
- Cloudflare Access ativo (302 → login); service token pra bypass programático ainda pendente

### CI (GitHub Actions)

`.github/workflows/ci.yml` roda em todo push/PR pro `main`: `npm ci` → build → typecheck → test, com Postgres+pgvector como service container. Sem secrets (Ollama/WhatsApp/Telegram ficam desligados por padrão nos testes).

## Testes

```bash
npm test              # todos os workspaces (195 testes)
npm run typecheck     # tsc em todos os workspaces (0 erros)
npm run build         # build completo antes de testar
```

| Pacote | Testes | Status |
|--------|--------|--------|
| core | 75 | ✅ todos passando |
| daemon | 60 | ✅ todos passando |
| memory | 41 | ✅ todos passando |
| tools | 17 | ✅ todos passando |
| cli | 2 | ✅ todos passando |
| voice | 0 | — sem testes ainda |

**Total**: 195 testes, zero erros de build, suíte completa roda em ~1 minuto (não trava mais — travava indefinidamente até uma correção recente numa conexão órfã de teste). Testes de integração manual contra um daemon real (`*.live.ts`, não entram no `npm test`) rodam via `npm run test:live --workspace=@assistente-os/daemon`.

## Status

| Fase | Escopo | Status |
|------|--------|--------|
| **F1** | Núcleo, memória, migração, daemon, CLI, MCP | ✅ Concluída |
| **F2** | Agendador (tabela `agenda` + dispatch) | ✅ Concluída |
| **F3** | Ferramentas do agente (busca/memória/ação) | ✅ Concluída |
| **F4** | Hosting em produção (PM2 + Cloudflare Tunnel + CI) | Quase concluída — falta Google OAuth (Stitch MCP) e o service token do Cloudflare Access |
| **F5** | Plataforma de agentes: tool-calling no chat + canais WhatsApp/Telegram | Tool-calling e canais em produção; sessões multi-turno persistidas e skills por soul ainda não implementadas |
| **F6** | Segurança (auth de WebSocket/boot-guard), CI, responsividade/PWA, roteador com fallback real, FinOps + Spec Grill + `/llms.txt` | ✅ Concluída |

### Pendências

- Google OAuth (GCP project para Stitch MCP)
- Service token do Cloudflare Access (bypass programático pro domínio público)
- Sentry (error tracking)
- Prometheus/Grafana (métricas — hoje só `/infra/status` sob demanda)
- Sessões multi-turno persistidas (hoje cada prompt é isolado; a tabela `sessions` só conta turnos)
- Skills por soul (instruções declarativas)
- App Android (proposta: Capacitor empacotando o frontend atual — ver `docs/BACKLOG.md`)
- ADR-PRIV-001 (LGPD de famílias) com pendências datadas em aberto

Backlog detalhado e histórico de decisões: [docs/BACKLOG.md](docs/BACKLOG.md).

## Docs

- [Arquitetura](docs/ARCHITECTURE.md)
- [LangGraph](docs/LANGGRAPH.md)
- [MCPs](docs/MCPS.md)
- [Providers gratuitos](docs/FREE_PROVIDERS.md)
- [Backlog](docs/BACKLOG.md)
- [Quick Start](QUICKSTART.md)
- [ADRs](docs/adr/)
