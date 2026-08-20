# ADR-AI-004 — Integração LangGraph com streaming, mode routing e UI web

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**

## 1. Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-AI-004` |
| Status | Aceita (2026-08-20) |
| Perfil de conformidade | AI-3 |
| Módulos normativos aplicáveis | ai-protocols, vendor-cloud |
| Owner técnico | agente assistente-os (Claude Code) |
| Owner de negócio | area de agentes |

## 2. Contexto

O assistente-os utiliza LangChain.js com StateGraph para orquestrar LLMs via Ollama. Antes desta decisão, o agente não possuía:

1. **Streaming em tempo real** — o chat retornava o resultado completo sem feedback intermediário.
2. **Mode routing** — não havia distinção explícita entre modos fast/auto/pro para diferentes níveis de complexidade.
3. **UI web para LangGraph** — a aba LangGraph não existia; não havia visualização do grafo de execução.

A integração LangGraph precisava de streaming via WebSocket, um router que selecione o modo de execução baseado na complexidade do prompt, e uma interface web para monitorar a execução do grafo em tempo real.

## 3. Decisão

Integrar LangGraph com streaming, mode routing e UI web:

1. **Streaming**: `runAgentStream()` em `packages/memory/src/agent-workflow.ts` — AsyncGenerator que yielding `{node, state, ts}` a cada step do StateGraph.
2. **Runner streaming**: `runLangGraphAgentStream()` em `packages/daemon/src/langgraph-runner.ts` — consome o generator, chama `onStep` callback, acumula `LangGraphStreamStep[]`.
3. **Mode routing**: `routeFromPrompt()` em `packages/daemon/src/orchestrator/router.ts` — analisa prompt (keywords, tamanho) e retorna `RoutingDecision` com `mode` (fast/auto/pro), config do modelo, e parâmetros do grafo.
4. **Endpoints REST**: `GET /souls/:id/langgraph/status` e `GET /souls/:id/langgraph/history`.
5. **WS broadcast**: chat handler chama `runLangGraphAgentStream` com `onStep` que faz `hub.broadcast({ type: "graph.step", ... })`.
6. **UI web**: aba `tab-langgraph` com SVG do grafo, seletor de modo, tracker de steps, e painel de tools executadas.
7. **Mode toggle**: botões auto/fast/pro no chat panel que enviam `mode` no corpo do POST `/chat`.

**Não muda:** schema SQLite, runner open-code existente, router de tiers (mantém compatibilidade).

## 4. Alternativas consideradas

| Alternativa | Motivo da rejeição |
|---|---|
| Streaming via SSE (Server-Sent Events) | WebSocket é mais adequado para comunicação bidirecional e já existe hub no daemon. |
| Router baseado em LLM (classificação via modelo) | Adiciona latência e custo; routing baseado em keywords é suficiente para fast/pro. |
| UI React separada | Complexidade desnecessária; HTML vanilla com SVG é mais leve e não requer build step. |

## 5. Consequências e controles

| Consequência | Impacto | Controle compensatório |
|---|---|---|
| Streaming em tempo real melhora UX significativamente. | alto | limits de timeout mantidos (300s default). |
| Mode routing pode classificar prompts incorretamente. | médio | modo auto (padrão) delega ao router; usuário pode forçar fast/pro manualmente. |
| WebSocket aumenta complexidade do daemon. | baixo | hub já existia; broadcast é fire-and-forget. |
| UI LangGraph expõe mais detalhes internos. | baixo | apenas visualização; sem ações de escrita via UI. |

## 6. Evidências exigidas

| Requisito/controle | Artefato | Local |
|---|---|---|
| Streaming generator | `packages/memory/src/agent-workflow.ts` (runAgentStream) | assistente-os/packages/memory/src/agent-workflow.ts |
| Runner streaming | `packages/daemon/src/langgraph-runner.ts` (runLangGraphAgentStream) | assistente-os/packages/daemon/src/langgraph-runner.ts |
| Mode router | `packages/daemon/src/orchestrator/router.ts` (routeFromPrompt, selectExecutionMode) | assistente-os/packages/daemon/src/orchestrator/router.ts |
| Endpoints REST | `packages/daemon/src/server.ts` (langgraph/status, langgraph/history) | assistente-os/packages/daemon/src/server.ts |
| UI web | `packages/daemon/web/index.html` + `app.js` + `app.css` | assistente-os/packages/daemon/web/ |
| Unit tests | 31 testes (14 agent-workflow + 17 orchestrator-router) | assistente-os/packages/*/src/test/ |
| Integration tests | langgraph-stream.test.ts, langgraph-rest-full.test.ts, test-langgraph-stream.sh | assistente-os/packages/daemon/src/test/ |

## 7. Gatilhos de reavaliação

- Mudança de modelo ou provider LLM.
- Adição de novos modos de execução (ex: deep, research).
- Mudança na arquitetura WebSocket do daemon.
- Revisão programada: 2027-02-20.

## 8. Aprovação

| Papel | Nome | Data | Assinatura/registro |
|---|---|---|---|
| Owner técnico | agente assistente-os (Claude Code) | 2026-08-20 | auto-registro |

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-08-20 | Aceita | Claude Code |
