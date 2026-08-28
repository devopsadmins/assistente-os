# ADR-RAG-001 — Reranker de RAG: ativação por ambiente e medição de latência

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**

## 1. Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-RAG-001` |
| Status | Aceita (2026-08-27) — medição do §6 feita: **manter `off`**; cross-encoder inoperante (bug em `rerank.ts`) |
| Perfil de conformidade | AI-3 |
| Módulos normativos aplicáveis | ai-protocols, observability |
| Owner técnico | agente assistente-os (Claude Code) |
| Owner de negócio | área de agentes |
| Relacionados | ADR-AI-004 (LangGraph); `docs/RAG-EVAL.md`; Epics C/D/F do plano RAG audit-readiness |

## 2. Contexto

O estágio de reranking do RAG (`packages/memory/src/rerank.ts`, entregue no roadmap E10)
está implementado — 3 modos (`off` / `cross-encoder` local via
`Xenova/ms-marco-MiniLM-L-6-v2` / `llm` via Ollama), auto-skip em falha de modelo —
mas `rerankConfig()` tem default `"off"` e nenhum deploy o liga. Numa auditoria de RAG,
"temos um reranker" sem número de antes/depois não é evidência.

Antes desta decisão faltavam: (1) forma de medir o ganho de qualidade; (2) medição da
latência que o rerank adiciona; (3) registro do modo ativo no manifesto de execução.

## 3. Decisão

1. **Default `off` no código permanece.** As suítes determinísticas não podem depender
   de rerank ativo (o `cross-encoder` baixa um modelo; o `llm` chama o Ollama). A
   ativação é por `~/.assistant-os/.env` (`RAG_RERANK=cross-encoder`), por instalação.
2. **Latência medida.** `retrieveContext` cronometra o estágio e devolve `rerankMs`
   no `RagContext`; o daemon expõe `aos_rag_rerank_seconds{mode}` (histograma
   Prometheus) e grava `rerankMode`/`rerankMs` na entrada de audit trail
   `### Auditoria — RAG: retrieval debug`.
3. **Manifesto.** `buildExecutionManifest` inclui `rag.rerankMode` **dentro do hash**
   (ADR/Epic E) — dois deploys com `RAG_RERANK` diferente têm hashes diferentes.
4. **Screening antes do rerank.** No modo `llm` o corpo dos chunks ia ao Ollama antes
   da triagem de prompt injection; `retrieveContext` foi reordenado
   (search → `screenRetrievedChunks` → `rerank`) — Epic F.
5. **Validação por golden set.** `os rag eval <soul> --rerank off|cross-encoder`
   (`docs/RAG-EVAL.md`) produz hit@k / MRR / recall@5; o §6 registra os números que
   autorizam a ativação em produção.

## 4. Alternativas consideradas

- **Flipar o default para `cross-encoder`** — rejeitada: quebra o CI sem serviço de
  modelo e torna os testes não-determinísticos.
- **RRF (Reciprocal Rank Fusion)** — não se aplica: RRF funde listas ranqueadas
  paralelas (BM25 + vetor); o pipeline atual é híbrido sequencial (vetor → fallback
  literal), não fusão. O cross-encoder resolve o caso "isca lexical no topo".
- **Segundo LLM como guardrail dedicado** — fora de escopo (custo/latência); o
  screening heurístico + `authorizeExecution` já são a defesa em profundidade.

## 5. Consequências e controles

- Latência adicional por consulta (cross-encoder sobre `RAG_RERANK_TOPN=20` em CPU):
  a ser quantificada no §6 antes do go-live. Se o p95 exceder o orçamento de UX,
  reduzir `RAG_RERANK_TOPN` ou manter `off`.
- Cache do RAG (`retrieveContext`, TTL 60s) já inclui `RAG_RERANK` na chave — trocar
  o modo invalida o cache corretamente.
- `RAG_RERANK=llm` compartilha o Ollama com o tier local do chat — usar só onde há
  folga de capacidade.

## 6. Evidências exigidas (Princípio 10)

**Medição de 2026-08-27** (T1.3 de `docs/ARCHITECTURE-REVIEW.md`). Golden set:
`~/.assistant-os/rag-golden.jsonl`, 23 casos rotulados sobre a hub-knowledge-base
da Dimastec (soul `consultoria_ia`, 11.568 chunks / 281 arquivos, índice atual).
Embedder: `Xenova/multilingual-e5-base` (768d). `RAG_RERANK_TOPN=20`.

| Cenário | hit@1 | hit@3 | hit@5 | MRR | recall@5 | rerank p50 (ms) | rerank p95 (ms) |
|---|---|---|---|---|---|---|---|
| `off` (baseline) | **73,9%** | 87,0% | 95,7% | 0,809 | 84,8% | — | — |
| `cross-encoder` | 73,9% | 87,0% | 95,7% | 0,809 | 84,8% | n/a | n/a |

**Conclusão: não ativar `cross-encoder` em produção.** Dois motivos:

1. **O reranker cross-encoder está inoperante.** `getCrossEncoderScorer`
   (`packages/memory/src/rerank.ts:~44`) chama o pipeline `text-classification` do
   `@xenova/transformers` 2.17.2 com `{ text, text_pair }` — assinatura **não
   suportada** nessa versão (`text.split is not a function` em cada par). O erro é
   engolido pelo `try/catch` de `rerank()`, os candidatos mantêm a ordem vetorial,
   e o modo `cross-encoder` fica **idêntico a `off`** (tabela acima, número a
   número). Precisa de fiação manual tokenizer+model ou upgrade da lib —
   rastreado como item separado no `docs/ARCHITECTURE-REVIEW.md`.
2. **Mesmo se funcionasse, o ganho provável é baixo.** Das 23 falhas potenciais só
   1 sobra (`test-web-suite`), e é *recall miss* — o doc esperado
   (`testing-matrix.md`) fica fora da janela de 20 candidatos, então rerank não
   alcançaria. hit@5 já é 95,7%; o gap está na recuperação, não na reordenação.

**Gate operacional** (o soul e o índice são dados de cliente — não rodam no CI do
GitHub): antes de release que toque embedder/índice/RAG, rodar
`os rag eval consultoria_ia --min-hit1 0.70` na máquina do deploy e colar a saída
aqui. Piso `hit@1 ≥ 0,70` (baseline 0,739 com folga de 1 caso). O
`.github/workflows/rag-eval.yml` (`workflow_dispatch`, `runs-on: self-hosted`)
automatiza isso quando houver runner com `~/.assistant-os`. A fixture sintética
(`packages/memory/eval/rag-golden.sample.jsonl` via `rag-eval.test.ts`) segue
travando o CI do PR contra regressão de encanamento.

Métricas de latência: `curl :4310/metrics | grep aos_rag_rerank_seconds` (só
relevante depois que o cross-encoder voltar a funcionar).

## 7. Gatilhos de reavaliação

- Troca do modelo de embedding (muda o baseline de relevância).
- `hit@1` do baseline já ≥ 0.9 no corpus real (rerank agrega pouco — manter `off`).
- Latência p95 do rerank > 1s em produção.

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-08-27 | Criada — ativação por env, latência instrumentada, validação por `os rag eval` | Claude Code |
| 2026-08-27 | §6 medido (T1.3): baseline hit@1 73,9%; cross-encoder == off (bug em `rerank.ts` / `@xenova/transformers` 2.17.2); decisão: manter `off` | Claude Code |
