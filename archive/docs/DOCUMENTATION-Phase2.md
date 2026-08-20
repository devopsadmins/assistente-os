# Documentação: Fase 2 - LangGraph Agentes

## 📅 Status: IMPLEMENTADO (Funcionalidades Utilitárias + StateGraph em Runtime)

### Funcionalidades Utilitárias Disponíveis

```typescript
// Criar estado inicial
const state = createInitialAgentState('soul-123');

// Adicionar mensagens
const withMsg = addUserMessage(state, 'qual é o meu contexto?');

// Adicionar resultado de tool
const withResult = addToolResult(state, 'tool execution result');

// Verificar limite de iterações
const isMax = checkMaxIterations(state);

// Incrementar contador
const next = nextIteration(state);

// Executar chain RAG
const ragResult = await executeRagChain(pool, 'soul-123', 'minha pergunta');

// Decidir próximo passo
const nextStep = decideNextStep(state);
// "__end__" | "generate" | "execute_tool"
```

### StateGraph (Runtime Testado)

```typescript
// Padrão que funciona em runtime:
// const annotation = Annotation.Root({ soul: "string", messages: [], context: "string", ... });
// const sg = new StateGraph(annotation);
// // add nodes, edges, compile()
// // const compiled = sg.compile();
// // executar com graph.invoke(state) ou graph.stream(state)

// Testado: graph.invoke(initialState) executa sucesso
```

### Estrutura do Grafo

```dot
DOT Format (GraphViz):
digraph G {
  rankdir=LR;
  node [shape=box style=filled color=lightblue];
  retrieve [label="retrieve"];
  generate [label="generate"];
  execute_tool [label="execute_tool"];
  END [shape=doublecircle label="END"];
  retrieve -> generate;
  generate -> execute_tool;
  execute_tool -> generate;
  generate -> END [style=dashed];
}

Mermaid Format:
graph TD
  A[retrieve] --> B[generate]
  B --> C[execute_tool]
  C --> B
  B:::conditional --> D[END]
:::conditional { border: 2px dashed; }

Plain Text Summary:
- Nós: retrieve, generate, execute_tool
- Arestas: retrieve→generate, generate→execute_tool, execute_tool→generate, generate→(END ou continuação)
- Fluxo: retrieve → generate → execute_tool → (loop) → generate → (se iterations > limit) → END
```

### createAgentGraph vs createSimpleAgentGraph

```typescript
// createAgentGraph(pool) - usa Annotation.Root para tipagem estruturada
// Funciona em runtime, types TypeScript podem precisar de ajustes

// createSimpleAgentGraph(pool) - usa annotation minimalista
// Útil para prototipagem/testes rápidos, aceita any no annotation
```

### Observação sobre Tipos

- O código funciona corretamente em runtime (testado com `node -e`)
- Definições de TypeScript podem precisar de ajustes conforme a versão exata do `@langchain/langgraph` (1.4.10)
- As funções utilitárias acima não dependem do StateGraph compilation e estão prontas para uso
```

<tool_call>
<function=bash>
<parameter=command>
ls /home/support/assistente-os/DOCUMENTATION-*.md