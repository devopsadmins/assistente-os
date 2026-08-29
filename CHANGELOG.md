# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Registra mudanças relevantes de arquitetura, governança e configuração. O job
`compliance` do CI exige uma entrada aqui (ou em `docs/adr/`) quando um PR toca
config sensível (`config.ts`, `policy.ts`, `migrations.ts`, `manifest.ts`,
`prompts/`, `governance/`, `.github/workflows/`).

## [Não lançado]

### Adicionado

- **Onda 2 — trace de execução unificado** (roadmap de remediação da análise
  crítica 2026-08-29; migração `0015_execution_trace`): um `trace_id` (`randomUUID`)
  por turno de chat, no header de resposta **`x-trace-id`** e na coluna
  `execution_logs.trace_id`. Nova tabela **`execution_spans`** (`trace_id`, `seq`,
  `module`, `message`, `level`, `elapsed_ms`) — cada `emitStep` do pipeline
  (`chat`/`rag`/`router`/`ollama`/`langgraph`/`persistencia`/…), que antes só
  existia efêmero no WS `chat.step`, agora persiste como span (diagnóstico —
  não entra em custo/uso; falha de escrita é ignorada).
  - `getTrace(pool, id)` → `{ execution, spans[] }` reconstrói o turno em ordem.
  - **`GET /trace/:id`** (com token) e **`os trace <id>`** — "onde falhou" vira
    consultável.
  - Teste e2e do caminho dourado: `packages/daemon/src/test/golden-path.live.ts`
    (`RUN_E2E=1`, Ollama real, **fora do CI**) — `chat → router → RAG → local →
    resposta` com asserção de todos os spans + veredito + custo.
  - **Teste de restauração de backup**: `packages/cli/src/test/backup-restore.live.ts`
    (`RUN_E2E=1`, **fora do CI**) — `createFullBackup` → extrai `database.dump`
    do ZIP → destrói dados (`DELETE` + `DROP TABLE`) → `pg_restore --clean` no
    container → confere as contagens. "Backup sem teste de restauração não é
    suficiente" (revisão externa, prioridade nº5).
  - Testes: `sessions.test.ts` (+1), `daemon.test.ts` (+1).
  Rollback: reverter o commit — a migração só adiciona coluna/tabela (sem
  down-migration; `execution_spans` fica órfã, inofensiva).

### Alterado

- **Onda 3a — higiene de docs e config** (roadmap de remediação da análise
  crítica 2026-08-29):
  - `docs/ARCHITECTURE.md` **reescrito** para bater com o código atual — descrevia
    um design SQLite (`memory.db`/`kernel.db`), Windows como plataforma primária e
    "Stitch MCP" (descontinuado). Agora: Postgres+pgvector, 6 pacotes atuais,
    Zero Trust, trace, throttle, LangGraph opt-in, deploy PM2.
  - Contagem de tools MCP reconciliada em **56** (`docs/MCPS.md` dizia 54,
    `docs/ROADMAP.md` 52, `docs/ARCHITECTURE.md` 16 — `packages/tools` tem 56).
  - **`ASSISTENTE_OS_ROUTER_TIERS`** passa a ser lido (`config.ts`) — estava
    documentado no QUICKSTART mas nenhum código consumia. `override` explícito >
    env > `["local","zen","soul"]`. Teste em `core.test.ts`.
  - Novo **`.env.example`** na raiz com todas as variáveis e valores de exemplo.
  - QUICKSTART §4 corrigido ("kernel.db em SQLite" → tudo Postgres).
  Rollback: reverter o commit (só docs + 1 fallback de env não-destrutivo).

### Segurança

- **Onda 1b — rate limit + cap de concorrência no daemon** (roadmap de remediação
  da análise crítica 2026-08-29; `packages/daemon/src/throttle.ts`):
  - **Rate limit por cliente** (janela fixa) no `handle()`: default **600 req /
    60 s** — generoso, pega loop descontrolado sem modelar tráfego. Chave:
    `X-Client-Id`, senão hash do token, senão IP. Estouro → `429` +
    `Retry-After`. `/health` e `/metrics` fora. `AOS_RATE_LIMIT=0` desliga.
  - **Semáforo de execuções caras** (`/souls/:id/chat`, `/api/missions/*`,
    `/api/pipelines/*`): o slot é segurado pela duração da rota; estouro → `503`
    imediato (sem fila). Default `AOS_MAX_CONCURRENT_EXEC=8`; `0` desliga.
  Antes só havia limite de *gasto* (`dailyLimit`) e de *turnos* (`maxTurns`) —
  nada barrava milhares de `/chat`/min, cada um um subprocesso.
  Testes: `throttle.test.ts` (novo, 5), `daemon.test.ts` (+2).
  Rollback: `AOS_RATE_LIMIT=0` + `AOS_MAX_CONCURRENT_EXEC=0` neutralizam; ou
  reverter o commit.

- **Onda 1 — Zero Trust aplicado no MCP e no agente LangGraph** (roadmap de
  remediação da análise crítica 2026-08-29, Onda 1a; segue a Onda 0 em #11;
  `MCP_ZERO_TRUST`, **default off**):
  - **Gate central em `tools/call`** (`packages/tools/src/index.ts`): toda tool
    passa por `authorizeExecution` — allowlist + nível de risco × `autonomy` +
    fail-closed para capability fora do catálogo. Antes, `authorizeExecution` (o
    motor com autonomia/budget/approvalPolicy) tinha **1 caller** em todo o
    código; o MCP só checava a allowlist. Com `MCP_ZERO_TRUST=off` (default) o
    gate central é **no-op** — comportamento idêntico ao anterior, sem quebrar
    souls que ainda não declararam `autonomy`. `on` = enforcement completo.
  - **Agente LangGraph** (`packages/daemon/src/langgraph-tools.ts`):
    `createAgentTools` agora **filtra as tools pela allowlist da soul** (antes
    executava qualquer tool ignorando o snapshot) e cada `func` passa por
    `authorizeExecution`. O filtro de allowlist vale **sempre**; o gate
    autonomia/aprovação só com `MCP_ZERO_TRUST=on`.
  - `authorizeExecution` ganha `enforcePolicyGates?: boolean` (default `true`):
    `false` pula os passos 5–6 (autonomy/approvalPolicy) mantendo denylist,
    allowlist, conector e budget.
  - **Path traversal**: `skill_list` / `skill_create` / `mission_run` passam a
    validar `args.soul` com `isValidSoulId` antes de qualquer `join(home,
    "souls", …)`.
  - Testes: `policy.test.ts` (+2), `tools.test.ts` (+4), `langgraph-tools.test.ts`
    (+2).
  Rollback: `MCP_ZERO_TRUST` off (default) já neutraliza o gate de autonomia; o
  filtro de allowlist do LangGraph e a validação de `soul` exigem reverter o
  commit.

- **Onda 0 de contenção** (pós-análise crítica 2026-08-29, `docs/superpowers/`
  não — plano em `.claude/plans/`):
  - `GET /health` (rota pública, sem token) **deixa de listar as souls** — os ids
    incluem `familia_<telefone>` (enumeração não-autenticada de PII). A lista fica
    em `GET /souls`, que exige o token.
  - **`agenda` isolada por soul.** `getAgendaItems(pool, doneFilter, soul?)` ganha
    filtro: chamador escopado (`agenda_list` via MCP com `AGENT_SOUL_ID`, via
    LangGraph com `soulId`, ou `GET /agenda?soul=`) só enxerga a própria agenda +
    itens globais (`soul IS NULL`), nunca a de outra soul. Sem `soul` = modo
    administrativo (todas), atrás do token.
  - **Transcrições de sessão e `auth.json` saem do versionamento.** `git rm
    --cached` de `session-ses_*.md` (raiz + `archive/sessions/`), `auth.json` e
    screenshots de trabalho; `.gitignore` passa a cobrir `session-*.md`,
    `auth.json`, `.playwright-mcp/`, `.web-shots/`, `/*.png`. (Os valores nesses
    arquivos eram de teste; sem reescrita de histórico.)
  - `GET /infra/status` reporta `postgres.ok=false` quando o Postgres está fora,
    em vez de 500 na query de `pg_database_size` não protegida.
  - `ADR-PRIV-001 §G3` corrigido: citava `packages/memory/src/reindex.ts`
    (removido) — o mecanismo real é a poda de órfãos em `indexer.ts`.
  Rollback: reverter o commit (rotas voltam ao comportamento anterior; os
  arquivos removidos seguem no disco e no histórico).

### Alterado

- **Reranker cross-encoder endurecido** (refino, Etapa 4, **default `off`
  mantido**): (1) `RAG_RERANK_BUDGET_MS` (default 30 000; `0` desliga) — `rerank()`
  cronometra a reordenação e, se estourar no meio, abandona e volta à ordem por
  score original (`logger.warn`) — o cross-encoder roda inferência local não
  abortável e podia travar uma consulta em hardware limitado; (2)
  `RAG_RERANK_CE_MODEL` passa a ser lido em runtime (`crossEncoderModel()`) em vez
  de no load do módulo — vale sem reimportar; (3) **`Xenova/bge-reranker-base`**
  identificado como cross-encoder multilíngue viável (carrega + pontua par PT-BR
  corretamente) — vira o modelo recomendado no `ADR-RAG-001` para corpora PT-BR;
  (4) novo teste do caminho tokenizer+model real (`packages/memory/src/test/rerank.test.ts`,
  guardado por `RAG_RERANK_TEST_MODEL`, skip no CI) + `__resetRerankState()`. A
  medição `off`×`bge-reranker-base` no corpus real é passo de deployment (o golden
  set real saiu do escopo do refino — é dado de cliente). Ref: Etapas 3 e 4 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`, `docs/adr/ADR-RAG-001.md`.
  Rollback: `RAG_RERANK` off (default) neutraliza; ou reverter o commit.

### Adicionado

- **Cobertura de teste de integração dos caminhos "wired"** (refino, Etapa 10):
  sub-suíte nomeada `[wired]` que exercita o comportamento montado que os toggles
  ligam, não só as funções puras. (1) `retrieveContext` com `RAG_SEMANTIC_CACHE=on`
  serve **hit semântico** para query parafraseada (`packages/memory/.../integ-wired-paths.test.ts`);
  (2) `judgeAnswer` (novo em `orchestrator/escalation.ts`) encapsula a chamada do
  juiz LLM — rewrite de URL docker, strip do prefixo do modelo, render do prompt
  do garden e parse do verdito — com `chat` **injetável**; `routes/chat.ts` passa
  a chamá-lo em vez do bloco inline. Critério de saída do refino: todo caminho
  que um toggle liga tem ≥ 1 teste de integração. Ref: Etapa 10 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o commit (só adiciona testes + extrai um helper sem mudar
  comportamento).

### Alterado

- **Escalonamento por confiança endurecido** (refino, Etapa 8, **segue desligado
  por default**): (1) sinal de recusa deixa de ser só regex — quando o RAG foi
  fraco e nenhum sinal barato decidiu, um **juiz LLM local** dá um SIM/NÃO
  (`router-escalation-judge` no Prompt Garden — 10 prompts) e o "NÃO" escala
  (`judge_weak`); (2) tetos por sessão: `ROUTER_ESCALATION_MAX_PER_SESSION` (1) +
  `ROUTER_ESCALATION_COOLDOWN_MIN` (10) — bloqueios viram
  `aos_router_escalation_total{reason=session_cap|cooldown}`; (3)
  `ROUTER_ESCALATION_FAST_ONLY` (1) — por default só escala em `mode=fast`.
  `escalation.ts` ganha `shouldRunJudge`, `parseJudgeVerdict`,
  `canEscalateSession`, `recordSessionEscalation`. Ref: Etapa 8 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: `ROUTER_ESCALATION` off (default) neutraliza; ou reverter o commit.

- **Canvas por soul endurecido** (refino, Etapa 7): (1) `os soul <id> canvas
  --write` agora **preserva o bloco 9** (decisões humanas) do arquivo existente —
  `mergeCanvasDecisions` regenera só os blocos `· auto`; (2) o gate "agentic"
  ficou estrito: `isAgenticSoul(soul, { langgraphEnabled })` exige
  `LANGGRAPH_ENABLED` **e** allowlist alcançando L3/curinga (antes era ~sempre
  verdadeiro); (3) `canvasDrift` + linha `canvas: ⚠️ defasado` em `os soul <id>`
  quando o `config.json` mudou desde a última geração. `CanvasSystemFacts` ganha
  `langgraphEnabled`. Ref: Etapa 7 de `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o commit.

- **Montador de prompt: índice de skills separado do corpo** (refino, Etapa 9):
  `renderSkillsPrompt` foi partido em `renderSkillsIndex(available)` (lista
  nome+descrição — semi-estática por soul, vai no prefixo) e
  `renderActiveSkills(active, isToolAllowed)` (corpo das skills que casaram —
  dinâmico por turno, vai na cauda). `buildPrompt` posiciona o índice antes da
  fronteira volátil e o corpo junto de sessão/RAG/histórico → prefixo estável
  maior para prompt caching / KV cache do Ollama. `renderSkillsPrompt` continua
  como compat (saída byte-idêntica) para o `langgraph-runner`. Ref: Etapa 9 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md` (segue T3.3).
  Rollback: reverter o commit (refactor puro).

### Adicionado

- **Métricas de prefill do Ollama** (refino, Etapa 9): `aos_ollama_prefill_seconds`
  (histograma de `prompt_eval_duration`) e `aos_ollama_prompt_eval_tokens`
  (`prompt_eval_count`) — no 2º turno de uma sessão, com o prefixo estável, os
  dois despencam quando o KV cache é reaproveitado. `chat.ts` também emite um
  passo `ollama: prefill: N tokens em Xms` no log de execução. Base para medir o
  ganho de T3.3/Etapa 9. Ref: Etapa 9 de `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o commit (métrica passiva, sem efeito de comportamento).

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

### Alterado

- **Prompt Garden — buracos fechados** (refino, Etapa 5): migrados os 2 prompts
  que faltavam — `agent-react-system` (system do agente ReAct, em
  `agent-workflow.ts` **e** `agent-state.ts`, antes duplicado) e `rag-answer`
  (`prompt-templates.ts` monta o `ChatPromptTemplate` a partir de `ragAnswer` +
  `RAG_ANSWER_SUFFIXES`). Jardim: 9 prompts. Novo campo `outputSchema` no
  `PromptSpec` — o JSON literal da saída sai do `template` (sem `{{ }}` de escape),
  referenciado como `{outputSchema}`; `spec-grill-analyst` / `entity-extraction` /
  `guardian-audit` migrados (render **byte-idêntico** verificado). Novo
  `os prompt list` / `os prompt show <id>`. Ref: Etapa 5 de
  `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o PR (refactor puro, textos idênticos).

### Corrigido

- **CI: `Test` rodava antes de `Prime database`** — o Postgres do serviço ficava
  sem migrações (nem a extensão `vector`) durante `npm test`. Testes que não
  criam schema isolado próprio (`langgraph-tools.test.ts`, pool cru) ou cujo
  `CREATE EXTENSION IF NOT EXISTS vector` num schema de teste não resolvia o tipo
  `vector` quebravam em CI (`type "vector" does not exist` · `relation "chunks"
  does not exist`) — 26 falhas mascaradas localmente por um `public` já migrado.
  `Prime database (migrations + pgvector)` agora roda **antes** de `Test`.
  Ref: Etapa 2 de `docs/ARCHITECTURE-REFINEMENT-REVIEW.md`.
  Rollback: reverter o commit (volta a ordenação antiga).

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
