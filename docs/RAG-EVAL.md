# Avaliação de recuperação do RAG (`os rag eval`)

Mede a qualidade do retrieval com um conjunto rotulado (query → documento
esperado). Sem isto, "ligamos o reranker" não é auditável — não há número de
antes/depois. Épico C do plano de RAG audit-readiness.

## Métricas

| Métrica | Significado |
|---|---|
| `hit@1` / `hit@3` / `hit@5` | fração de casos em que algum doc esperado apareceu no top-1 / top-3 / top-5 |
| `MRR` | Mean Reciprocal Rank — média de `1/posição` do primeiro acerto (0 se não achou) |
| `recall@5` | média por caso de `|docs esperados no top-5| / |docs esperados|` |

`os rag eval` sai com código 1 se `hit@1 < --min-hit1` (default 0.7) — serve de
gate em CI ou pré-merge.

## Estado atual (2026-08-27)

- **Golden set real:** `~/.assistant-os/rag-golden.jsonl` — 23 casos sobre a
  hub-knowledge-base da Dimastec (soul `consultoria_ia`). Fora do repo (dados de
  cliente).
- **Baseline (`--rerank off`):** hit@1 **73,9%** · hit@3 87,0% · hit@5 95,7% ·
  MRR 0,809 · recall@5 84,8%. Números completos e análise: `docs/adr/ADR-RAG-001.md` §6.
- **`--rerank cross-encoder`:** o scorer em `packages/memory/src/rerank.ts` foi
  corrigido (T1.4) e roda de fato. O modelo default
  `Xenova/ms-marco-MiniLM-L-6-v2` é só-inglês e **piora** o corpus PT-BR
  (hit@1 73,9% → 56,5%). Para PT-BR use
  `RAG_RERANK_CE_MODEL=Xenova/bge-reranker-base` — CE multilíngue com build ONNX,
  verificado (Etapa 4 do refino): carrega e pontua par PT-BR corretamente.
  `RAG_RERANK_BUDGET_MS` (default 30 s) abandona o rerank se a consulta estourar
  o orçamento. Decisão atual no código: `RAG_RERANK=off` — a medição
  `off`×`bge-reranker-base` no corpus real (abaixo) é o que autoriza flipar.
- **Gate:** o CI do PR trava só a fixture sintética (`rag-eval.test.ts`). O eval
  do corpus real é **passo manual** — `os rag eval consultoria_ia --min-hit1 <piso>`
  antes de qualquer release que toque embedder / índice / config de RAG. Cole a
  saída em `docs/adr/ADR-RAG-001.md` §6. (O workflow self-hosted foi removido na
  Etapa 2 do refino — POC não tem runner.)

## Formato do golden set (`.jsonl`)

Uma linha por objeto JSON. `//` no início da linha = comentário.

```jsonl
{"kind":"case","id":"api-jooq","soul":"consultoria_ia","query":"padrão de DAO multi-tenant no hub-api","expect_path_substr":["hub-api-patterns.md","hub-api-rules.md"]}
{"kind":"case","id":"web-bff","soul":"consultoria_ia","query":"toda chamada à API Java passa por route handler","expect_path_substr":["hub-web-patterns.md"],"min_top1_score":0.6}
```

- `expect_path_substr` — o caso acerta se **alguma** dessas substrings casar o
  `path` de algum chunk recuperado.
- `min_top1_score` (opcional) — exige score mínimo do 1º resultado para contar `hit@1`.
- Linhas `{"kind":"doc","path":"...","body":"..."}` só existem na fixture de CI
  (`packages/memory/eval/rag-golden.sample.jsonl`), que monta um corpus toy e o
  indexa antes de rodar. Um golden set real tem só linhas de caso — os docs vêm
  da soul já indexada (`os memory <soul> index`).

## Uso

```bash
# fixture de exemplo (não precisa de soul indexada — mas os casos usam a soul __eval__,
# então serve só de smoke test da fixture via `node --test`, não pelo CLI)
os rag eval

# golden set real da instalação (~/.assistant-os/rag-golden.jsonl), filtrando por soul
os rag eval consultoria_ia

# comparar cenários de rerank (gera os números do ADR-RAG-001)
os rag eval consultoria_ia --rerank off
os rag eval consultoria_ia --rerank cross-encoder   # roda; modelo default piora PT-BR (ver "Estado atual")
RAG_RERANK_CE_MODEL=<ce-multilingue> os rag eval consultoria_ia --rerank cross-encoder
os rag eval consultoria_ia --rerank llm      # requer Ollama

# arquivo e limiar custom
os rag eval --file ./meu-golden.jsonl --min-hit1 0.8
```

`--rerank` seta `RAG_RERANK` no processo antes de rodar. Precisa do `@xenova/transformers`
baixado para `cross-encoder` (primeira execução baixa o modelo
`Xenova/ms-marco-MiniLM-L-6-v2`).

## Montar o golden set de uma soul

1. `os memory <soul> index` (garante o índice atualizado — Épico A remove órfãos).
2. Para cada consulta representativa que os usuários fazem, anote 1–3 substrings
   de path que **deveriam** aparecer.
3. Salve em `~/.assistant-os/rag-golden.jsonl` (fora do repo — dados do cliente).
4. Rode `os rag eval <soul>` e guarde a saída como evidência.

Alvo de auditoria: `hit@1 ≥ 0.7`, `recall@5 ≥ 0.8` no corpus real.
