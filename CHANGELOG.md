# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Registra mudanças relevantes de arquitetura, governança e configuração. O job
`compliance` do CI exige uma entrada aqui (ou em `docs/adr/`) quando um PR toca
config sensível (`config.ts`, `policy.ts`, `migrations.ts`, `manifest.ts`,
`prompts/`, `governance/`, `.github/workflows/`).

## [Não lançado]

### Adicionado

- **Busca híbrida RAG (RRF), histórico/dedup no grafo e integração OpenRouter**
  (2026-09-08). Inspirado numa análise comparativa do projeto `deeplethe/utopia`:
  (1) `RAG_HYBRID_SEARCH` (off por padrão) — full-text nativo do Postgres
  (`tsvector`/GIN, migration `0023_chunks_fulltext`) fundido com a busca
  vetorial via Reciprocal Rank Fusion em `packages/memory/src/indexer.ts`
  (`reciprocalRankFusion`, `fullTextSearch`), produzindo de fato o
  `method: "hybrid"` que já existia no tipo mas nunca era gerado — ver
  `docs/RAG-HYBRID.md`; (2) ledger de histórico do grafo de conhecimento —
  `entity_history`/`relation_history` (migration `0024_graph_history_dedup`),
  `upsertEntity`/`upsertRelation` (`packages/memory/src/graph.ts`) passam a
  preservar o valor anterior só quando algo muda de fato (não em upserts
  idempotentes); dedup de entidades por `name_fold` (sempre ativo) e,
  opcionalmente, por similaridade de embedding (`GRAPH_ENTITY_DEDUP`, off por
  padrão) via `resolveCanonicalEntityName`; nova tool MCP/LangGraph
  `graph_walk` (travessia por N saltos a partir de uma entidade, filtro por
  tipo de relação), complementando o dump plano de `graph_list`;
  (3) **OpenRouter como provider cloud alternativo à OpenCode Zen**
  (`packages/core/src/cloud-provider.ts`, `resolveCloudProvider` — precedência
  OpenRouter > Zen > Ollama) — achado ao investigar uma falha real: desde
  2026-09-08 a OpenCode Zen passou a rejeitar (HTTP 400 `MissingSessionID`)
  chamadas de API diretas a modelos `-free` fora do app/CLI `opencode`,
  quebrando as chamadas HTTP diretas do LangGraph
  (`rag-chain.ts`/`agent-workflow.ts`) e do guardian/discriminator
  (`governance/golden-rules.ts`) — não afeta o caminho `opencode run`
  (`packages/daemon/src/runner.ts`), que já roda o binário real do opencode.
  Fases de RBAC multi-tenant e conectores de ingestão externa (candidatos
  também identificados na análise do Utopia) ficaram só documentadas em
  `docs/ROADMAP.md`, adiadas por decisão do usuário.
- **`ADR-PRIV-003` aceita (2026-09-08) — Bloco G aprovado após P1–P8 resolvidas.**
  Reavaliação do `standards_gate_blockg` (1ª rodada em 2026-09-07 tinha veredito BLOCKED,
  G3/G4/G5 reprovados) — owner do repositório (Everton Lima) decidiu as 8 pendências:
  base legal do dado sensível = LGPD art. 11 II "f" (IA sempre sob supervisão de
  profissional de saúde); responsável clínico e DPO = Everton Lima, provisório; retenção =
  1825 dias (`CLINICAS_RETENCAO_DIAS`), provisório até confirmar com conselho profissional;
  sem dado biométrico real nesta fase; provedor de mensageria = Evolution API self-hosted
  (mesma infra do canal WhatsApp já existente, sem fornecedor novo); segue protótipo, sem
  clínica real onboardada (isolamento cross-tenant fica pra depois); `MCP_ZERO_TRUST`
  permanece desligado por decisão — `clinic_prevent_noshow` já é hardcoded em dry-run no
  código, então não há ação irreversível real acontecendo de qualquer forma. Veredito final:
  **approved**, todos os 5 gates. Declaração de conformidade reemitida:
  "Conforme com pendências datadas" (era "Não conforme"). `docs/adr/ADR-PRIV-003-*.md`,
  `docs/compliance/clinicas/*`, `docs/AI-INVENTORY.md` #11 e `docs/ROADMAP.md` atualizados.
  Nenhuma mudança de código nesta entrada — `clinic_prevent_noshow` continua sem despachar
  mensagem real; sair do dry-run exige decisão e mudança de código separadas (P8).
- **`ADR-PRIV-003` — adoção formal AI-4 da vertical Clínicas dentro do terrasIA**
  (2026-09-07). O rascunho técnico `clinic_triage_lead`/`clinic_prevent_noshow`
  (soul `clinica_template`) processa dado de saúde de paciente —
  `standards_classify_profile` confirmou perfil AI-4. Diferente do domínio
  famílias (excluído do backlog em 2026-09-05 pra virar produto separado, ver
  `docs/ROADMAP.md` § "Exclusões de escopo registradas"), o usuário decidiu a
  trilha de adoção formal completa dentro do repo. `standards_gate_blockg`
  avaliou o Bloco G com veredito **BLOCKED** (G3/G4/G5 reprovados — base
  legal/retenção, provedor de mensageria, `MCP_ZERO_TRUST` desligado por
  padrão); pendências P1–P8 registradas no ADR, a maioria exigindo decisão do
  usuário/DPO, não inventadas por analogia com o `ADR-PRIV-001` (famílias).
  Instrumentos completos de adoção (questionário Blocos G+1–14, mapa de
  artefatos/lacunas, declaração de conformidade = "Não conforme" nesta
  rodada) em `docs/compliance/clinicas/`. `docs/AI-INVENTORY.md` #11 e
  `docs/ROADMAP.md` § "Vertical Clínicas" atualizados.

  **Fase 2 (scaffolding técnico) implementada em modo dry-run**, permitido
  pela própria declaração de conformidade por não processar dado real:
  soul `~/.assistant-os/souls/clinica_template/` (`autonomy: "ask"` +
  `approvalPolicy` cobrindo `clinic_prevent_noshow`, allowlist mínima);
  nova família `packages/tools/src/clinic/index.ts` com `clinic_triage_lead`
  (score de lead por heurística transparente, `L2`) e `clinic_prevent_noshow`
  (`L3`, **sempre** retorna `dryRun: true` — nunca despacha WhatsApp/e-mail
  real, não há provedor escolhido); entradas em `CAPABILITY_CATALOG`
  (`packages/core/src/policy.ts`) e `SOUL_SCOPED_TOOLS`/`FAMILY_HANDLERS`
  (`packages/tools/src/index.ts`). Testes:
  `packages/tools/src/test/clinic-tools.test.ts` (8/8, inclui o gate L3
  sob `MCP_ZERO_TRUST=on` + `autonomy: suggest`). Produção com dado real de
  paciente continua bloqueada até o Bloco G ser reaprovado (P1–P8 do
  `ADR-PRIV-003` §5).
- **`calcCost` real substituindo `cost: 0` hardcoded em `cost_calls`**
  (`packages/core/src/pricing.ts`). Todo call-site (`agenda.ts`, `events.ts`,
  `routes/stream.ts`, `observability/record-llm-call.ts`) gravava `cost: 0`
  — não por bug, mas por nunca ter existido uma tabela de preço. Ollama
  local segue sempre 0 (custo de infra, não de API); Zen hoje só expõe
  `nemotron-3-ultra-free` (free tier real). Tabela vazia pra provider pago
  cai em 0 sem lançar — preencher com preço real só quando um provider pago
  entrar em produção, não inventar número comercial antes disso.
- **Extração de entidades/relações também sobre o conteúdo indexado no RAG,
  não só conversas** (2026-09-06). Achado ao investigar a visualização de
  grafo (aba GRAFO): `entity_extraction_queue` só era alimentada por
  `addObservation()` (chat) — `indexFile`/`indexDirectory` nunca disparavam
  extração, então o grafo nunca refletia o conteúdo de documentos já
  indexados (ex.: 28k chunks/738 documentos na soul `consultoria_ia` contra
  só 7 entidades). Granularidade por documento (`path`), não por chunk — 37x
  menos chamadas de LLM. Migração `0021_document_extraction_state` (novo,
  rastreia progresso por `soul`+`path`) e `0022_entity_extraction_claimed_at`
  (nova coluna em `entity_extraction_queue`, necessária pro reclaim de jobs
  presos — ver abaixo, não dá pra usar `ts` porque é o momento de
  enfileiramento, não de início do processamento). Novo hook em
  `packages/memory/src/indexer.ts::indexFile`, atrás da env
  `RAG_DOC_ENTITY_EXTRACTION` (**off por padrão**, mede antes de ligar —
  mesma convenção de `RAG_RERANK`/`RAG_SEMANTIC_CACHE`). Novo comando
  `os memory backfill-entities [--soul <id>] [--dry-run] [--limit N]` pra
  processar o que já está indexado, idempotente/retomável via
  `document_extraction_state`.
- **Confiabilidade da fila de extração de entidades** (2026-09-06, achado ao
  planejar o item acima: histórico real de 28% de sucesso — 9 completos, 21
  falhos, 2 presos em `processing` desde 22/08). `EXTRACTION_TIMEOUT_MS`
  (`packages/memory/src/entity-extraction.ts`) sobe de 60s pra 180s
  (configurável via `ENTITY_EXTRACTION_TIMEOUT_MS` — 18 das 21 falhas eram
  timeout, não erro de prompt/parsing). Novo
  `reclaimStuckEntityExtractionJobs` (`packages/core/src/entityQueue.ts`),
  chamado a cada tick do poller (`packages/daemon/src/entityExtraction.ts`)
  antes de reivindicar jobs novos. Retry automático (até
  `MAX_EXTRACTION_ATTEMPTS = 3`) antes de marcar `failed` terminal — antes
  qualquer falha (mesmo transitória, ex.: timeout de rede) era definitiva.
  Também corrigido: `extractEntitiesWithOllama` rejeitava JSON válido
  envolto em cerca de código markdown (` ```json ... ``` `) — comum em
  modelos pequenos mesmo quando instruídos a responder só em JSON; era uma
  fração real das falhas "JSON inválido" já registradas na fila.
- **`entityExtractionModel` (config) / `ENTITY_EXTRACTION_MODEL` (env)**
  (2026-09-06, achado ao validar o backfill contra dados reais): extração
  de entidades usava sempre `OLLAMA_CHAT_MODEL` — o mesmo modelo do chat ao
  vivo. Nesta instalação isso é `gemma4:26b-a4b-it-qat` (escolhido pra
  qualidade de chat), que estourava o timeout de extração mesmo a 180s;
  `qwen2.5-coder:3b` (mesmo Ollama LAN) concluiu rápido e correto. Novo
  campo/env separa os dois — default mantém `ollamaChatModel` (sem mudança
  de comportamento pra quem não configurar), usado pelo poller do daemon
  (`packages/daemon/src/entityExtraction.ts`) e como default do
  `--model` do `backfill-entities`.

### Removido

- **Job `discriminator` do CI** (`.github/workflows/ci.yml`, 2026-09-06, decisão
  do usuário). O gate SPEC-GR4 (Guardian/LLM pontuando o diff do PR 0-100 e
  reprovando abaixo de 95) chamava um LLM — Zen cloud no runner, ou Ollama.
  Nenhum PR depende mais de IA; os gates que permanecem (`compliance`,
  `build-and-test`) são determinísticos. O comando continua disponível para uso
  local sob demanda: `node packages/cli/dist/index.js discriminator --base origin/main`.
  CONTRIBUTING.md atualizado (lista de status checks de branch protection, seção
  de secrets). O secret `ZEN_API_KEYS`/`ZEN_API_KEY` deixa de ser usado pelo CI.

### Adicionado

- **FM1 — ingestão de PDF/DOCX/XLSX no upload self-service** (2026-09-06). Esses
  formatos eram salvos e nunca indexados. Novo `packages/daemon/src/extract.ts`
  (`extractDocumentText` + `writeKnowledgeSidecar`): PDF via `pdf-parse` (dep
  nova — adicionada ao allowlist do backend em `.github/scripts/deps-zones.mjs`
  com justificativa; DOCX/XLSX reaproveitam o `adm-zip` já presente). O handler
  `POST /souls/:id/upload` grava um sidecar `<arquivo>.md` (que entra no caminho
  de indexação RAG existente — `indexFile`/CLI intactos) e responde com
  `documents: { indexed, skipped }`; documento sem texto extraível
  (escaneado/protegido/corrompido) é salvo para proveniência, reportado em
  `skipped`, e não derruba o upload. Sem OCR. `docs/FRIENDLY-MODE.md` e o README
  atualizados; `docs/ROADMAP.md` fecha FM1.
- **Nota de coordenação em `docs/AI-INVENTORY.md`**: o domínio de famílias
  (perfil AI-4) foi excluído do escopo deste projeto em 2026-09-05 (vira
  produto separado) — o arquivo ainda apontava pra um ADR dedicado
  (`ADR-PRIV-002`/`ADR-AI-005`) pendente. Adicionada nota deixando claro que
  essa redação não avança aqui, sem invalidar a aceitação do ADR-PRIV-001 nem
  a classificação AI-4 provisória já registrada (o ADR-PRIV-001 em si foi
  arquivado fora do repo no mesmo dia — ver "Arquivamento de documentação de
  processo" abaixo — mas sua aceitação continua valendo).

### Alterado

- **Consolidação de backlog**: `docs/ROADMAP.md` passa a ser o único documento
  de backlog/histórico vivo do projeto, absorvendo `docs/BACKLOG-DESIGN-SYSTEM.md`,
  `docs/BACKLOG-SPEC-COMPLIANCE.md`, `NewFeatures/backlog-atual.md` e
  `NewFeatures/revisao-critica-backlog.md` (todos apagados após a absorção —
  o último já era crítica externa 100% absorvida em `backlog-atual.md`).
  `README.md` perdeu a seção "Status"/"Pendências" (era um changelog narrativo
  que ficava dessincronizado do ROADMAP) e ganhou cobertura completa dos
  pacotes `ui`/`web` e da governança fechada em 2026-09-05 (GR1-4, EP1-3, M3),
  que estava totalmente ausente do documento.

- **Arquivamento de documentação de processo (2026-09-06)**: com o projeto se
  preparando pra virar produto, ~180 arquivos de processo/histórico saíram do
  repositório principal — todos os ADRs (`docs/adr/`), os 17 specs/plans de
  `docs/superpowers/` (todos referentes a epics já concluídos), análises
  pontuais (`ARCHITECTURE-REVIEW.md`, `ARCHITECTURE-REFINEMENT-REVIEW.md`,
  `system_overview_2026-08-22.md`, `ANALISE EXTERNA.MD`), specs de features já
  implementadas (`PLANO-CRIACAO-SOULS.md`, `plan_finops_grillme_llmstxt.md`,
  `plan-departamentos-skills-mcp.md`), os 123 dumps do NotebookLM, e os dois
  backlogs que ainda existiam como arquivo à parte (`BACKLOG-FRIENDLY-MODE.md`,
  `ideias-priorizadas.md`). Cópia integral feita antes da remoção pra soul
  `consultoria_ia` (cliente SousaLima,
  `conhecimento/clientes/sousalima/arquivo-historico/`), reindexada. Toda
  referência cruzada nos docs que ficaram no repo (README, ROADMAP,
  AI-INVENTORY, ARCHITECTURE, MCPS, PROMPT-GARDEN, RAG-EVAL, QUICKSTART) foi
  atualizada — links viraram menções em texto com o resultado/decisão já
  incorporado, não apontam mais pra caminho nenhum dentro do repo.

- **Modelo de branch `dev`→`main`**: `dev` criado a partir do `main` atual e
  vira o branch de integração (todo PR mira `dev`, não `main`); `main` só
  recebe promoções via PR `dev`→`main` depois de CI verde + homologação
  manual. `.github/workflows/ci.yml` passou a rodar em push tanto pra `dev`
  quanto pra `main`. **Achado no caminho**: este repositório é privado no
  plano GitHub Free — branch protection clássica e rulesets retornam 403
  ("Upgrade to GitHub Pro") tanto na API quanto na UI, então o fluxo
  `dev`→`main` não tem bloqueio técnico nenhum hoje, só convenção — decisão
  do usuário: não fazer upgrade de plano agora. Documentado em `AGENTS.md` e
  `CONTRIBUTING.md`.

- **`ZEN_API_KEYS` como secret de CI no job `discriminator`** (`.github/workflows/ci.yml`):
  o rodízio round-robin de chaves Zen já existia em `packages/core/src/zen-keys.ts`
  (`ZEN_API_KEYS` separado por vírgula, ou `ZEN_API_KEY_1`..`ZEN_API_KEY_7`),
  mas o workflow de CI só passava `ZEN_API_KEY` (chave única) — cadastrar
  várias chaves no repositório não tinha efeito nenhum no gate. `ZEN_API_KEYS`
  agora é lido também, com precedência sobre `ZEN_API_KEY`, espalhando o
  consumo de chamadas do Discriminator entre as chaves cadastradas em vez de
  bater rate-limit numa única.

- **`docs/adr/ADR-HR5-001.md`** — veredito keep/replace para as 22 dependências
  da zona backend fora do conjunto original STDLIB_FIRST (`node:*`,
  `playwright-core`, `@langchain/*`, `pg`, `zod`). Todas mantidas — cada uma
  sustenta uma feature real sem equivalente stdlib viável. Fecha o gap do
  SPEC-HR5 apontado desde o fechamento do gate de CI.

- **`zod` na allowlist de dependências do backend** (`.github/scripts/deps-zones.mjs`):
  SPEC-EP2 Frente 2 (Fatia 1) introduz validação de schema real nas rotas
  HTTP do daemon via `zod`, agora declarado como dependência de verdade em
  `packages/daemon/package.json` (antes era phantom-dependency — `zod` já
  era importado por `langgraph-tools.ts` sem estar declarado, só funcionava
  por hoisting do npm via `@langchain/*`). Sem superfície nova de fato:
  o pacote já estava presente na árvore de dependências.

- **Migração `0020_threads`** (`packages/core/src/migrations.ts`): tabela
  `threads` (conversas nomeadas) — `account_id` nullable (`NULL` = thread do
  operador, token admin; não confundir com conta de cliente), FK em cascata
  pra `accounts`. Coluna nova `session_messages.thread_id` (nullable, FK em
  cascata pra `threads`) — `/chat` sem thread continua funcionando sem
  nenhuma mudança de comportamento. Aditiva e idempotente (`IF NOT EXISTS`
  em tudo); sem efeito em dado existente. Primeira fatia de backend do
  sub-projeto B (threads + streaming), spec em
  `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md`
  §2. Novo módulo `packages/core/src/threads.ts` (CRUD + isolamento por
  `account_id`, testado com Postgres real). Sem rota REST nem consumidor
  ainda — só o modelo de dados.

- **`scripts/setup.sh` — instalador guiado** (`npm run setup`): sobe o sistema
  numa máquina limpa. Checa pré-requisitos (Node ≥ 22.16, Docker, Ollama,
  `pg_dump`), roda `npm ci` + `build` + `typecheck`, pergunta o essencial
  (`ASSISTENTE_OS_HOME`, Postgres via compose ou externo, `OLLAMA_*`,
  `AOS_HOST`/porta, **gera `ASSISTENTE_OS_DAEMON_TOKEN`**, chaves Zen opcionais,
  pacote de flags de teste), sobe o Postgres, aplica as migrações (`os status`),
  oferece indexar a 1ª soul e, opcional, `pm2 start`. Idempotente; faz backup do
  `.env` antes de mexer; nunca apaga dados. Flags: `--yes`, `--pm2`, `--skip-build`.
  **Não** liga `MCP_ZERO_TRUST` (exige `agent.autonomy` nas souls). Ref:
  `docs/TESTES-DEPLOY-COMPLETO.md` §3. Só adiciona; sem efeito em runtime.
  **Atualização:** novo passo "Ollama" — detecta um Ollama/modelos já
  existentes e oferece usá-los; se ausente, pergunta antes de instalar
  (`curl\|sh` no Linux, `brew` no macOS, `winget` no Windows/Git Bash, ou
  aguarda instalação manual), sobe `ollama serve` se preciso e baixa só os
  modelos configurados que faltarem (cada download também é confirmado). O
  passo Postgres externo agora roda `CREATE EXTENSION IF NOT EXISTS vector`
  na hora do teste de conexão em vez de só avisar. Todo passo alimenta um
  relatório final ("Resumo": ✓ feito / ! pendente) — nada trava a instalação
  por causa de um item opcional; sob `--yes`, instalação de sistema é sempre
  pulada (vira pendência) para nunca rodar instalador sem confirmação.

- **`docs/TESTES-DEPLOY-COMPLETO.md`** — runbook consolidado: o que foi entregue
  nos PRs #11–#20 (remediação da análise crítica Ondas 0–3 + RAG enterprise
  E11–E12), a tabela das variáveis de ambiente novas com valores recomendados
  para teste, o passo a passo de deploy numa máquina limpa, e o protocolo de
  validação de comportamento (12 checks, um por entrega) + as fases E13. Ligado
  do README e do `docs/ROADMAP.md` (§ "Estado 2026-08-30").

- **E12b — RAG: rastreamento contínuo de qualidade** (feature; migração
  `0017_rag_eval_runs`): 3º pedaço da trilha RAG enterprise-ready.
  - **`runFaithfulnessEval(pool, cases, generate)`** — para cada caso positivo:
    `retrieveContext` → prompt ancorado → `generate` (injetável: Ollama real /
    stub) → `scoreAnswerFaithfulness`. Devolve `meanSupported` + os casos abaixo
    do piso. `os rag eval --faithfulness` usa Ollama; pula com aviso se indisponível.
  - **Tabela `rag_eval_runs`** (sem PII — só métricas) + `recordRagEvalRun` /
    `listRagEvalRuns`. `os rag eval --record` grava o run; `os rag eval --history
    [<soul>]` imprime a evolução (hit@1 / MRR / recall / refusal / faithfulness).
  - **Amostragem online no chat**: com `AOS_RAG_FAITHFULNESS_SAMPLE` (0..1,
    default 0), após um turno com contexto de RAG, com essa probabilidade a
    resposta é pontuada (heurística, sem LLM) e gravada como
    `rag_eval_runs(kind='online')` — drift de fidelidade em produção sem custo.
  - Testes: `rag-eval-runs.test.ts` (novo) + `rag-eval.test.ts` (+1 `runFaithfulnessEval`).
  Rollback: `AOS_RAG_FAITHFULNESS_SAMPLE=0` (default) desliga a amostragem; a
  migração só adiciona tabela; reverter o commit tira os comandos.

- **E12a — RAG: métrica de fidelidade + casos adversariais no eval** (feature,
  CI-safe): 2º epic da trilha RAG enterprise-ready.
  - **`scoreAnswerFaithfulness(answer, sources)`** (`packages/memory/src/rag-faithfulness-score.ts`)
    — heurística sem ML: cada frase-afirmação da resposta é comparada com o bag
    de tokens das fontes; abaixo de `AOS_RAG_FAITHFULNESS_MIN_OVERLAP` (0.35) →
    "não sustentada pelo contexto". `supported = 1 − não-sustentadas/afirmações`.
    Reusa o tokenizer/stopwords de `relevance.ts` (não duplica).
  - **Casos adversariais no golden set** — `RagEvalCase.adversarial: true` (query
    fora de escopo). `runRagEval` reporta `adversarialRefusalRate` (fração que a
    recuperação corretamente declinou: sem docs relevantes OU confidence <
    `refusalFloor`) + `adversarialLeaks`. hit@k/MRR/recall passam a ser só sobre
    os positivos. `os rag eval` ganha `--min-refusal` (default 0.8) como gate.
  - Fixture `rag-golden.sample.jsonl` +2 casos adversariais.
  - Testes: `rag-faithfulness-score.test.ts` (novo, 5) + `rag-eval.test.ts` (atualizado).
  Rollback: reverter o commit (aditivo — sem adversariais no golden set, o
  comportamento é idêntico ao anterior).

- **E11 — RAG auditável: citações + confidence multi-sinal** (feature; `AOS_RAG_MIN_CONFIDENCE`
  **default 0 = desligado**):
  - **Citação na resposta**: `SearchResult`/`RagChunk` propagam `updatedAt`/`indexedAt`
    (de `chunks.updated_at`). O bloco de contexto do chat (`buildPrompt`) passa a
    listar `[<doc_key> · sim <score> · <data>] <trecho>` e traz a diretriz de
    **constrained generation** ("responda usando SÓ o que está abaixo; cite a
    fonte; se não houver evidência, diga isso") — antes o caminho do chat só
    injetava `[score] snippet`, sem instrução restritiva (essa vivia só no
    `ragAnswer` do Prompt Garden, que o chat não usa).
  - **`computeRagConfidence(sources)`** (`packages/memory/src/rag-confidence.ts`) —
    heurística sem ML: `0.6·topScore + 0.25·concord + 0.15·(1−freshnessPenalty)`.
    `concord` = fontes acima de `AOS_RAG_CONCORD_FLOOR` (0.5) satura em
    `AOS_RAG_CONCORD_TARGET` (3); `freshnessPenalty` = idade do chunk mais novo /
    `AOS_RAG_STALE_DAYS` (365). `verdict.confidence = { score, level, signals }`.
  - **Modo "evidência insuficiente"**: `confidence.score < AOS_RAG_MIN_CONFIDENCE`
    → o contexto **não** é injetado; o prompt instrui o modelo a admitir a falta
    de evidência em vez de completar com conhecimento paramétrico.
  - Testes: `rag-confidence.test.ts` (novo, 7) + `rag-citation.test.ts` (novo, 2).
  Rollback: `AOS_RAG_MIN_CONFIDENCE` fica 0 (default) → só a citação + a diretriz
  mudam o prompt (mais restritivo, sem quebrar); ou reverter o commit.

### Alterado

- **Onda 3c — observabilidade dos jobs de background + reaper de agenda** (roadmap
  de remediação da análise crítica 2026-08-29; migração `0016_agenda_claimed_at`):
  - Os 4 loops de background do daemon (`monitors`, `events`, `agenda`,
    `entity_extraction`) tinham `.catch(() => {})` — falha silenciosa, sem log,
    sem métrica. Agora usam `onJobError(job)`: `logger.error` + counter
    **`aos_background_job_errors_total{job}`**.
  - **Reaper de agenda**: `claimDueAgenda` carimba `claimed_at`; `reapStaleAgenda`
    (chamado no início de `processDueAgenda`) devolve para `pending` os itens
    presos em `processing` há mais de `AOS_AGENDA_STALE_MINUTES` (15) — ou falha
    de vez se `attempt >= AOS_AGENDA_MAX_ATTEMPTS` (3). Antes, um crash entre
    claim e finish prendia o item para sempre.
  - Testes: `core.test.ts` +1 (`reapStaleAgenda`).
  Rollback: reverter o commit (a coluna `claimed_at` permanece, inofensiva).

### Alterado

- **Onda 3b — checksum de SQL das migrações** (roadmap de remediação da análise
  crítica 2026-08-29; `packages/core/src/db.ts`): `schema_migrations` ganha
  `sql_sha256` (via `ADD COLUMN IF NOT EXISTS` no bootstrap do `runMigrations`).
  Na subida, o checksum atual de cada migração já aplicada é comparado com o
  gravado — divergência (**migração editada depois de aplicada** em algum
  ambiente, que o framework append-only + `IF NOT EXISTS` deixava invisível) vira
  `console.warn` de `DRIFT`, **sem derrubar o boot** (é POC). Linhas antigas sem
  checksum são preenchidas com o valor atual. Teste em `core.test.ts`.
  Rollback: reverter o commit (a coluna fica, inofensiva).

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
