# Backlog: Integração RAG Avançada

## Objetivo
Consolidar todas as melhorias de RAG (tanto da Fase 1 LangChain quanto melhorias gerais) em um fluxo unificado de indexação e busca semântica.

## Partes da Integração RAG

### ✅ 3.1: Indexação Vetorial Unificada
- [ ] Criar `packages/memory/src/rag-indexer.ts`
- [ ] Unificar `memory_index` + embeddings LangChain em um único fluxo
- [ ] Suporte a: PDFs, markdown, código, documentos diversos
- [ ] Idempotência já existente + novos tipos de documento

### ✅ 3.2: Busca Semântica Avançada
- [ ] Melhorar `memory_search` para usar embeddings da LangChain por padrão
- [ ] Manter fallback literal quando necessário (configurável via env)
- [ ] Adicionar reranking opcional de resultados
- [ ] Permitir busca hibrida: semântica + keywords

### ✅ 3.3: Filtros e Metadados Avançados
- [ ] Busca filtrada por `soul`, data, tipo de documento
- [ ] Suporte a metadados enriquecidos nos chunks indexados
- [ ] Filtros por relevância, categoria, fonte

### ✅ 3.4: Agentes RAG com LangGraph (Integração Fase 2)
- [ ] Agente que: pergunta → busca RAG → avalia se precisa de mais info → busca novamente → gera resposta final
- [ ] Loop controlado (máx. 3 iterações de busca)
- [ ] Rastreamento de fontes/citas em respostas

### ✅ 3.5: Prompt Engineering para RAG
- [ ] Template de prompt RAG padrão: "Use the following context to answer the question: ..."
- [ ] Template para citações: incluir source do chunk na resposta
- [ ] Template para "não sei" quando contexto insuficiente

### ✅ 3.6: Observabilidade e Métricas RAG
- [ ] Métricas: taxa de acerto, tempo de busca, tamanho do contexto, relevância média
- [ ] Logs de quais chunks foram selecionados e por quê
- [ ] Painel simples para monitorar qualidade do RAG

### ✅ 3.7: Feature Flags RAG
- [ ] Variáveis de ambiente:
  - `RAG_ENABLED` = true/false
  - `RAG_USE_LANGCHAIN_EMBEDDINGS` = true/false
  - `RAG_HYBRID_SEARCH` = true/false (semântica + keywords)
  - `RAG_MAX_ITERATIONS` = número máximo de loops agente
- [ ] Condicionar execução baseada nos flags

## Critérios de Aceitação da Integração RAG
- [ ] Busca semântica via LangChain embeddings melhora precisão em > 15% vs literal
- [ ] Busca híbrida (semântica + keywords) cobre mais casos de uso
- [ ] Agente RAG com LangGraph resolve queries em até 3 iterações
- [ ] Citas/fonts são incluídas automaticamente nas respostas
- [ ] Nenhum breaking change em tools existentes (`memory_search`, `memory_index`)
- [ ] Cobertura de testes mantida

## Migração Gradual
1. Manter `memory_search`/``memory_index` funcionando como estavam
2. Adicionar novo fluxo LangChain/RAG como opcional (`RAG_USE_LANGCHAIN_EMBEDDINGS=true`)
3. Quando validado, tornar o novo fluxo o padrão
4. Remover código legado após validação em produção