# Assistente OS

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces com 6 pacotes, soul-based knowledge management, RAG + knowledge graph, LangGraph agent com tool-calling, interface web, pipeline de voz, e deploy em produção via PM2 + Cloudflare tunnel.

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

O daemon escuta em `127.0.0.1` por padrão. Para acesso remoto, defina `AOS_HOST` e `ASSISTENTE_OS_DAEMON_TOKEN`.

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│ opencode                                                     │
│   ├─ MCP assistente-os ─── packages/tools (stdio, 31 tools) │
│   └─ providers zen-* ──── 7 chaves OpenCode Zen (grátis)    │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/daemon (REST + WebSocket, porta 4310)               │
│   ├─ Chat com 4 tiers: local / zen / soul / langgraph        │
│   ├─ LangGraph agent com tool-calling (12 tools LangChain)   │
│   ├─ Pipeline de voz (VAD + STT + TTS)                       │
│   └─ Web interface (9 abas, tema cyberpunk)                   │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/core              packages/memory                   │
│  ~/.assistant-os/           memory.db (SQLite + pgvector)    │
│  ├─ souls/<id>/...           ├─ chunks + embeddings (RAG)    │
│  ├─ kernel.db (SQLite)       ├─ LangChain LCEL RAG chain     │
│  ├─ active.json              ├─ LangGraph agent workflow     │
│  └─ config.local.json        └─ entidades/relações (grafo)   │
└──────────────────────────────────────────────────────────────┘
```

**Princípios**: local-first (Ollama fallback), zero Docker obrigatório (só Postgres usa Docker), markdown como storage primário, PostgreSQL advisory locks para concorrência.

## Pacotes

| Pacote | Papel | Capacidades |
|---|---|---|
| `core` | Kernel | Config, souls, kernel.db (agenda/costs/events/sessions), roteador local-first com fallback, migração, content filter (12 padrões), temp vault, ADO client, sessões, monitores, auditoria |
| `memory` | RAG + Grafo | Chunks + embeddings (Ollama ou fallback ILIKE), LangChain LCEL RAG, LangGraph agent workflow com tool-calling, grafo de entidades/relações/observações, gate de relevância |
| `daemon` | REST + WS | API HTTP (30+ endpoints), WebSocket, LangGraph runner, agenda dispatch, events, pipeline de voz, browser automation, upload com zip-slip protection |
| `tools` | MCP server | 31 tools MCP (stdio) expostas ao opencode: memory, graph, soul, agenda, costs, ADO, browser, router, monitors |
| `cli` | Comando `os` | status, souls, soul, chat, migrate, import-sc, memory, graph, costs, agenda, daemon, voice, backup, help |
| `voice` | Pipeline de voz | VAD (hysteresis), AudioRecorder (sox), STT (Whisper local via @xenova/transformers), TTS (say.js) |

## Capacidades

### Soul System

Cada "soul" é um perfil vivo de conhecimento com markdown files (perfil, contexto, lições, pessoas, soul.md) em `~/.assistant-os/souls/<id>/`.

- **13 souls migradas**: cidadeplaza, consultoria_ia, desenvolvimento, escrita, gestaoobrigacoes, investimentos, iso, kinetiswan, main, ministro_louvor, segundo-cerebro, slcia, suriel
- **Config por soul**: provider, modelos, dailyLimit, maxTurns, permissões de agente
- **Active tracking**: `active.json` no home directory
- **Markdown memory**: anotar (notas diárias), registrarLicao (lições), decidir (ADR decisions)

### RAG + Knowledge Graph

- **Chunks + embeddings**: indexação de markdown/txt, Ollama embeddings ou fallback ILIKE
- **LangChain LCEL RAG**: `retrieveContext()` → `ChatPromptTemplate` → LLM
- **Grafo de conhecimento**: entidades, relações, observações em SQLite
- **Gate de relevância**: threshold 0.70 com modos (recusar/aviso/livre)
- **Busca híbrida**: vetorial + literal com scores

### LangGraph Agent

- **Tool-calling**: 12 tools LangChain wrapando ferramentas do Assistente OS
  - Memory: `memory_search`, `memory_index`, `memory_status`
  - Graph: `graph_list`, `observation_add`
  - Soul: `soul_anotar`, `soul_licao`, `soul_decidir`
  - Agenda: `agenda_add`, `agenda_list`
  - Costs: `costs_summary`
- **Thread persistence**: MemorySaver checkpoints, multi-turno com memória
- **Fluxo**: User → retrieveContext (RAG) → generate (LLM com tools) → ToolNode executa → generate → END
- **Modelo**: `qwen2.5-coder:3b` via Ollama (CPU, ~4s simples, ~12s com tools)

### Multi-tier Router

- **4 tiers**: `local` (Ollama) → `zen` (nuvens grátis) → `soul` (opencode) → `langgraph` (agente com tools)
- **Fallback automático**: sonda de saúde antes de executar, degraus seguintes se falhar
- **7 providers Zen**: zen-sousa, zen-devocional, zen-iecsjc, zen-evertongame, zen-escritor, zen-iso, zen-avancei
- **Health probing**: `GET /api/tags` no Ollama, zen/soul considerados disponíveis

### Segurança

- **Zero Trust permissions**: allowlist por soul para tools, skills, diretórios externos
- **Content filter**: 12 padrões (OpenAI, Anthropic, Azure PAT, GitHub, AWS, private keys, passwords, JWT, connection strings)
- **Temp vault**: credenciais em memória com purge automático
- **HMAC webhooks**: SHA-256 com verificação de timestamp
- **Zip-slip protection**: sanitização de nomes de arquivo no upload
- **Agent guardrails**: maxTurns, maxLoops, maxTokens, ragThreshold, dailyLimitTokens
- **Audit trail**: compliance ISO 42001

### Interface Web (9 abas)

| Aba | Descrição |
|-----|-----------|
| **C&C Node** | Dashboard com cards de stats, lista de souls com filtros (TODAS/ATIVA/INATIVAS), canvas de rede animado |
| **Chat** | Chat interativo com seletor de tier (local/zen/soul/langgraph), override de modelo, controles de voz, tool calls visíveis (args + resultados expandíveis) |
| **Memória** | Status de chunks, upload de arquivos/zips, slider de threshold, busca semântica |
| **Grafo** | Visualizador de entidades, relações e observações por soul |
| **LangGraph** | Seletor de modo (retrieve/generate/tools/full), visualização SVG do grafo, tracking de steps, histórico de tool calls |
| **Buffer** | Inspector do prompt montado: arquivos, chars, tokens estimados, verdict RAG |
| **Motores LLM** | Lista de modelos Ollama, status do router |
| **MCP** | 12 tools LangChain categorizadas (Memória, Grafo, Soul, Agenda, Custos) |
| **Telemetria** | Infraestrutura (daemon, Ollama, CPU, RAM, disco, Postgres), eventos, execuções, custos por soul, monitores de site |

### Pipeline de Voz

- **VAD**: Voice Activity Detection com hysteresis (threshold configurável)
- **Audio Recorder**: captura PCM via sox (16kHz, 16-bit mono)
- **STT**: Whisper via @xenova/transformers (100% local, português padrão)
- **TTS**: síntese de fala via say.js
- **Pipeline completo**: VAD detecta fala → grava áudio → transcreve → gera resposta → fala de volta

### REST API (30+ endpoints)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| GET | `/souls` | Lista todas as souls |
| GET | `/souls/:id` | Detalhes da soul |
| GET | `/souls/:id/context` | Contexto completo (perfil/contexto/lições/pessoas/soul.md) |
| POST | `/souls/:id/chat` | Chat com a soul (tier: local/zen/soul/langgraph) |
| POST | `/souls/:id/upload` | Upload de arquivos (zip-slip protected, 50MB, 30 arquivos) |
| GET | `/memory/status` | Stats de memória (chunks + grafo) |
| POST | `/memory/search` | Busca RAG com threshold |
| POST | `/memory/index/:soulId` | Indexar soul na memória |
| GET | `/graph/:soulId` | Grafo (entidades/relações/observações) |
| POST | `/graph/observation` | Adicionar observação ao grafo |
| GET | `/costs` | Resumo de custos por soul |
| GET | `/costs/detail/:soulId` | Histórico de custos detalhado |
| GET | `/agenda` | Listar itens da agenda (?status=pending/done/all) |
| POST | `/agenda` | Adicionar item na agenda |
| GET | `/events` | Listar eventos |
| POST | `/events` | Adicionar evento (HMAC signed) |
| GET | `/sessions` | Registros de sessão |
| GET | `/exec` | Log de execuções |
| GET | `/monitors` | Monitores de site |
| POST | `/monitors` | Adicionar monitor |
| POST | `/monitors/:id/check` | Verificar monitor agora |
| DELETE | `/monitors/:id` | Deletar monitor |
| GET | `/router/status` | Tiers do router + config Ollama |
| GET | `/mcp/status` | Status dos servidores MCP |
| POST | `/voice/toggle` | Ligar/desligar pipeline de voz |
| POST | `/voice/config` | Atualizar config de voz |
| GET | `/llm/models` | Listar modelos Ollama |
| POST | `/llm/proxy/*` | Proxy Ollama (tags, chat, generate, embeddings) |

### MCP Tools (31 tools)

**Memória**: `memory_search`, `memory_index`, `memory_status`
**Grafo**: `graph_list`, `observation_add`
**Soul**: `souls_list`, `soul_context`, `soul_chat`, `soul_anotar`, `soul_licao`, `soul_decidir`
**Agenda**: `agenda_add`, `agenda_list`
**Custos**: `costs_summary`
**Infra**: `router_status`, `action_execute`
**Monitores**: (via REST)
**Azure DevOps**: `ado_list_projects`, `ado_list_repositories`, `ado_list_work_items`, `ado_create_work_item`, `ado_get_work_item`, `ado_update_work_item`, `ado_list_pipelines`, `ado_run_pipeline`, `ado_list_pull_requests`, `ado_create_pull_request`
**Browser**: `browser_navigate`, `browser_click`, `browser_extract_text`, `browser_screenshot`, `browser_close`

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
pm2 save                          # persiste estado
pm2 startup                       # habilita no systemd
```

- `pm2-support.service` habilitado — daemon sobrevive reboot
- `max_memory_restart: "2G"` (LangGraph + Xenova excediam 1G)

### Docker

```bash
docker compose up -d              # PostgreSQL (pgvector) + daemon
```

- PostgreSQL com pgvector para embeddings
- Ollama container para LLM local
- Daemon roda nativamente (sem Docker)

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:4310
```

- Tunnel registrado: `assistente-os.coderstudio.club`
- Cloudflare Access ativo (302 → login)
- Service token pendente para bypass programático

## Testes

```bash
npm test              # todos os workspaces (88 testes)
npm run typecheck     # tsc em todos os workspaces (0 erros)
npm run build         # build completo antes de testar
```

| Pacote | Testes | Status |
|--------|--------|--------|
| core | 55 | ✅ todos passando |
| memory | 20 | ✅ todos passando |
| tools | 13 | ✅ todos passando (teardown pendente) |
| daemon | — | ⚠️ 3 testes pré-existentes desatualizados |

**Total**: 88 testes, zero erros de build.

## Status

| Fase | Escopo | Status |
|------|--------|--------|
| **F1** | Núcleo, memória, migração, daemon, CLI, MCP | ✅ Concluída |
| **F2** | Agendador (tabela `agenda` + dispatch) | ✅ Concluída |
| **F3** | Ferramentas do agente (busca/memória/ação) | ✅ Concluída |
| **F4** | Hosting + Stitch MCP em produção | ~60% (PM2+Docker+Tunnel+Souls prontos) |
| **F5** | Plataforma de agentes | F5.1-F5.2 concluídas (permissões + LangGraph tool-calling + UI) |

### Pendências

- Google OAuth (GCP project para Stitch MCP)
- CI/CD (GitHub Actions)
- Sentry (error tracking)
- Prometheus/Grafana (métricas)
- Multi-turno persistido (sessões com histórico)
- Skills por soul (instruções declarativas)

## Docs

- [Arquitetura](docs/ARCHITECTURE.md)
- [MCPs](docs/MCPS.md)
- [Backlog](docs/BACKLOG.md)
- [Quick Start](docs/QUICKSTART.md)
