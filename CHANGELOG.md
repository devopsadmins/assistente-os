# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Registra mudanças relevantes de arquitetura, governança e configuração. O job
`compliance` do CI exige uma entrada aqui (ou em `docs/adr/`) quando um PR toca
config sensível (`config.ts`, `policy.ts`, `migrations.ts`, `manifest.ts`,
`prompts/`, `governance/`, `.github/workflows/`).

## [Não lançado]

### Corrigido

- **Reranker cross-encoder do RAG** (T1.4): `getCrossEncoderScorer`
  (`packages/memory/src/rerank.ts`) chamava o pipeline `text-classification` do
  `@xenova/transformers` com uma assinatura de par não suportada → o erro era
  engolido e `RAG_RERANK=cross-encoder` virava um no-op silencioso (idêntico a
  `off`). Reescrito para `AutoTokenizer` + `AutoModelForSequenceClassification`
  diretos. Novo env `RAG_RERANK_CE_MODEL` para trocar o modelo. Medição em
  `docs/adr/ADR-RAG-001.md` §6: o modelo default (só-inglês) piora o corpus PT-BR
  (hit@1 73,9% → 56,5%) — `RAG_RERANK` segue `off`. Ref: T1.4 de
  `docs/ARCHITECTURE-REVIEW.md`.
  Rollback: reverter o commit; o comportamento anterior era `cross-encoder` == `off`.

### Adicionado

- **Cache semântico do RAG** (T2.2, **desligado por default**): camada acima do
  cache exato de `retrieveContext` — acerta quando o embedding da pergunta está a
  ≥ `RAG_SEMANTIC_CACHE_THRESHOLD` (0.85) de cosseno de uma pergunta recente com
  os mesmos parâmetros de recuperação. `RAG_SEMANTIC_CACHE=on` liga; `_TTL` 60s.
  Store em memória do processo (`packages/memory/src/rag-semantic-cache.ts`), caps
  64/bucket · 256 buckets. `RagContext.cacheHit` = `exact`/`semantic`. Opt-out
  `{ semanticCache: false }` (usado pelo `os rag eval`). Métrica
  `aos_rag_cache_total{result}`. `search()` ganha param `precomputedVec` p/ não
  re-embedar. `docs/RAG-CACHE.md`. Ref: T2.2 de `docs/ARCHITECTURE-REVIEW.md`.
  Rollback: `RAG_SEMANTIC_CACHE` off (default) já neutraliza; ou reverter o commit.

- **Prompt Garden** (T2.1): biblioteca versionada dos prompts de pipeline/tool em
  `packages/core/src/prompts/garden/`. Cada prompt é um `PromptSpec`
  (`papel`/`objetivo`/`regras`/`formatoSaida`/`versao` + `template` com
  `{placeholder}` e `render(vars)` que valida). Migrados os 7 literais inline
  (concise-output, email/meeting-ingest, spec-grill, entity-extraction,
  guardian-audit, rag-rerank-scorer). `buildExecutionManifest` ganha
  `prompts: [{id, versao, hash}]` **dentro do hash** — mudar um template muda o
  hash do manifesto. `docs/PROMPT-GARDEN.md`. Ref: T2.1 de `docs/ARCHITECTURE-REVIEW.md`.
  Rollback: reverter o commit (refactor puro, textos idênticos; `system-base.ts`
  reexporta `CONCISE_OUTPUT_DIRECTIVE` para compat).

- **Evaluation Gate do RAG contra corpus real** (T1.3): golden set de 23 casos
  para a soul `consultoria_ia` em `~/.assistant-os/rag-golden.jsonl` (fora do
  repo); baseline medido `RAG_RERANK=off` → hit@1 73,9% / hit@5 95,7% / MRR 0,809,
  registrado em `docs/adr/ADR-RAG-001.md` §6. Novo `.github/workflows/rag-eval.yml`
  (`workflow_dispatch`, `runs-on: self-hosted`) para rodar o eval real fora do CI
  hospedado. Descoberto no processo: o modo `RAG_RERANK=cross-encoder` é um no-op
  silencioso com `@xenova/transformers` 2.17.2 (assinatura de pipeline inválida em
  `packages/memory/src/rerank.ts`) — decisão: manter `off`; conserto rastreado
  como T1.4. Ref: T1.3/T1.4 de `docs/ARCHITECTURE-REVIEW.md`.
  Rollback: reverter o merge (só docs + workflow inerte sem runner self-hosted).

- **Gate de compliance no CI** (job `compliance`, `.github/workflows/ci.yml`):
  em cada `pull_request` valida (1) descrição mínima, (2) referência de
  rastreabilidade — `ADR-XXX`, `roadmap`, `Exx`, `Tn.n` ou `#issue`, (3) linha
  `Rollback:` com plano real; exige registro em `CHANGELOG.md`/`docs/adr/` para
  mudança em config sensível; e o label `governanca-revisada` para alteração em
  caminho sensível (`packages/core/src/{policy,migrations}.ts`,
  `packages/core/src/governance/`, `.github/`, `docs/adr/`). Lógica pura em
  `.github/scripts/compliance-rules.mjs` (13 testes `node --test`), wrapper de CI
  em `.github/scripts/compliance-gate.mjs`. Template de PR em
  `.github/pull_request_template.md`. Ref: T1.1 de `docs/ARCHITECTURE-REVIEW.md`.
  Rollback: reverter o merge; ou remover o job `compliance` de
  `.github/workflows/ci.yml` (o gate roda só em PR, não bloqueia merge local).
