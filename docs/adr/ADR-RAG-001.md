# ADR-RAG-001 — Reranker de RAG: ativação por ambiente e medição de latência

**Registro de Decisão de Arquitetura — instrumento oficial da v4.0.**

## 1. Identificação

| Campo | Valor |
|---|---|
| Código | `ADR-RAG-001` |
| Status | Aceita (2026-08-27; revisada 2026-08-29) — default **`off`** mantido; CE endurecido (orçamento de latência, nome de modelo lido em runtime, teste real). CE multilíngue **`Xenova/bge-reranker-base`** identificado e wired; medição `off`×`bge` no corpus real = passo de deployment (Etapa 4 do refino) |
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

| Cenário | hit@1 | hit@3 | hit@5 | MRR | recall@5 | tempo eval (23 casos) |
|---|---|---|---|---|---|---|
| `off` (baseline) | **73,9%** | 87,0% | 95,7% | 0,809 | 84,8% | ~4 s |
| `cross-encoder` = `Xenova/ms-marco-MiniLM-L-6-v2` | 56,5% | 82,6% | 91,3% | 0,696 | 80,4% | ~58 s |

**Conclusão: manter `RAG_RERANK=off` em produção.** Histórico da medição:

1. **Bug corrigido (T1.4, 2026-08-27).** `getCrossEncoderScorer`
   (`packages/memory/src/rerank.ts`) chamava o pipeline `text-classification` do
   `@xenova/transformers` 2.17.2 com `{ text, text_pair }` — assinatura não
   suportada (`text.split is not a function` por par), erro engolido pelo
   `try/catch` de `rerank()` → o modo `cross-encoder` era **idêntico a `off`**.
   Reescrito para tokenizer + `AutoModelForSequenceClassification` diretos (lê o
   logit de relevância). Agora roda de fato.
2. **O modelo default degrada o corpus.** `Xenova/ms-marco-MiniLM-L-6-v2` é um
   cross-encoder treinado só em inglês (MS MARCO). No corpus PT-BR de
   `consultoria_ia` ele **piora** o retrieval: −17,4 pp de hit@1, −0,11 de MRR
   (tabela). E custa ~15× o tempo.
3. **Um CE multilíngue não está disponível pronto.** `Xenova/mmarco-mMiniLMv2-L12-H384-v1`
   não tem build ONNX no HF (401). Fica atrás de `RAG_RERANK_CE_MODEL` (novo env)
   para quando existir um CE multilíngue convertido — aí re-rodar esta medição.
4. **O baseline `off` já é forte.** hit@5 95,7%; a única falha (`test-web-suite`)
   é *recall miss* (doc esperado fora da janela de 20 candidatos) — rerank não
   alcançaria. O gap está na recuperação, não na reordenação.

**Gate operacional** (o soul e o índice são dados de cliente — não rodam no CI do
GitHub): antes de release que toque embedder/índice/RAG, rodar
`os rag eval consultoria_ia --min-hit1 0.70` na máquina do deploy e colar a saída
aqui. Piso `hit@1 ≥ 0,70` (baseline 0,739 com folga de 1 caso). A fixture
sintética (`packages/memory/eval/rag-golden.sample.jsonl` via `rag-eval.test.ts`)
segue travando o CI do PR contra regressão de encanamento.

> **Nota (2026-08-28, Etapa 2 do refino):** o `.github/workflows/rag-eval.yml`
> (`workflow_dispatch` / `runs-on: self-hosted`) citado neste ADR foi **removido**
> — o projeto está em POC e não terá runner self-hosted. O eval do corpus real é
> passo manual até segunda ordem.

Métricas de latência: `curl :4310/metrics | grep aos_rag_rerank_seconds` (só
relevante depois que o cross-encoder voltar a funcionar).

### Revisão 2026-08-29 (Etapa 4 do refino — "endurecer")

Sem depender do golden set real (que saiu do escopo do refino — é dado de
cliente; ver `docs/ARCHITECTURE-REFINEMENT-REVIEW.md` Etapa 3):

1. **CE multilíngue disponível.** `Xenova/bge-reranker-base` (278M params, build
   ONNX pronto no HF) **carrega e pontua par PT-BR corretamente** — teste real
   `score("pm2 restart" | query pm2) > score("culinária italiana" | query pm2)`.
   Passa a ser o `RAG_RERANK_CE_MODEL` **recomendado** para corpora PT-BR.
   Descartados: `Xenova/mmarco-mMiniLMv2-L12-H384-v1` (401 no HF),
   `jinaai/jina-reranker-v2-base-multilingual` ("Unsupported model type" no
   transformers.js 2.x), `mixedbread-ai/mxbai-rerank-xsmall-v1` (idem).
   Latência observada (`bge-reranker-base`, CPU, load a frio + 2 pares): ~2,2 s
   steady / ~40 s primeira carga (download 283 MB). Para `RAG_RERANK_TOPN=20` numa
   máquina limitada, esperar dezenas de segundos/consulta — daí o orçamento.
2. **Orçamento de latência** — `RAG_RERANK_BUDGET_MS` (default **30 000**; `0`
   desliga). `rerank()` cronometra a reordenação; estourou → abandona e volta à
   ordem por score original (mesmo efeito de "modelo indisponível"), com
   `logger.warn`. O CE roda inferência local não-abortável no meio de um par —
   sem o orçamento uma consulta podia travar além do teto de UX (~180 s).
3. **Nome do modelo lido em runtime** — `crossEncoderModel()` em vez de `const`
   no load do módulo; `RAG_RERANK_CE_MODEL` passa a valer sem reimportar.
4. **Teste do caminho real** — `packages/memory/src/test/rerank.test.ts`,
   guardado por `RAG_RERANK_TEST_MODEL` (skip no CI). O doc irrelevante entra em
   1º com score de busca maior; só um rerank que de fato pontuou o par consegue
   invertê-lo. Cobre o tokenizer+`AutoModelForSequenceClassification` que não
   tinha teste (a origem do bug do T1.4). + `__resetRerankState()` para exercitar
   o fallback.

**Medição pendente (passo de deployment, não CI):** na máquina do deploy, com o
índice real da soul,
`RAG_RERANK_CE_MODEL=Xenova/bge-reranker-base os rag eval <soul> --rerank cross-encoder`
× `--rerank off` lado a lado; colar hit@1/hit@3/MRR/recall@5 e latência aqui.
Só então decidir flipar o default por `.env` do deploy. Default no código
**permanece `off`**.

## 7. Gatilhos de reavaliação

- Troca do modelo de embedding (muda o baseline de relevância).
- `hit@1` do baseline já ≥ 0.9 no corpus real (rerank agrega pouco — manter `off`).
- Latência p95 do rerank > 1s em produção.

## Histórico

| Data | Evento | Autor |
|---|---|---|
| 2026-08-27 | Criada — ativação por env, latência instrumentada, validação por `os rag eval` | Claude Code |
| 2026-08-27 | §6 medido (T1.3): baseline hit@1 73,9%; cross-encoder == off (bug em `rerank.ts` / `@xenova/transformers` 2.17.2); decisão: manter `off` | Claude Code |
| 2026-08-27 | T1.4: CE corrigido (tokenizer+model diretos) + env `RAG_RERANK_CE_MODEL`; medido com ms-marco-MiniLM (inglês) → hit@1 56,5% (pior); decisão mantida: `off` | Claude Code |
| 2026-08-29 | Etapa 4 do refino: `Xenova/bge-reranker-base` identificado como CE multilíngue viável (carrega + pontua PT-BR); `RAG_RERANK_BUDGET_MS` (orçamento de latência); modelo lido em runtime; teste real guardado. Default `off` mantido; medição no corpus real vira passo de deployment (golden set saiu do refino) | Claude Code |
