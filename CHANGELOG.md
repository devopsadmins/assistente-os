# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Registra mudanças relevantes de arquitetura, governança e configuração. O job
`compliance` do CI exige uma entrada aqui (ou em `docs/adr/`) quando um PR toca
config sensível (`config.ts`, `policy.ts`, `migrations.ts`, `manifest.ts`,
`prompts/`, `governance/`, `.github/workflows/`).

## [Não lançado]

### Alterado

- **Gate de compliance no CI** (refino, Etapa 2): removida a regra de label
  `governanca-revisada` — num fluxo enxuto a evidência é a linha no `CHANGELOG.md`.
  Caminho sensível (`config/policy/migrations/manifest.ts`, `prompts/`,
  `governance/`, `.github/`, `docs/adr/`) agora exige o mesmo paper trail
  (`CHANGELOG.md` ou `docs/adr/`) que a config de governança; editar um ADR já é
  o registro. Removido `.github/workflows/rag-eval.yml` (POC não tem runner
  self-hosted; eval de RAG é passo manual — `docs/RAG-EVAL.md`). Novo
  `CONTRIBUTING.md` com o fluxo de PR + instruções de branch protection.
  Ref: T1.1 de `docs/ARCHITECTURE-REVIEW.md`, Etapa 2 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o PR (restaura o `rag-eval.yml` e a regra de label).

### Adicionado

- **Escalonamento por confiança do roteador** (T3.1, **desligado por default**):
  depois da execução no tier `local`, sinais de baixa confiança (local falhou ·
  resposta vazia/curta · recusa "não sei" + RAG fraco/ausente) disparam **uma**
  re-tentativa no próximo tier. `ROUTER_ESCALATION=on` liga; `_MIN_SCORE` 0.55,
  `_MIN_CHARS` 40. `packages/daemon/src/orchestrator/escalation.ts`
  (`shouldEscalate`, `looksLikeRefusal`, `nextEscalationTier`; 9 testes). Wired só
  no `POST /souls/:id/chat`; inerte quando off. Métrica
  `aos_router_escalation_total{reason,to_tier}`. `docs/ROUTER-ESCALATION.md`.
  Ref: T3.1 de `docs/ARCHITECTURE-REVIEW.md`. Rollback: `ROUTER_ESCALATION` off
  (default) já neutraliza; ou reverter o commit.

### Alterado

- **Ordem do montador de prompt** (T3.3): `buildPrompt` (`packages/daemon/src/context.ts`)
  passa a montar do mais estático para o mais volátil, para maximizar o prefixo de
  bytes idêntico entre turnos (prompt caching / reuso de KV cache do Ollama). O
  bloco de identidade da alma foi partido: `perfil.md`+`licoes.md` (estáveis) vão
  pro prefixo; `${today}` + o log de `sessoes/<data>.md` (que cresce a cada turno)
  descem pra cauda, junto de RAG e histórico. Ordem:
  `CONCISE_OUTPUT_DIRECTIVE → regras de ouro → persona → skills → sessão → RAG →
  histórico → instrução do usuário`. `CONCISE_OUTPUT_DIRECTIVE` segue em 1º. Campo
  de retorno `almaCtx` inalterado (persona + sessão). Ref: T3.3 de
  `docs/ARCHITECTURE-REVIEW.md`. Rollback: reverter o commit.

### Corrigido

- **`CacheService` sem Redis** (refino, Etapa 2): `init()` criava `new Redis()` com
  as opções default (reconexão infinita, sem listener de `error`) → quando não há
  Redis (CI, dev), o ioredis inundava o stderr com `[ioredis] Unhandled error
  event` e o `init()` pendurava ~20–40s até `MaxRetriesPerRequestError`. Agora:
  `lazyConnect` + `connect()` explícito falha na 1ª tentativa; `retryStrategy`
  desiste após 3 tentativas curtas; listener de `error` silencioso; `disconnect()`
  do socket em toda falha (`init`/`get`/`set`). Degradação para o `Map` em memória
  é limpa e imediata (~2s no CI). Teste novo em `cache.test.ts`.
  Ref: Etapa 2 de `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o commit (volta ao comportamento ruidoso).

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

- **Canvas de Arquitetura por soul** (T2.3): `os soul <id> canvas [--write]` gera
  um AI Architecture Decision Canvas descritivo — 8 blocos `· auto` (identidade,
  RAG, roteamento, tools×níveis L1/L2/L3, autonomia/aprovação, guardrails,
  dados/memória, auditoria) preenchidos de `config.json` + fatos do sistema, e 1
  bloco `· decisão` em branco. `buildSoulCanvas`/`isAgenticSoul`/`maxLevelForPattern`
  em `packages/core/src/soul-canvas.ts`. Vocabulário real (sem os campos fictícios
  da Análise 1). `docs/ARCHITECTURE-CANVAS-TEMPLATE.md`. Ref: T2.3 de
  `docs/ARCHITECTURE-REVIEW.md`. Rollback: reverter o commit (comando novo, sem
  efeito em código existente).

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
