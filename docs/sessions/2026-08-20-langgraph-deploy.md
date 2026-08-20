# Sessão 2026-08-20 — Deploy LangGraph tool-calling + Fix memory limit

## O que foi feito

### 1. Deploy do LangGraph tool-calling no VPS
- **Build local**: 0 TS errors, 88/88 testes passando.
- **Arquivos implantados**: `langgraph-tools.ts` (12 LangChain DynamicStructuredTool wrappers), `agent-workflow.ts` (ToolNode + bindTools + conditional edges), `agent-state.ts` (AgentToolCall, toolCalls/toolCallId), `langgraph-runner.ts` (useTools flag), `langgraph-tools-rest.test.ts` (13 REST testes).
- **Daemon reiniciado via PM2**: versão com tool-calling ativa.

### 2. Fix do memory limit (OOM kill)
- **Problema**: `max_memory_restart: "1G"` no `ecosystem.config.cjs` matava o daemon quando LangGraph + Xenova embeddings rodavam (excediam 1G).
- **Fix**: aumentado para `"2G"`.
- **Efeito**: daemon agora sobrevive a chamadas LangGraph completas.

### 3. Smoke tests executados com sucesso
- **Health check**: 200 OK, 13 souls listadas.
- **LangGraph simples** (`"tier": "langgraph"`): resposta em ~4s, `stdout: "Oi! Como posso ajudar você hoje?"`.
- **Tool-calling `memory_status`**: executada com sucesso, resultado retornado ao LLM.
- **Tool-calling `soul_anotar`**: executada com sucesso, anotação persistida.
- **Thread persistence**: turn 1 memoriza "42" → turn 2 recall → "O número secreto é 42" (MemorySaver checkpointing funcional).
- **Session limit**: `maxTurns: 10` por sessão (funcionando corretamente — testes consumiram os 10 turns).

### 4. BACKLOG.md atualizado
- Seção "LangGraph com tool-calling integrado" expandida com detalhes do deploy.
- F5.1 item 1 atualizado (langgraph tier agora tem tool-calling funcional).
- Roadmap F5 atualizado.

## Estado do sistema

- **PM2 daemon**: online, `max_memory_restart: 2G`, `pm2-save` feito.
- **systemd**: `pm2-support.service` enabled (sobrevive reboot).
- **Build**: 0 TS errors.
- **Testes**: 88/88 (core 55 + memory 20 + tools 13). Unitários de langgraph-tools: 3/10 passam sem DB; 7/10 precisam PostgreSQL.
- **Cloudflare tunnel**: registrado e conectado.

## Próximos passos

1. **F5.2 — Tool-calling no chat da interface**: campo `tier` + dropdown na UI.
2. **F5.3 — Canais de entrada**: WhatsApp/Telegram/e-mail via `POST /events`.
3. **F5.4 — Sessões multi-turno**: histórico persistido por sessão.
4. **CI/CD**: GitHub Actions para build/test/deploy automático.
5. **Google OAuth**: criar projeto GCP para Stitch MCP.

## Notas técnicas

- Ollama `qwen2.5-coder:3b` em CPU: ~4s para respostas simples, ~12s para tool-calling.
- `ToolNode` importado de `@langchain/langgraph/prebuilt` (não `@langchain/langgraph`).
- `ChatOpenAI` exige `apiKey: process.env.OPENAI_API_KEY || "ollama"`.
- `response.content` pode ser `string | ContentBlock[]`, sempre coerce via `typeof check + JSON.stringify`.
- Session limit: 10 prompts por sessão (configurável via `maxTurns` no config da soul).
