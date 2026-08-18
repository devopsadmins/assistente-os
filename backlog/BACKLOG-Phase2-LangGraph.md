# Backlog: Fase 2 - LangGraph Integration

## Objetivo
Adicionar LangGraph ao Assistente OS para criar agentes com estado, fluxos cíclicos e fluxo de trabalho graf-based.

## Partes da Integração

### ✅ 2.1: Instalação de Dependências
- [ ] Executar: `npm install @langgraph/langgraph`
- [ ] Verificar tipos TypeScript e compatibilidade
- [ ] Atualizar `package.json` com nova dependência

### ✅ 2.2: Definição de Estado do Agente
- [ ] Criar `packages/memory/src/agent-state.ts`
- [ ] Definir interface `AgentState` com campos: `memory`, `entities`, `current_step`, `context`, `chat_history`
- [ ] Mapear campos para o grafo existente (entities/relations/observations por `soul`)

### ✅ 2.3: Nós (Nodes) do Grafo
- [ ] `retrieve_node`: Busca no grafo de memória (utilizar `listEntities`, `listRelations`, `listObservations`)
- [ ] `generate_node`: Chamada LLM com contexto do estado atual
- [ ] `tool_node`: Execução de tools/MCP existentes (adapter do `handleToolCall`)
- [ ] `should_continue`: Decisão de continuar fluxo ou finalizar baseado em critérios

### ✅ 2.4: Construção do Workflow (StateGraph)
- [ ] Criar `packages/memory/src/agent-workflow.ts`
- [ ] Definir grafo com edges condicionais:
  - `retrieve → generate → tool_execute → generate` (loop se precisar mais info)
  - `generate → END` quando resposta satisfatória
- [ ] Definir entry point: `retrieve`
- [ ] Compilar grafo com `.compile()`

### ✅ 2.5: Integração com Tools MCP Existente
- [ ] Adaptar `handleToolCall` para ser chamado como nó no LangGraph
- [ ] Mapear resultados do tool de volta ao estado do agente
- [ ] Manter compatibilidade com RPC JSON/MCP existente

### ✅ 2.6: Persistência de Estado
- [ ] Utilizar PostgreSQL existente para persistir `AgentState` entre sessões
- [ ] Campo `soul` como identificador de contexto/estado
- [ ] Estratégia de TTL/limpeza de estados antigos

### ✅ 2.7: Feature Flag e Integração
- [ ] Adicionar variável `LANGGRAPH_ENABLED` (env)
- [ ] Condicionar inicialização do grafo baseado no flag
- [ ] Documentar padrão de uso: quando usar LangGraph vs fluxo atual

### ✅ 2.8: Testes e Validação
- [ ] Testar agente solo: pergunta → resposta sem loop
- [ ] Testar agente com loop: pergunta → tool → mais contexto → resposta final
- [ ] Testar persistência: salvar estado, reiniciar, continuar de onde parou
- [ ] Rodar testes existentes: `npm run test --workspaces --if-present`

## Critérios de Aceitação da Fase 2
- [ ] Agente consegue manter contexto entre múltiplas rotações de LLM
- [ ] Fluxos cíclicos funcionam (volta para retrieve quando nötig)
- [ ] Tools MCP são invocados corretamente dentro do grafo
- [ ] Estado persiste corretamente entre sessões do mesmo `soul`
- [ ] Nenhum breaking change em APIs públicas existentes