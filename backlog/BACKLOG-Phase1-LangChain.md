# Backlog: Fase 1 - LangChain Integration

## Objetivo
Adicionar LangChain ao Assistente OS para melhorar as capacidades de RAG com embeddings padronizados, chains e prompt templates.

## Partes da Integração

### ✅ 1.1: Instalação de Dependências
- [ ] Executar: `npm install @langchain/core @langchain/community`
- [ ] Verificar se tipos TypeScript estão incluídos
- [ ] Atualizar `package.json` com novas dependências

### ✅ 1.2: Wrapper de Embeddings Ollama
- [ ] Criar `packages/memory/src/embedders-langchain.ts`
- [ ] Mapear `OllamaEmbedder` existente para `OllamaEmbeddings` da LangChain
- [ ] Exportar wrapper pelo `packages/memory/src/index.ts`
- [ ] Manter compatibilidade com embedder atual (`OllamaEmbedder`)

### ✅ 1.3: Chain de RAG Padrão
- [ ] Criar `packages/memory/src/rag-chain.ts`
- [ ] Implementar fluxo: `pergunta → retrieve (semântica) → format → LLM → resposta`
- [ ] Utilizar `ChatOllama` ou modelo OpenAI configurável
- [ ] Integrar com `memory_search` existente (fallback literal)
- [ ] Adicionar template de prompt para diferentes tipos de consulta

### ✅ 1.4: Prompt Templates
- [ ] Criar templates para: factual, coding, analysis, summarization
- [ ] Permitir overwriting via variáveis de ambiente ou parâmetros
- [ ] Integrar com `ChatOllama` da LangChain

### ✅ 1.5: Testes e Validação
- [ ] Rodar testes existentes: `npm run test --workspaces --if-present`
- [ ] Validar que `memory_search` ainda funciona com/without LangChain
- [ ] Testar chain RAG end-to-end com modelo Ollama

### ✅ 1.6: Feature Flag
- [ ] Adicionar variável `LANGCHAIN_ENABLED` (env)
- [ ] Condicionar imports e execução baseados no flag
- [ ] Documentar como habilitar/desabilitar

## Critérios de Aceitação da Fase 1
- [ ] Embeddings gerados pela LangChain são compatíveis com o storage PG existente
- [ ] Chain RAG retorna respostas melhores/iguais às atuais
- [ ] Nenhum breaking change em APIs públicas existentes
- [ ] Cobertura de testes mantida ou aumentada