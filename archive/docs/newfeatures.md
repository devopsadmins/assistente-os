# Assistente OS — Especificação Técnica

Sistema de **Comando & Controle (C&C) de agentes autônomos ("Almas")**: plataforma local-first, API-first e orientada a eventos para orquestração de múltiplas personas, execução assíncrona de tarefas de backend, consumo de ferramentas via **MCP**, **roteamento multi-modelo** de LLMs e **inspeção da janela de contexto** de qualquer agente.

Esta spec descreve a stack **real** do projeto — Node/TypeScript, SQLite nativo (`node:sqlite`), sem Docker — e marca explicitamente o que **já está implementado** (✅) versus o que é **requisito novo** (🆕). Referências a código apontam para os arquivos canônicos.

---

## 1. Pilares arquiteturais

### P1 — Ingestão de eventos e webhooks

Processamento assíncrono de eventos com validação criptográfica e persistência de estado **antes** do despacho.

- ✅ **Auth do daemon:** `Bearer` token (`ASSISTENTE_OS_DAEMON_TOKEN`) validado com `timingSafeEqual` em `packages/daemon/src/server.ts:588`.
- 🆕 **Assinatura HMAC:** middleware dedicado para webhooks de entrada (ex.: `X-Aos-Signature: sha256=<hex>` calculada sobre o body com `node:crypto` `createHmac`), com replay protection (timestamp + janela) e comparação em tempo constante.
- 🆕 **Tabela `events`** no `kernel.db` com estado `pending → processing → completed | failed` persistido antes do despacho (ver §4).
- 🆕 **Endpoint `POST /events`** no daemon: valida assinatura, persiste o evento, responde `202 Accepted` imediatamente e despacha para o agendador/runner em background (sem fila externa; despacho in-process sobre SQLite).

### P2 — Agendamento e rotinas

Rotinas operacionais modeladas como tarefas determinísticas em código, despachadas por agendador local.

- ✅ **Agendador:** `packages/core/src/scheduler.ts` — classe `Scheduler` com `listPending()`/`runNext()` sobre a tabela `agenda` do `kernel.db`; executa `opencode run --model <tier>/<model>` via `execSync`.
- ✅ **Modelo de dados:** `agenda (id, ts, soul, title, body, due_at, done, done_at)` em `packages/core/src/kernelDb.ts:55`.
- 🆕 **Processo contínuo:** loop/daemon de tick (ex.: `setInterval` ou cron via SO) que enche `agenda` a partir de um catálogo de rotinas em código e consome `runNext()` respeitando concorrência = 1 por soul.
- 🔭 **DAGs** (dependências entre rotinas): escopo futuro, fora desta fase.

### P3 — Almas (personas multi-tenant)

Isolamento estrito de personas. Cada Alma tem identificador próprio, `soul.md`, história de sessão e memória persistente.

- ✅ **Estrutura de soul:** pasta em `~/.assistant-os/souls/<id>/` com `config.json` + `perfil.md`, `contexto.md`, `licoes.md`, `pessoas.md`, `soul.md`, `sessoes/` e `sources/` (`packages/core/src/souls.ts:23`).
- ✅ **Config da soul:** `config.json` com `name`, `description`, `provider`, `models` e `dailyLimit` (`souls.ts:4`).
- ✅ **Modo assistido:** chat com alma via daemon (`POST /souls/:id/chat`) e slash commands nativos do opencode.
- ✅ **Modo autônomo:** disparado pelo agendador (P2) e, futuramente, por eventos (P1).
- ✅ **Memória:** RAG em `packages/memory` (`memory.db`: `chunks`, `entities`, `relations`, `observations`), embeddings Ollama com degradação literal, gate de relevância configurável (`ASSISTENTE_OS_RELEVANCE_*`).

### P4 — Barramento de ferramentas via MCP

- ✅ **MCP local `assistente-os`:** `packages/tools` (JSON-RPC 2.0 sobre stdio) expondo o kernel. Ferramentas: `souls_list`, `soul_context`, `soul_chat`, `soul_anotar`, `soul_decidir`, `soul_licao`, `memory_search`, `memory_index`, `memory_status`, `graph_list`, `costs_summary`, `router_status`.
- ✅ **MCPs remotos:** `stitch` (Google, OAuth), `cloudflare`, `vercel`, `azure-devops` (ver `docs/MCPS.md`).
- ✅ **Controle de permissões:** delegação ao harness do opencode (permission rules); segredos via `{env:VAR}`, nunca em arquivos versionados.

### P5 — Buffer Inspector & telemetria de contexto

Inspeção dos tokens exatos, system prompt composto e contexto injetado na janela de qualquer agente.

- ✅ **Base existente:** `GET /souls/:id/context` já retorna o contexto concatenado (`server.ts:260`); o runner já executa `opencode run --format json --print-logs`, que emite o contexto montado em JSON (`runner.ts:52`).
- 🆕 **Endpoint `GET /souls/:id/buffer`:** amplia `/context` retornando, além do texto, a contagem de tokens (aproximada, ex.: 4 chars/token, ou via contagem real se o run expuser), os arquivos carregados com caminho e o system prompt composto (prefixo de alma + RAG + instrução, montado em `server.ts:311-348`).
- 🆕 **Telemetria:** registro da montagem do contexto por chamada (arquivos lidos, tokens, gate de relevância) na nova tabela `execution_logs` (§4) e broadcast WS de eventos de telemetria.

---

## 2. Stack tecnológica

| Camada | Tecnologia | Status |
|---|---|---|
| Runtime | **Node.js ≥ 22.16** (`node:sqlite`) | ✅ |
| Monorepo | npm workspaces (`core`, `memory`, `daemon`, `tools`, `cli`) | ✅ |
| API | `node:http` REST + WebSocket manual (sem dependências), porta padrão `4310` | ✅ |
| Persistência | SQLite nativo: `kernel.db` (custos, roteamento, agenda, eventos) + `memory.db` (RAG/grafo) | ✅ |
| Agendador | `Scheduler` local sobre tabela `agenda` | ✅ |
| Camada agêntica | `opencode run` headless (`--format json --print-logs`) | ✅ |
| Roteador | local-first em degraus `local (Ollama) → zen (OpenCode Zen) → soul` | ✅ |
| MCP | `packages/tools` (stdio) + remotos (stitch, cloudflare, vercel, azure-devops) | ✅ |
| Observabilidade | Logs estruturados + WS; `cost_calls`/`router_history` no `kernel.db` | ✅ |
| Telemetria externa | Sentry, Prometheus/Grafana | 🔭 F4 |
| Orquestração | Docker Compose + Caddy, CI/CD GitHub Actions → VPS | 🔭 F4 (ver §5) |

---

## 3. Roteamento multi-modelo

- ✅ Degraus **`local` → `zen` → `soul`** decididos por `selectRoute` (`packages/core/src/router.ts`) e registrados em `router_history`.
- ✅ **7 providers Zen** (`zen-sousa`, `zen-devocional`, `zen-iecsjc`, `zen-evertongame`, `zen-escritor`, `zen-iso`, `zen-avancei`), chaves via `{env:ZEN_*_API_KEY}` no `.env` da home; modelos free (ex.: `nemotron-3-ultra-free`).
- 🆕 **Mapeamento soul → provider** ("a quem pertence"), pendente em `docs/ARCHITECTURE.md:71` — decisão de produto, adiada.
- 🆕 **Limites de execução:** `max_turns` e teto orçamentário por sessão (ver §5).

---

## 4. Arquitetura de dados

### `kernel.db` (`packages/core/src/kernelDb.ts`)

| Tabela | Status | Colunas |
|---|---|---|
| `cost_calls` | ✅ | `id, ts, soul, provider, model, input_tokens, output_tokens, cost, status, note` |
| `router_history` | ✅ | `id, ts, soul, tier, provider, model, status, latency_ms, reason` |
| `agenda` | ✅ | `id, ts, soul, title, body, due_at, done, done_at` |
| `events` | 🆕 | `id, ts, type, payload, signature, status ('pending'|'processing'|'completed'|'failed'), attempt, created_at, processed_at` |
| `sessions` | 🆕 | `id, soul, started_at, ended_at, prompt_count, max_turns, budget_cap` |
| `execution_logs` | 🆕 | `id, session_id, soul, ts, prompt_hash, model, tier, files_loaded, tokens_in, tokens_out, context_size_chars, verdict, status` |

### `memory.db` (`packages/memory`)

- ✅ `chunks` (índice RAG idempotente por soul+doc_key), `entities`, `relations`, `observations` (grafo).

### Souls (filesystem)

- ✅ `souls/<id>/{config.json, perfil.md, contexto.md, licoes.md, pessoas.md, soul.md, sessoes/, sources/}`.

---

## 5. Governança e segurança

- ✅ Autenticação do daemon por `Bearer` token; **🆕** HMAC para webhooks (P1).
- ✅ Custos imutáveis por chamada em `cost_calls`.
- 🆕 **Teto orçamentário por sessão:** enforce do `dailyLimit` da soul (campo já existe em `souls.ts:14`, hoje **sem enforcement**) e de um teto por sessão consultando `SUM(cost_calls.cost)` do dia.
- 🆕 **`max_turns` por sessão:** limite de iterações agênticas no chat, configurável por soul (`config.json`) com padrão seguro; estouro corta a execução e registra em `execution_logs`.
- ✅ Segredos somente em `.env` da home (`~/.assistant-os/.env`), fora do git.

---

## 6. Entregáveis

### E1 — Blueprint do monorepo (✅ existente)

```
assistente-os/
├─ packages/
│  ├─ core/        kernel: config, souls, kernel.db, custos, roteador, agendador, migração
│  ├─ memory/      RAG (chunks+embeddings) e grafo em SQLite
│  ├─ daemon/      REST + WebSocket; executa `opencode run` headless; interface web em web/
│  ├─ tools/       servidor MCP (stdio) expondo o kernel
│  └─ cli/         comando `os` (status, souls, chat, memory, migrate, costs, daemon)
├─ docs/           ARCHITECTURE.md, MCPS.md, adr/, graphify-out/
└─ package.json    workspaces + scripts (build, test, typecheck, os)
```

**Configuração do daemon** (não há Docker): `AOS_HOST` (padrão `127.0.0.1`), `ASSISTENTE_OS_DAEMON_TOKEN` (obrigatório fora de localhost), `ASSISTENTE_OS_HOME` (padrão `~/.assistant-os`), `ASSISTENTE_OS_RELEVANCE_*` (gate de relevância).

### E2 — API Gateway (daemon)

`packages/daemon/src/server.ts` — rotas:

| Método | Rota | Status | Descrição |
|---|---|---|---|
| GET | `/health` | ✅ | status + souls |
| GET | `/souls` | ✅ | lista |
| GET | `/souls/:id` | ✅ | detalhe |
| GET | `/souls/:id/context` | ✅ | perfil/contexto/licoes/pessoas/soul.md concatenados |
| GET | `/souls/:id/buffer` | 🆕 | buffer inspector (P5): system prompt composto + tokens + arquivos |
| GET | `/souls/:id/memory/status` | ✅ | chunks e grafo |
| POST | `/souls/:id/memory/search` | ✅ | busca RAG com gate de relevância (409 em modo recusar) |
| GET | `/souls/:id/graph` | ✅ | entidades/relações/observações |
| GET | `/souls/:id/health` | ✅ | saúde da soul |
| POST | `/souls/:id/chat` | ✅ | roda opencode headless (prompt, model, timeoutSeconds, memorizar) |
| POST | `/souls/:id/anotar` `/licao` `/decidir` | ✅ | escrita de memória (openclaw-style) |
| POST | `/souls/:id/limpar` | ✅ | limpeza de sessões antigas |
| GET | `/costs`, `/router/status` | ✅ | custos e degraus do roteador |
| POST | `/events` | 🆕 | ingestão de webhook HMAC (P1) |
| WS | `/` (upgrade) | ✅ | hub de eventos JSON (`chat.done`, telemetria) |

### E3 — Engine de agentes

- ✅ `packages/daemon/src/runner.ts` — `runOpenCode`: spawn do `.exe` real no Windows (`shell:false`), transmite stdout/stderr em tempo real, corta no `timeoutSeconds` (1–600s).
- ✅ `packages/core/src/scheduler.ts` — `Scheduler.runNext()`: carrega item da `agenda`, executa `opencode run`, marca `done`.
- 🆕 **Controles:** injeção de `max_turns` e teto orçamentário na montagem do prompt (`server.ts:311-348`) e corte em execução; registro em `execution_logs`.
- 🆕 **Dispatch de eventos (P1):** consumidor do `events` em background (polling do `kernel.db` com janela de `attempt`) → `Scheduler`/chat.

### E4 — Modelo de dados

- ✅ `kernelDb.ts` (tabelas existentes §4).
- 🆕 Migração incremental aditiva: `CREATE TABLE IF NOT EXISTS events/sessions/execution_logs` no mesmo `openKernelDb` (padrão já usado), sem reescrever o schema atual.

### E5 — CI/CD

- ✅ Testes e typecheck locais: `npm test` e `npm run typecheck` (workspaces).
- 🔭 **F4 (hosting):** pipeline GitHub Actions proposto — `npm ci` → `typecheck` → `test` → deploy na VPS via SSH com reinicialização controlada do daemon (systemd) e Caddy como proxy/TLS. Sem Docker; deploy é do Node + PM2/systemd.

---

## 7. Conformidade (Padrões de Engenharia v4.0)

Perfil declarado: **AI-3** (agente executa ações reversíveis + delega tarefas) — classificação via `standards_classify_profile`, produto **multitenant** (souls isoladas).

Requisitos a fechar antes de produção (gates §6):

- [ ] ADR de adoção com perfil AI-3 e owners (técnico/negócio/risco).
- [ ] Modelo de isolamento declarado no ADR + suíte de testes cross-tenant (evidência de gate).
- [ ] Limites de custo, tokens, tempo, passos e concorrência (🆕 §5).
- [ ] Execution manifest reproduzível por release; registro de modelo/prompt/policy/tools/fontes de contexto.
- [ ] Fallback e kill switch testados (degradação RAG offline já existe; falta teste de corte por budget/turns).
- [ ] Inventário de IA e classificação de risco; telemetria sem vazamento de dados (logs estruturados).

Rastreabilidade: `ai/protocols` (MCP), `ai/context-rag-memory` (tiered/RAG), `ai/agent-harness` (limites e policy), `core/api-data` (API/eventos).

---

## 8. Roadmap

| Fase | Escopo | Status |
|---|---|---|
| **F1** | Núcleo, memória, migração, daemon, CLI, MCP | ✅ Concluída |
| **F2** | Agendador (tabela `agenda` + dispatch) — parcial; **🆕** loop contínuo, eventos/HMAC, buffer inspector, `max_turns`/teto | Em andamento |
| **F3** | Ferramentas do agente (busca, memória, ação) | Pendente |
| **F4** | Hosting + CI/CD (GH Actions → VPS), Sentry/Prometheus, MCP stitch em produção | Parcial (MCP validado) |
