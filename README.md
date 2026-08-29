# Assistente OS

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces com 6 pacotes, soul-based knowledge management, RAG + knowledge graph, agente LangGraph com tool-calling, orquestração ORCA (modos de execução fast/pro + isolamento de tarefas em git worktree), interface web responsiva (PWA), canais WhatsApp/Telegram, pipeline de voz, e deploy em produção via PM2 + Cloudflare Tunnel + CI no GitHub Actions.

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
│   ├─ MCP assistente-os ─── packages/tools (stdio, 56 tools) │
│   └─ provider zen ──────── chaves OpenCode Zen em rodízio    │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│ packages/daemon (REST + WebSocket autenticado, porta 4310)   │
│   ├─ Chat com router local-first (local/zen/soul) + langgraph│
│   ├─ ORCA: orquestrador com modo fast/pro + mission runner   │
│   ├─ Worktree manager (git worktree isolado, merge L3-gated) │
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
│  ├─ workspaces/<taskId>/     ├─ LangGraph agent workflow     │
│  ├─ active.json              └─ entidades/relações (grafo)   │
│  ├─ cache em camadas (Redis + memória, opcional)             │
│  └─ .env (credenciais)                                       │
└──────────────────────────────────────────────────────────────┘
```

**Princípios**: local-first (Ollama fallback), zero Docker obrigatório (só Postgres usa Docker), markdown como storage primário, PostgreSQL advisory locks para concorrência. Credenciais de cada instalação (tokens, chaves de API, tunnel token) ficam só em `~/.assistant-os/.env` — nunca no repositório — para o mesmo código rodar em várias máquinas com credenciais próprias. Toda resposta de toda soul carrega uma diretriz FinOps fixa no system prompt (sem preâmbulo, sem repetir o pedido do usuário) — reduz tokens de saída sem flag de configuração. O montador de prompt (`buildPrompt`) ordena os blocos do mais estático para o mais volátil (diretriz → regras de ouro → persona → **índice** de skills → **corpo** das skills ativas → sessão → RAG → histórico) para maximizar o prefixo de bytes idêntico entre turnos (reuso de KV cache do Ollama; prefill medido em `aos_ollama_prefill_seconds`).

## Pacotes

| Pacote | Papel | Capacidades |
|---|---|---|
| `core` | Kernel | Config, souls (criação atômica + validação `SoulSpec`), kernel.db (agenda/costs/events/sessions), roteador local-first com fallback probado (fast e pro), agregação de uso/tokens por soul/mode/model (`getUsageSummary`), cache em camadas (Redis + fallback em memória, `cache.ts`), migração, content filter (12 padrões de segredo + detector de prompt injection: entrada + chunks de RAG), temp vault, ADO client, sessões, monitores, auditoria ISO/IEC 42001, golden rules com aprovação humana por código, gerador de AIIA.md, [Prompt Garden](docs/PROMPT-GARDEN.md) (prompts de pipeline versionados, hash no manifesto), [canvas de arquitetura por soul](docs/ARCHITECTURE-CANVAS-TEMPLATE.md) (`os soul <id> canvas`), catálogo de capabilities L1/L2/L3 (`policy.ts`), códigos de erro estáveis (`errors.ts`) |
| `memory` | RAG + Grafo | Chunks + embeddings (Ollama ou fallback Xenova/ILIKE), LangChain LCEL RAG, LangGraph agent workflow com tool-calling, grafo de entidades/relações/observações, gate de relevância |
| `daemon` | REST + WS | API HTTP (40+ endpoints, todos autenticados por Bearer token exceto `/health`), WebSocket autenticado, orquestrador ORCA (modo fast/pro dinâmico + mission runner), worktree manager (git worktree isolado por tarefa, merge local L3-gated), terminal sanitizer, LangGraph runner, agenda dispatch, events, canais WhatsApp/Telegram, pipeline de voz, browser automation, upload com zip-slip protection, log de debug de retrieval RAG (method/score por fonte) no audit trail |
| `tools` | MCP server | 56 tools MCP (stdio) expostas ao opencode: memory, graph, soul, agenda, costs, ADO, browser, worktree, router, monitores, guardian (golden rules + aprovação por código), AIIA, sales intelligence, spec grill |
| `cli` | Comando `os` | status, souls, soul, chat, migrate, import-sc, memory, graph, costs, agenda, worktree, guardian, skill, daemon, voice, backup, help |
| `voice` | Pipeline de voz | VAD (hysteresis), AudioRecorder (sox), STT (Whisper local via @xenova/transformers), TTS (say.js) |

Serviço auxiliar fora dos workspaces npm: `services/soul-rag-watcher` — observa `souls/*/` e pede `memory_index` via MCP quando `.md`/`.txt` mudam (zero dependência do monorepo, só stdio JSON-RPC), rodando como app separado no PM2.

## Capacidades

### Soul System

Cada "soul" é um perfil vivo de conhecimento com markdown files (perfil, contexto, lições, pessoas, soul.md) em `~/.assistant-os/souls/<id>/`.

- **16 souls ativas** nesta instalação: aprendizado, cidadeplaza, consultoria_ia, desenvolvimento, escrita, gestaoobrigacoes, grillsoul, investimentos, iso, kinetiswan, main, mente_inclusiva, ministro_louvor, segundo-cerebro, slcia, suriel
- **Permissões Zero Trust**: cada soul declara (ou herda `DEFAULT_ALLOWED_TOOLS`) a allowlist de tools que pode chamar, com wildcards (`memory:*`, `ado_*`)
- **Catálogo de capabilities L1/L2/L3** (`policy.ts`): cada tool tem um nível de risco fechado e versionado (leitura local, escrita local reversível, efeito externo/alto privilégio); `authorizeExecution()` combina autonomy da soul (`suggest`/`ask`/`auto`), `approvalPolicy` e budget numa decisão pura e testável
- **Criação atômica de souls** (`createSoulFull`): monta config + 5 arquivos de alma + 3 diretórios (`sessoes/`, `sources/`, `decisoes/`) num diretório temporário e só publica via `rename()` exclusivo — corrida no mesmo id nunca deixa diretório residual. Validação centralizada via `SoulSpec` (`soul-spec.ts`): limites de tamanho de arquivo (32KB) e total (128KB), até 20 skills, até 10 conectores, capabilities restritas ao catálogo conhecido, `planHash` determinístico para dry-run vs. commit
- **Config por soul**: provider, modelos, dailyLimit, maxTurns, guardrails de agente
- **Active tracking**: `active.json` no home directory
- **Markdown memory**: anotar (notas diárias), registrarLicao (lições), decidir (ADR decisions)
- **Skills por soul**: `SKILL.md` (frontmatter `name`/`description`/`keywords`/`tools` + corpo markdown) em `~/.assistant-os/skills/<name>/` (global) ou `~/.assistant-os/souls/<id>/skills/<name>/` (por-soul). A soul declara a allowlist em `agent.permissions.skills`; o `buildPrompt` injeta **sempre** o índice nome+description e **só o corpo** das que casam o prompt (matcher híbrido léxico + embedding, com auto-skip). `skill.tools` é advisório — não eleva o Zero Trust. Env: `SKILL_MATCH_THRESHOLD` (0.35), `SKILL_MAX_ACTIVE` (3), `SKILLS_ENABLED`. Tools `skill_list`/`skill_create` + `os skill list|show|create`.
- **AIIA.md por soul**: relatório de impacto algorítmico gerado sob demanda (tool `soul_generate_aiia`), compondo capabilities/guardrails efetivos, dados pessoais e base legal (quando a soul é do tipo `familia_<telefone>`) e regras de ouro ativas — 100% de dados já existentes no sistema, idempotente

### RAG + Knowledge Graph

- **Chunks + embeddings**: indexação de markdown/txt, Ollama embeddings ou fallback Xenova/ILIKE
- **LangChain LCEL RAG**: `retrieveContext()` → `ChatPromptTemplate` → LLM
- **Grafo de conhecimento**: entidades, relações, observações em Postgres
- **Gate de relevância**: threshold configurável com modos (recusar/aviso/livre)
- **Busca**: vetorial (pgvector 768, HNSW) → fallback literal ILIKE, com scores
- **Reranking** (opcional, `RAG_RERANK=cross-encoder|llm`, default `off`): busca um top-N amplo e reordena por relevância par (query, trecho) antes de cortar no top-K. Cross-encoder local ou juiz LLM via Ollama; auto-skip para ordem por score se o modelo não carregar. **O modelo default (`Xenova/ms-marco-MiniLM-L-6-v2`) é só-inglês e degrada corpora PT-BR** (medido em [ADR-RAG-001 §6](docs/adr/ADR-RAG-001.md)): aponte `RAG_RERANK_CE_MODEL` para um cross-encoder multilíngue antes de ativar
- **Cache do RAG**: exato (chave sha1, TTL 60s) + semântico opcional por cosseno de embedding (`RAG_SEMANTIC_CACHE=on`, default off) — ver [docs/RAG-CACHE.md](docs/RAG-CACHE.md)
- **Qualidade de recuperação medível**: `os rag eval` (hit@k / MRR / recall@5) contra golden set — ver [docs/RAG-EVAL.md](docs/RAG-EVAL.md)
- **Debug controlado de retrieval**: cada fonte recuperada carrega `method` (`semantic`/`literal`/`hybrid`) e `score`; o daemon grava isso no audit trail existente a cada chat com RAG — dá visibilidade sobre degradação silenciosa pra busca literal (ex.: embedder de indexação incompatível com o de consulta) sem precisar de infraestrutura de observabilidade nova
- **Testes de fidelidade RAG**: grounding lexical determinístico (sempre roda no CI) + juiz LLM opcional via Ollama (pergunta binária se a resposta é sustentada só pelo contexto recuperado; auto-skip quando Ollama não está disponível)

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
- **Chaves Zen em rodízio**: `ZEN_API_KEYS` (vírgula-separada; ou `ZEN_API_KEY_1..7`, ou `ZEN_API_KEY` única) — consumidas em round-robin por chamada em chat/RAG/LangGraph via `nextZenApiKey()`, espalhando o consumo entre até 7 chaves gratuitas em vez de amarrar chave a soul
- **Histórico imutável**: cada tentativa de roteamento fica registrada em `router_history` (kernel.db)

### ORCA — Orquestração

Camada de orquestração no daemon (`packages/daemon/src/orchestrator/`) que decide *como* uma tarefa é processada, isola execuções agênticas e mede o custo real.

- **Modo de execução dinâmico** (`orchestrator/router.ts`): seleciona `fast` vs. `pro` por prompt
  - **fast** (default): execução linear, modelo local leve, RAG pontual (top-K 3, só semântico), teto de 2 iterações, sem deep extraction
  - **pro**: busca híbrida 70/30 (semântica + literal), extração profunda de links/relações, até 5 iterações, modelo da soul ou zen
  - Gatilhos de `pro`: modo explícito do cliente, keywords de complexidade (scraping, análise, tabela, relação, pipeline, links — inclui keywords do Orca para análise de código), ou prompt > 500 chars (`LANGGRAPH_PRO_THRESHOLD_CHARS`)
- **Worktree Manager** (`tools/worktree-manager.ts`): cada tarefa agêntica roda numa git worktree isolada em `~/.assistant-os/workspaces/<taskId>` na branch `task/<taskId>`
  - `createWorktree` — idempotente (remove worktree/branch anteriores), setup de ambiente best-effort (copia `.env`, symlinks de cache/kernel.db)
  - `mergeLocally` — roda `npm run build --workspaces` + `npm test` na worktree, rebase na branch alvo, checkout + merge; rollback automático (abort) em qualquer falha. **Exige autorização L3** (`worktree_merge_locally`)
  - `destroyWorktree` — cleanup com `try/catch/finally` e `worktree prune` sempre executado. **Exige autorização L3** (`git_commit_push`)
  - Exposto por REST (`/api/worktree`), CLI (`os worktree`) e MCP (`worktree_create`, `worktree_merge_locally`, `worktree_destroy`)
- **Cost / Usage Tracking**: migração `0010` adiciona `prompt_tokens`, `completion_tokens`, `total_tokens`, `model_used`, `execution_mode` a `router_history`; `getUsageSummary()` agrega por soul, período, `mode` e `model` — servido em `GET /api/costs/usage` e `os costs usage`
- **`GET /api/capabilities`**: JSON estruturado com souls, tools MCP (com namespace), endpoints REST e missões operacionais — companheiro do `/llms.txt` para ingestão por agentes externos
- **Base do ORCA** (scaffolding, ainda não ligado ao fluxo de chat): Mission Runner (`orchestrator/mission-runner.ts`, missões compostas headless/guarded/full), Terminal Sanitizer (`tools/terminal-sanitizer.ts`, trunca saída de `npm test`/`git status`/`ls` para poupar tokens) e cache em camadas (`core/cache.ts`, Redis → memória)

### Segurança

- **Zero Trust permissions**: allowlist por soul para tools, skills, diretórios externos
- **API e WebSocket autenticados**: Bearer token em todas as rotas exceto `/health`; o WebSocket (que não aceita headers customizados) aceita o mesmo token via `?token=` na URL de conexão
- **Boot-guard**: recusa subir em host não-loopback sem token configurado, em vez de logar aviso e continuar exposto
- **Content filter**: 12 padrões de segredo (OpenAI, Anthropic, Azure PAT, GitHub, AWS, private keys, passwords, JWT, connection strings), mascarados nos dois sentidos (prompt do usuário e resposta do LLM)
- **Detecção de prompt injection**: 11 padrões heurísticos PT/EN (`prompt-injection.ts`) — "ignore instruções anteriores", extração de system prompt, jailbreak de roleplay (DAN), injeção de tag `[SYSTEM]`, payload base64 suspeito. Roda em duas frentes:
  - **Entrada direta** (`sanitizeUserPrompt`): loga no audit trail e, com `PROMPT_INJECTION_MODO=recusar`, bloqueia a chamada em severidade alta (default `aviso`, só loga).
  - **Conteúdo recuperado (indirect injection)**: cada chunk do RAG passa pela mesma heurística sobre o `body` antes de montar o contexto (`retrieveContext`, `runRagChain` e o LCEL). `RAG_INJECTION_MODO` (fallback `PROMPT_INJECTION_MODO`; default `aviso`) — com `recusar`, o chunk de severidade alta é **descartado do contexto** (a chamada não é abortada, pois é só uma fonte entre várias). Audit trail diferencia a origem: `source: "retrieved_chunk"` vs. `"user_input"`. Backstop: mesmo que um chunk escape da heurística, a instrução embutida não dispara tool L3 sem `authorizeExecution()` (`policy.ts`).
- **Aprovação humana imposta no Guardian**: propor uma regra de ouro (`guardian_promote_golden_rule`) gera um código de aprovação de 6 dígitos (hash SHA-256, nunca persistido em claro), enviado por Telegram (`GUARDIAN_APPROVAL_CHAT_ID`) com expiração (`GUARDIAN_APPROVAL_TTL_HOURS`, default 24h). `guardian_approve_rule`/`guardian_reject_rule` exigem esse código com comparação em tempo constante — o próprio agente LLM não consegue mais autoaprovar suas próprias propostas, mesmo tendo acesso às mesmas tools MCP. Aprovação alternativa via `os guardian approve/reject <id> <código>` no terminal
- **Temp vault**: credenciais em memória com purge automático
- **HMAC webhooks**: SHA-256 com verificação de timestamp
- **Zip-slip protection**: sanitização de nomes de arquivo no upload
- **Agent guardrails**: maxTurns, maxIterations, ragThreshold, dailyLimitTokens
- **Catálogo L1/L2/L3 versionado** (`policy.ts`): operações de worktree entram como L3 (`worktree_merge_locally`, `git_commit_push` — efeito irreversível/externo) e `annotate_diff` como L2; `authorizeExecution()` combina autonomy da soul, `approvalPolicy` e budget numa decisão pura
- **Audit trail**: compliance ISO/IEC 42001 (`logFullAuditEntry`), incluindo alertas de prompt injection (entrada e conteúdo recuperado) e debug de retrieval RAG
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
| GET | `/api/costs/usage` | Uso/tokens agregado por soul/mode/model (`?soul=&from=&to=`) |
| GET | `/api/capabilities` | Catálogo JSON estruturado (souls, tools MCP, endpoints, missões) |
| GET | `/api/manifest` | Execution manifest reproduzível (git sha, catálogo L1/L2/L3, hash de prompt por soul, migrações) — gate AI-3 |
| GET | `/metrics` | Exposição Prometheus (`aos_*`) — gate AI-3 / observabilidade |
| GET \| POST | `/api/worktree` | Lista/cria worktree isolada por tarefa |
| POST | `/api/worktree/:taskId/merge` | Build + testes + merge local (rollback automático) |
| DELETE | `/api/worktree/:taskId` | Destrói worktree e limpa refs git |
| GET | `/api/missions` | Lista missões compostas do Mission Runner (ORCA) |
| POST | `/api/missions/:id/run` | Executa a missão (`mission.step` via WS nas missões `full`) |
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

### MCP Tools (56 tools)

**Soul**: `souls_list`, `soul_context`, `soul_chat`, `soul_create` (L3, dry-run/commit por `plan_hash`), `soul_anotar`, `soul_licao`, `soul_decidir`, `soul_record_lesson`, `soul_get_lessons`, `soul_generate_aiia`
**Skills**: `skill_list`, `skill_create` (L3, dry-run/`plan_hash`, scope soul|global)
**Memória**: `memory_search`, `memory_index`, `memory_status`
**Grafo**: `graph_list`, `observation_add`
**Agenda**: `agenda_add`, `agenda_list`
**Custos/Infra**: `costs_summary`, `router_status`, `action_execute`
**Worktree**: `worktree_create`, `worktree_list`, `worktree_merge_locally` (L3), `worktree_destroy` (L3) — isolamento de tarefas agênticas paralelas via git worktree
**Mission Runner (ORCA)**: `mission_list`, `mission_run` (L3) — missões compostas headless/guarded/full (ingest + browser + agenda + auditoria Guardian)
**Guardian (golden rules)**: `guardian_audit_execution`, `guardian_promote_golden_rule`, `guardian_pending_rules`, `guardian_approve_rule`, `guardian_reject_rule`, `guardian_resend_approval_code`, `guardian_get_golden_rules` — `approve`/`reject` exigem o código de aprovação enviado por Telegram, nunca devolvido pelas próprias tools
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
os costs usage [--soul <id>] [--from <date>] [--to <date>]  uso/tokens agregado por mode/model
os agenda add|list           gerenciamento de agenda
os worktree create <taskId> [--base <branch>] [--soul <id>]  cria worktree isolada
os worktree merge <taskId> [--target <branch>]              merge local + build + testes
os worktree destroy <taskId>  destrói worktree e limpa refs git
os worktree list             lista worktrees ativas
os guardian pending          lista propostas de golden rule aguardando aprovação
os guardian approve <id> <código>  aprova (código enviado por Telegram)
os guardian reject <id> <código>   rejeita
os guardian resend <id>      gera e reenvia um novo código de aprovação
os voice                     pipeline de voz (VAD + STT + TTS)
os backup                    ZIP completo do perfil, RAG e conhecimento
os skill list|show|create    gerencia SKILL.md (global ou --soul <id>)
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
- Três apps no `ecosystem.config.cjs`: `assistente-os` (daemon principal), `assistente-os-backup` (one-shot, `cron_restart` 3x/dia), `soul-rag-watcher` (observa `souls/*/` e reindexa via MCP quando arquivos mudam — processo desanexado, sem dependência do monorepo)

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
- Cloudflare Access ativo (302 → login). Bypass programático (agentes/CI) via **service token** — procedimento completo (criar, autorizar na policy, guardar, usar, rotacionar) em [docs/CLOUDFLARE-ACCESS.md](docs/CLOUDFLARE-ACCESS.md). Não exige mudança de código no daemon; falta só a ação no dashboard Cloudflare + preencher `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`

### CI (GitHub Actions)

`.github/workflows/ci.yml` roda em todo push/PR pro `main`: `npm ci` → build → typecheck → test, com Postgres+pgvector como service container. Sem secrets (Ollama/WhatsApp/Telegram ficam desligados por padrão nos testes).

### Observabilidade

- **Métricas Prometheus**: `GET /metrics` (Bearer, prefixo `aos_`): `aos_chat_requests_total{soul,tier,mode,status}`, `aos_chat_latency_seconds` (histograma), `aos_tokens_total{soul,tier,kind,source}` (alimentado pelo FinOps do chat), `aos_agenda_queue_depth`, `aos_events_pending`, `aos_prompt_injection_alerts_total{severity,source}` (`source`: `user_input` | `retrieved_chunk`) + default metrics (event-loop lag, heap, GC).
- **Sentry**: erros não tratados do handler HTTP vão pro Sentry quando `SENTRY_DSN` está setado (no-op sem DSN); `beforeSend` roda o content-filter para não vazar segredo. `SENTRY_TRACES_SAMPLE_RATE` (default 0.1).
- **Stack local** (opcional): `docker compose --profile observability up -d` sobe Prometheus (`:9090`) + Grafana (`:3001`, dashboard "Assistente OS — visão geral" já provisionado). Configs em `ops/` (`prometheus.yml`, `rules.yml` com alertas de daemon-down / backlog de agenda / pico de prompt-injection / taxa de erro de chat).

## Testes

```bash
npm run build         # build completo antes de testar (os testes rodam sobre dist/)
npm test              # node --test em todos os workspaces (ordem: cli → core → daemon → memory → tools → voice)
npm run typecheck     # tsc em todos os workspaces (0 erros)
```

| Pacote | Testes | Status |
|--------|--------|--------|
| core | 211 | ✅ todos passando |
| daemon | 101 | ✅ todos passando |
| memory | 44 | ✅ todos passando |
| tools | 19 | ✅ todos passando |
| cli | 2 | ✅ todos passando |
| voice | 0 | — sem testes ainda |

**Total**: 377 testes, zero erros de build/typecheck (`npm test` completo em ~4-5 min). Um teste de fidelidade RAG usa um juiz LLM via Ollama e demora ~30-50s quando Ollama está disponível (auto-skip, quase instantâneo, quando não está — mesmo padrão já usado nos testes que dependem de Ollama real). Testes de integração manual contra um daemon real (`*.live.ts`, não entram no `npm test`) rodam via `npm run test:live --workspace=@assistente-os/daemon`.

`CacheService` (`core/test/cache.test.ts`) fecha a conexão Redis no `after()` (via `cache.close()`); sem isso o socket com reconnect do ioredis segura o event loop e, com `--test-timeout=0`, trava a run do pacote quando há Redis acessível.

## Status

| Fase | Escopo | Status |
|------|--------|--------|
| **F1** | Núcleo, memória, migração, daemon, CLI, MCP | ✅ Concluída |
| **F2** | Agendador (tabela `agenda` + dispatch) | ✅ Concluída |
| **F3** | Ferramentas do agente (busca/memória/ação) | ✅ Concluída |
| **F4** | Hosting em produção (PM2 + Cloudflare Tunnel + CI) | ✅ Concluída (service token do Cloudflare Access: procedimento em `docs/CLOUDFLARE-ACCESS.md`, ação no dashboard fora do escopo do repo) |
| **F5** | Plataforma de agentes: tool-calling no chat + canais WhatsApp/Telegram + skills por soul | ✅ Concluída — tool-calling e canais em produção; multi-turno endurecido (E2); skills por soul (`SKILL.md`, matcher híbrido, `skill_list`/`skill_create`, `os skill`) |
| **F6** | Segurança (auth de WebSocket/boot-guard), CI, responsividade/PWA, roteador com fallback real, FinOps + Spec Grill + `/llms.txt` | ✅ Concluída |
| **F7** | Governança: aprovação humana imposta no Guardian (código via Telegram), detecção de prompt injection, AIIA.md por soul, debug de retrieval RAG no audit trail, criação atômica de souls (`SoulSpec` + catálogo L1/L2/L3) | ✅ Concluída |
| **F8** | ORCA: modo fast/pro dinâmico, worktree manager via REST/CLI/MCP, cost/usage tracking, `/api/capabilities`, catálogo MCP com namespace | Concluída — E1–E10 (2026-08-27) fecharam o restante: Mission Runner ligado (REST `/api/missions` + MCP), Terminal Sanitizer + cache em produção, FinOps de tokens no chat |
| **F9** | Governança AI-3 + LGPD + observabilidade (roadmap E6/E8/E9) | ✅ Concluída (2026-08-27): `/metrics`, `/api/manifest`, manifest anexado no CI, suíte cross-tenant, kill-switch, `AI-INVENTORY.md`, gate de consentimento LGPD, anti-vazamento de telemetria; RACIs aceitas pelo owner |

### Pendências

Roadmap com spec por item e status: [docs/ROADMAP.md](docs/ROADMAP.md).

**E1–E10 implementados (2026-08-27)** — FinOps de tokens, endurecimento de multi-turno,
Mission Runner ligado (REST + MCP), Terminal Sanitizer + cache em produção,
`soul_create`/`worktree_list` no MCP, observabilidade (`/metrics` + Sentry),
gates AI-3 (cross-tenant, execution manifest, kill-switch, inventário de IA,
anti-vazamento de telemetria), LGPD (gate de consentimento + política de backup),
reranking de RAG opcional.

Feito (2026-08-27):

- **CI**: passo `Execution manifest` no workflow gera e anexa `manifest-<sha>.json`
  como artefato do build (`.github/workflows/ci.yml`).
- **Assinatura humana**: RACIs aceitas pelo owner (ADR-AI-003 §8, owners do
  `docs/AI-INVENTORY.md`, aceitação do ADR-PRIV-001, prazo P1/CFP, ADR dedicado
  do perfil AI-4 de famílias) — registrado como owner-accepted em 2026-08-27.

- **Chaves Zen**: rodízio round-robin (`ZEN_API_KEYS` / `ZEN_API_KEY_1..7`) por
  chamada em chat/RAG/LangGraph (`nextZenApiKey()`) — substituiu o mapa soul→chave,
  que era decisão de posse e ficou adiado.
- **RAG audit-readiness** (7 epics): higiene do índice (remove órfãos + `content_hash`),
  telemetria de LLM em todas as rotas (`recordLlmCall`), golden eval
  ([`os rag eval`](docs/RAG-EVAL.md)), latência do reranker instrumentada
  ([ADR-RAG-001](docs/adr/ADR-RAG-001.md)), embedder/rerank no hash do manifesto,
  screening de injection antes do rerank `llm`, proveniência `doc_key` no audit
  trail + aviso de índice defasado + `hnsw.ef_search` fixo.

Backlog do roadmap: **zerado** (E7 é ação no dashboard Cloudflare, fora do repo).

**Revisão de arquitetura (2026-08-28)** — [docs/ARCHITECTURE-REVIEW.md](docs/ARCHITECTURE-REVIEW.md),
backlog concluído: gate de compliance no CI, golden set de RAG + baseline,
conserto do reranker cross-encoder, Prompt Garden, cache semântico, canvas por
soul, escalonamento por confiança, reordenação do montador de prompt.
`RAG_RERANK` / `RAG_SEMANTIC_CACHE` / `ROUTER_ESCALATION` shipam **desligados**,
aguardando medição.

## Docs

- [Arquitetura](docs/ARCHITECTURE.md)
- [LangGraph](docs/LANGGRAPH.md)
- [MCPs](docs/MCPS.md)
- [Prompt Garden](docs/PROMPT-GARDEN.md) · [Canvas de Arquitetura por soul](docs/ARCHITECTURE-CANVAS-TEMPLATE.md)
- [Avaliação de RAG (`os rag eval`)](docs/RAG-EVAL.md) · [Cache do RAG](docs/RAG-CACHE.md)
- [Escalonamento por confiança do roteador](docs/ROUTER-ESCALATION.md)
- [Providers gratuitos](docs/FREE_PROVIDERS.md)
- [Roadmap de implementação](docs/ROADMAP.md)
- [Inventário de sistemas de IA](docs/AI-INVENTORY.md) · [Cloudflare Access](docs/CLOUDFLARE-ACCESS.md)
- [Quick Start](QUICKSTART.md)
- [ADRs](docs/adr/)
