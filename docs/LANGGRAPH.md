# LangGraph no Assistente OS

Visão geral da integração LangGraph com streaming, mode routing e UI web.

## Arquitetura

```
[START] → [retrieve] → [generate] ↷ [tools] → [generate] → [END]
```

O StateGraph usa `AgentState` com messages, context, iterationCount, e toolResults.

## Modos de execução

| Modo | maxIterations | ragTopK | ragRatio | Uso |
|---|---|---|---|---|
| `fast` | 2 | 3 | 0.3/0.7 | Perguntas simples, respostas rápidas |
| `auto` | 3 | 4 | 0.5/0.5 | Padrão — router decide automaticamente |
| `pro` | 5 | 5 | 0.6/0.4 | Tarefas complexas, multi-step |

### Routing automático

`routeFromPrompt()` analisa o prompt e retorna `RoutingDecision`:
- **fast**: prompts curtos (<500 chars), sem keywords de complexidade
- **pro**: prompts >500 chars, ou contendo keywords como "tabela", "scrape", "passo a passo", "análise completa"
- **auto**: padrão quando não há explicitMode

## Streaming

### API interna

```typescript
// Generator que yielding a cada step do StateGraph
for await (const event of runAgentStream(pool, soul, prompt, threadId, tools)) {
  // event: { node: string, state: AgentStateType, ts: number }
}

// Runner que acumula steps e chama callback
const result = await runLangGraphAgentStream(pool, {
  soul, prompt, threadId, onStep: (step) => {
    // step: { node, ts, iterationCount, messageCount, lastContent, toolCalls }
  }
});
```

### WebSocket broadcast

O daemon broadcasta `graph.step` via WebSocket a cada step:
```json
{
  "type": "graph.step",
  "soul": "main",
  "node": "generate",
  "iterationCount": 1,
  "messageCount": 3,
  "ts": 1692000000000
}
```

## Tools disponíveis

11 tools LangChain wrapam as ferramentas do Assistente OS:

| Tool | Descrição |
|---|---|
| `memory_search` | Busca vetorial na memória da soul |
| `memory_index` | Indexa a pasta da soul no memory.db |
| `memory_status` | Status de chunks e grafo |
| `graph_list` | Lista entidades/relações/observações |
| `observation_add` | Adiciona observação ao grafo |
| `soul_anotar` | Anota item cronológico |
| `soul_licao` | Registra lição aprendida |
| `soul_decidir` | Grava decisão (ADR) |
| `agenda_add` | Agenda tarefa |
| `agenda_list` | Lista tarefas |
| `costs_summary` | Resumo de custos |

## Endpoints REST

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/souls/:id/chat` | Chat com LangGraph (tier=langgraph) |
| `GET` | `/souls/:id/langgraph/status` | Status do LangGraph para a soul |
| `GET` | `/souls/:id/langgraph/history` | Histórico de execuções |

### Exemplo de chat

```bash
curl -X POST http://localhost:4310/souls/main/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Use memory_status para verificar a memória", "tier": "langgraph"}'
```

### Resposta

```json
{
  "ok": true,
  "text": "A soul main possui 42 chunks indexados...",
  "tier": "langgraph",
  "mode": "auto",
  "provider": "langgraph",
  "toolCalls": [
    {
      "name": "memory_status",
      "args": {},
      "result": "chunks: 42, entities: 15..."
    }
  ]
}
```

## UI Web

A aba **LangGraph** no painel lateral mostra:

- **Seletor de modo**: auto/fast/pro
- **SVG do grafo**: visualização do StateGraph com cores neon
- **Step tracker**: últimas 10 etapas com timestamps
- **Tools panel**: ferramentas executadas na última iteração

### Mode toggle no chat

Botões auto/fast/pro acima do input de chat. O modo selecionado é enviado no body do POST:
```json
{
  "prompt": "...",
  "tier": "langgraph",
  "mode": "pro"
}
```

## Testes

| Tipo | Arquivo | Qtd |
|---|---|---|
| Unit (agent-workflow) | `packages/memory/src/test/agent-workflow.test.ts` | 14 |
| Unit (orchestrator-router) | `packages/daemon/src/test/orchestrator-router.test.ts` | 17 |
| Integration (REST) | `packages/daemon/src/test/langgraph-rest-full.test.ts` | 18 |
| Integration (stream) | `packages/daemon/src/test/langgraph-stream.test.ts` | 10 |
| Shell | `packages/daemon/src/test/test-langgraph-stream.sh` | 18 |

### Rodar testes

```bash
npm run build && npm run typecheck

# Unit tests (sem DB)
node --test packages/memory/dist/test/agent-workflow.test.js
node --test packages/daemon/dist/test/orchestrator-router.test.js

# Integration tests (requer daemon + Ollama)
node --test packages/daemon/dist/test/langgraph-rest-full.test.js
node --test packages/daemon/dist/test/langgraph-stream.test.js

# Shell tests
bash packages/daemon/src/test/test-langgraph-stream.sh
```
