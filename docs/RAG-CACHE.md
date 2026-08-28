# Cache do RAG

`retrieveContext` (`packages/memory/src/rag-chain.ts`) tem duas camadas de cache.
Ambas degradam em silêncio e têm TTL curto porque a memória da soul muda com
reindex.

## 1. Cache exato (sempre ligado)

Chave `sha1(limit + RAG_RERANK + injectionMode + query)` → `RagContext`
serializado, TTL 60s, via `cache` do core (Redis com fallback em memória).
Acerta só quando a pergunta é **byte-a-byte igual** — cobre voz, retries de UI e
turnos repetidos. Um hit vem com `cacheHit: "exact"`.

## 2. Cache semântico — T2.2 (**desligado por default**)

Acerta quando o *embedding* da pergunta está a ≥ `threshold` de cosseno de uma
pergunta recente com os **mesmos** parâmetros de recuperação (`limit`,
`RAG_RERANK`, `injectionMode`, soul, pool). Um hit vem com `cacheHit: "semantic"`.

| Env | Default | Efeito |
|---|---|---|
| `RAG_SEMANTIC_CACHE` | `off` | `on` / `1` / `true` liga |
| `RAG_SEMANTIC_CACHE_THRESHOLD` | `0.85` | cosseno mínimo p/ hit (clamp 0.5–0.999) |
| `RAG_SEMANTIC_CACHE_TTL` | `60` | TTL das entradas em s (clamp 1–3600) |

Detalhes:

- **Só em memória do processo.** A matemática vetorial não cabe no KV do Redis;
  é cache de latência, não fonte de verdade. Multi-instância = cada uma tem o seu.
- **Sem checagem de `updated_at`** — o TTL (default 60s, igual ao cache exato) é o
  limite de obsolescência após reindex.
- Caps: 64 entradas por bucket, 256 buckets; evicção do mais antigo.
- **Não usar em geração determinística.** O runner do `os rag eval` e qualquer
  caller de artefato (AIIA/família) passam `retrieveContext(..., { semanticCache: false })`.
- Métrica: `aos_rag_cache_total{result="miss|exact|semantic"}` (incrementada no
  `chat.ts`). Ligar em staging, olhar a taxa de `semantic` e o custo de embedding
  poupado antes de ligar em produção.

Módulo: `packages/memory/src/rag-semantic-cache.ts`
(`semanticCacheConfig`, `ragSemanticCacheGet/Set`, `cosineSim`).
