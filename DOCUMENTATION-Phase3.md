# Documentação: Fase 3 - RAG Avançado

## 📅 Status: CONCLUÍDA

### Módulo `packages/memory/src/advanced-rag.ts`

#### `hybridSearch(pool, soul, query, limit)`
- Busca combinada: 70% embeddings semântica + 30% keywords literal
- Returns: Array com `semanticScore`, `keywordScore`, `combinedScore`, `method`
- Cases de uso: Quando precisar combinar busca neural com busca tradicional

#### `indexSoul(pool, soul, homePath)`
- Indexação automática de soul
- Funcionalidades:
  - Extração de entidades via regex
  - Criação de observações das sentenças
  - Relações baseadas em menções co-ocorrentes
  - Stats de processamento (chunks, entidades, relações, observações)
  - Métricas de tempo de processamento
- Returns: `IndexingResult` avec `chunksIndexed`, `entitiesCreated`, `relationsCreated`, `observationsCreated`, `processingTimeMs`, `errors`

#### `advancedRagSearch(pool, soul, query, limit)`
- Busca Radr integrada com chain padrão
- Returns: `answer`, `sources` enriquecidos, `model`, `query`, `searchMethod`

#### Exportações
```typescript
export { hybridSearch, indexSoul, advancedRagSearch };
export type { IndexedChunk, IndexingResult };
```

#### Casos de Uso

```typescript
// 1. Busca híbrida
const results = await hybridSearch(pool, 'soul-123', 'minha pergunta', 5);

// 2. Indexar soul completamente
const result = await indexSoul(pool, 'soul-123', '/caminho/da/soul');

// 3. Busca Radr avançada
const ragResult = await advancedRagSearch(pool, 'soul-123', 'minha pergunta', 5);
```