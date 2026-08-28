# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Registra mudanças relevantes de arquitetura, governança e configuração. O job
`compliance` do CI exige uma entrada aqui (ou em `docs/adr/`) quando um PR toca
config sensível (`config.ts`, `policy.ts`, `migrations.ts`, `manifest.ts`,
`prompts/`, `governance/`, `.github/workflows/`).

## [Não lançado]

### Adicionado

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
