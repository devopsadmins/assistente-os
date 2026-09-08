# Busca híbrida do RAG (RRF)

`search()` (`packages/memory/src/indexer.ts`) por padrão é vetorial pura: pgvector
(HNSW, distância de cosseno) com fallback sequencial para `ILIKE` só quando a
busca vetorial não gera embedding ou retorna zero linhas — nunca roda os dois
motores juntos.

**Busca híbrida (**`RAG_HYBRID_SEARCH`**, desligada por default)** roda a busca
vetorial e uma busca full-text nativa do Postgres em paralelo e funde os dois
rankings via Reciprocal Rank Fusion (RRF), em vez de escolher um dos dois.

| Env | Default | Efeito |
|---|---|---|
| `RAG_HYBRID_SEARCH` | `off` | `on` / `1` / `true` liga |
| `RAG_HYBRID_RRF_K` | `60` | constante `k` do RRF (menor = mais peso ao topo do ranking) |

## Como funciona

1. **Full-text**: coluna gerada `chunks.tsv` (`tsvector`, `to_tsvector('portuguese', ...)`,
   migration `0023_chunks_fulltext`) + índice GIN. Query via
   `websearch_to_tsquery('portuguese', ...)` e `ts_rank_cd`.
2. **Vetorial**: inalterada — mesma query HNSW já usada na busca padrão.
3. **Fusão**: `reciprocalRankFusion(vectorRows, fulltextRows, k, limit)` soma
   `1/(k+rank)` por lista em que cada `doc_key` aparece (não usa os scores
   originais — cosseno e `ts_rank_cd` não são comparáveis em escala) e ordena
   pelo score fundido. Resultado vem com `method: "hybrid"`.

Quando `RAG_HYBRID_SEARCH` está `off` (default), o comportamento é idêntico ao
anterior — vetorial → fallback `ILIKE`. Ligar a flag não muda nada além de
`search()`; `rag-confidence.ts` e `rag-injection.ts` operam sobre o resultado
fundido normalmente.

## Como medir antes de ligar em produção

```bash
RAG_HYBRID_SEARCH=on npm run os rag eval <soul> --hybrid --record
os rag eval <soul> --history   # comparar hit@1/hit@5/MRR com e sem --hybrid
```

Mesmo padrão de `RAG_RERANK`/`RAG_SEMANTIC_CACHE`: fica OFF até medição em
corpus real mostrar ganho (ver `docs/ROADMAP.md`, lista de toggles a medir).

Módulo: `packages/memory/src/indexer.ts`
(`hybridSearchConfig`, `reciprocalRankFusion`, `fullTextSearch`).
