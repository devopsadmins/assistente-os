# Assistente OS — Visão Técnica Completa do Sistema
**Data do snapshot:** 2026-08-22 · **Repo:** assistente-os @ main · **Para:** revisão de grupo técnico

---

## 1. Identidade do sistema

Copiloto residente **local-first, API-first** em Node.js/TypeScript, organizado como
monorepo **npm workspaces** (`packages/*`). Sem Docker para a aplicação (nativo);
Docker apenas para PostgreSQL/pgvector e túnel opcional (cloudflared).
Markdown em disco é a fonte canônica da verdade; bancos são índices derivados.

| Atributo | Valor |
|---|---|
| Runtime | Node ≥ 22.16 (env atual: v24.15.0), ESM, `NodeNext`, target ES2023 |
| Linguagem | TypeScript estrito; código/docs/commits em pt-BR |
| Dependências-chave | `@langchain/*` (core 1.2.8, langgraph 1.4.10), `pg`, `@xenova/transformers`, `pino`, `telegraf`, `say`; MCP próprio via JSON-RPC stdio |
| Porta padrão | 4310 (bind `127.0.0.1`; remoto exige `AOS_HOST` + `ASSISTENTE_OS_DAEMON_TOKEN`) |
| Home runtime | `~/.assistant-os/` (override: `ASSISTENTE_OS_HOME`) |

## 2. Arquitetura geral

```
opencode (agente interativo)
 ├─ MCP assistente-os ── packages/tools (stdio JSON-RPC 2.0)
 └─ providers zen-* ──── OpenCode Zen (@ai-sdk/openai-compatible)
        │
packages/daemon ── REST + WebSocket :4310, spawna `opencode run` headless
 ├─ LangGraph runner (fast/auto/pro) + UI web (PWA)
 ├─ Canais: WhatsApp (Baileys), Telegram (Telegraf), Voz (VAD→STT→TTS)
        │
packages/core (kernel)          packages/memory (RAG + grafo)
 ~/.assistant-os/souls/<id>/     memory.db (SQLite): chunks/entities/
 kernel.db (custos/agenda)       relations/observations
 PostgreSQL+pgvector (índice epistêmico derivado)
```

## 3. Pacotes

### 3.1 core — kernel
- **config.ts**: home, `.env` da home, tiers do roteador `local → zen → soul`.
- **souls.ts/alma.ts**: souls como pastas (`perfil/contexto/licoes/pessoas/soul.md`,
  `sessoes/YYYY-MM-DD.md`, `decisoes/*.md`); soul ativa em `active.json`.
- **kernelDb.ts**: `kernel.db` SQLite — `cost_calls` (custo imutável por chamada),
  `router_history`, `agenda`.
- **router.ts**: roteador em degraus; sonda barata (`GET /api/tags` Ollama) decide local vs zen.
- **security/temp-vault.ts**: singleton em memória p/ credenciais efêmeras +
  `purgeCredentials(taskId)` obrigatório no fim da tarefa.
- **security/content-filter.ts**: sanitização de resposta LLM.
- **governance/audit-trail.ts**: trilha de auditoria ISO/IEC 42001 (`logFullAuditEntry`).
- **governance/golden-rules.ts**: loop de autoaprendizado — incidentes de agente
  (`recordAgentIncident`), promoção automática após 3 reincidências do tópico,
  aprovação humana (`proposeRule/listPendingRules/approveRule/rejectRule`).
- **graph/state-checkpoint.ts**: guardrail `LANGGRAPH_MAX_ITERATIONS = 5`.
- **familias.ts**: domínio LGPD de famílias + sweep diário de retenção (ADR-PRIV-001).
- **migrations.ts**, **events.ts**, **entityQueue.ts**, **sessions.ts**, **monitors.ts**,
  **costs.ts**, **webhook.ts**, **ado.ts** (Azure DevOps), **migration.ts** (import SLC-OS).

### 3.2 memory — RAG + grafo de conhecimento
- **indexer.ts**: chunking de markdown/texto; indexação idempotente (UNIQUE soul+doc_key).
- **embedders.ts/embedder-local.ts**: Ollama → fallback local `@xenova/transformers`
  → literal ILIKE (degradação suave, sem quebrar o daemon).
- **rag-chain.ts / advanced-rag.ts / relevance.ts**: busca vetorial→literal com
  gate de relevância configurável (modos recusar/aviso/libre).
- **graph.ts / entity-extraction.ts**: grafo entidades/relações/observações;
  extração assíncrona via fila no daemon (loop 20s).
- **agent-workflow.ts / agent-state.ts**: LangGraph StateGraph com streaming;
  modos fast/auto/pro; teto de iterações 5.

### 3.3 daemon — API-first
- **server.ts**: HTTP puro `node:http` + `WsHub` WebSocket manual (handshake RFC6455,
  sem dependências); middleware Bearer timing-safe; `/health` público; estáticos PWA.
- **runner.ts**: `runOpenCode` spawna `opencode run --format json --print-logs`
  headless com timeout e captura NDJSON.
- **context.ts**: `buildPrompt()` — prefixo = regras de ouro ativas + identidade da
  alma (perfil/lições/sessão) + RAG com veredito; usado por chat/events/voice/agenda.
- **langgraph-runner.ts / langgraph-tools.ts**: execução do agente LangGraph contra
  tools REST; aba `tab-langgraph` na UI com SVG do grafo e step tracker.
- **orchestrator/router.ts**: `routeFromPrompt`/`selectExecutionMode` (fast/auto/pro).
- **orchestrator/sales-intelligence.ts**: ingest de reuniões + brief de closer.
- **Loops background (unref)**: agenda 30s, eventos 30s, extração de entidades 20s,
  monitores 60s, retenção familias 24h.
- **Rotas REST** (por domínio em `routes/*.ts`):
  - GET `/health`, `/souls`, `/souls/:id`, `/souls/:id/context`, `/souls/:id/buffer`,
    `/costs`, `/router/status`, `/infra/status`, `/agenda`, `/events`, `/monitors`,
    `/familias`, `/sessions/stats`, `/voice/status`, `/api/telegram/{status,messages}`,
    `/api/whatsapp/{status,messages,media/:id}`
  - POST `/souls/:id/chat`, `/souls/:id/upload`, `/agenda`, `/events`, `/monitors`,
    `/monitors/check`, `/familias`, `/voice/{start,stop}`,
    `/api/pipelines/{email-ingest,meeting-ingest}`, `/api/webhooks/whatsapp{,/approve}`,
    `/api/whatsapp/{send,transcribe}`, `/api/telegram/send`
- **tools/browser.ts**: automação Playwright headless com sessões por taskId,
  screenshot auditado (SHA-256) e fix dinâmico JS com cache de estratégia.

### 3.4 tools — servidor MCP (44 ferramentas)
JSON-RPC 2.0 sobre stdio: `initialize`, `ping`, `tools/list`, `tools/call`.
Catálogo atual: souls_list, soul_context, soul_chat, memory_{search,index,status},
graph_list, observation_add, costs_summary, router_status, action_execute,
soul_anotar/licao/decidir, soul_record_lesson, soul_get_lessons,
guardian_audit_execution, guardian_promote_golden_rule, guardian_pending_rules,
guardian_approve_rule/reject_rule/get_golden_rules, sales_ingest_meeting,
sales_get_lead_brief, agenda_add/list, ado_* (11: projects, repos, work items CRUD,
pipelines, PRs list/create), browser_* (8: navigate/click/extract/screenshot/close/
accessibility_tree/execute_fix/audited_screenshot).
- **Zero Trust:** `SOUL_SCOPED_TOOLS` + `authorizeTool(soulId, tool)` valida
  allowlist da soul (`resolveAllowedTools`); bloqueio registrado no audit-trail;
  tools de navegador usam fail-closed via `AGENT_SOUL_ID`.

### 3.5 cli — comando `os`
status, souls, soul <id> [ativa], chat, migrate <src>, memory <soul> index|search|status,
graph, anota/licao/decide, costs, agenda add|list, daemon [port], voice, backup,
import-sc, help. Atalho: `npm run os <args>`.

### 3.6 voice
Pipeline VAD → STT (Whisper) → TTS (`say`); endpoints `/voice/start|stop|status`;
opcional via env.

## 4. Persistência (3 camadas)

| Camada | Tecnologia | Papel | Autoridade |
|---|---|---|---|
| Souls | Markdown em `~/.assistant-os/souls/<id>/` | Contexto vivo (perfil, lições, sessões, decisões) | **Canônica** |
| Kernel | SQLite `kernel.db` | Custos imutáveis, router_history, agenda | Sistema |
| Epistêmica | PostgreSQL + pgvector + SQLite `memory.db` | Chunks RAG, embeddings, grafo | Derivada (reindexável) |

Falha de PG/Ollama ⇒ degradação para Markdown/literal sem interromper o daemon.

## 5. Segurança e governança

- Auth: Bearer token (`ASSISTENTE_OS_DAEMON_TOKEN`) timing-safe; WS aceita token via query string; mídia aceita `?token=` apenas em rotas `/media/`.
- Auditoria ISO/IEC 42001: toda chamada registrada; bloqueios de allowlist logados.
- Guardian: incidentes → reincidência ×3 no mesmo tópico → proposta de regra global → **aprovação humana** antes de propagar (golden-rules.md, AGENTS.md, índice ativo no prompt de todas as souls).
- Credenciais efêmeras só em `TempVault` (limites de capacidade anti-vazamento) com purga obrigatória.
- LGPD: ADR-PRIV-001 define base legal/retenção de familias; sweep diário elimina em cascata famílias vencidas.
- Sanitização de saída LLM (`sanitizeLLMResponse`) nas tools que retornam texto gerado.

## 6. Qualidade e testes

- Runner nativo `node --test` sobre `dist/` (**build obrigatório antes de testar**).
- PostgreSQL com pgvector necessário p/ suíte completa (`run-tests.sh` roda subconjunto sem DB).
- Suítes: core (12 arq., incl. temp-vault, audit-trail, golden-rules, content-filter),
  memory (RAG/relevância/LangGraph unit ×14), daemon (rotas, browser, router ×17,
  meeting-ingest), tools (MCP end-to-end), cli (backup).
- Live tests LangGraph renomeados `*.live.ts` fora do glob (exigem daemon real);
  `npm run test:live --workspace=@assistente-os/daemon`.
- Sem linter/formatter no repo (política: não adicionar sem pedido).

## 7. Operação/deploy

- PM2 `ecosystem.config.cjs`: app `assistente-os` (daemon, restart 10x/60s,
  kill_timeout 5s, restart_delay 3s) + backup agendado; **sem env hardcoded** —
  tudo via `~/.assistant-os/.env` lido por `loadDotEnv()`.
- Migrações PG aplicadas no boot do daemon com retry ×10 não-bloqueante.
- Docs vivos: `docs/ARCHITECTURE.md`, `docs/LANGGRAPH.md`, `docs/MCPS.md`,
  ADR-AI-003 (loop de almas + gate de relevância), ADR-AI-004 (LangGraph/streaming/UI),
  ADR-PRIV-001 (retenção familias).

## 8. Estado atual e frentes abertas

Concluído: 12 souls migradas (~770 arquivos); daemon validado com opencode real;
RAG indexado (ex.: soul main ≈2618 chunks); agendador F2 completo (REST/CLI/MCP);
LangGraph integrado com UI; guardian/golden-rules operantes; canais WhatsApp/Telegram;
browser automation auditada.

Abertos (docs/BACKLOG.md + plano aprovado pendente de implementação):
OAuth real do Stitch MCP (bearer estático hoje); mapeamento soul→provider zen;
implementação FinOps concisa + `spec_grill_plan` + `GET /llms.txt`
(`docs/plan_finops_grillme_llmstxt.md`, aprovado, ainda NÃO implementado no código);
F4 hosting/Stitch em produção.
