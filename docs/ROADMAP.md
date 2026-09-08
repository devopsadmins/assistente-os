# Roadmap — terrasIA

Este documento é o histórico do que foi entregue e o que ainda está em aberto.
Para o que o sistema **faz hoje** (features, pacotes, API, deploy), ver o
[README](../README.md) — ele não tem mais uma narrativa de mudanças, só o
estado atual.

Convenção de datas: cada entrada do "Concluído" carrega a data real da
sessão em que foi fechada (não a data de criação do item), para servir como
timeline confiável do projeto.

**Nota sobre arquivamento (2026-09-06):** o repositório principal vai virar
produto — documentos de processo (ADRs, specs/plans do `superpowers/`,
análises pontuais, dumps do NotebookLM, backlogs já fechados, ideias não
comprometidas) foram arquivados fora do repo, na soul `consultoria_ia`
(cliente **SousaLima**, `conhecimento/clientes/sousalima/arquivo-historico/`)
e removidos daqui. Este ROADMAP absorveu o conteúdo essencial de cada um antes
do arquivamento — links que apontavam pra esses arquivos viraram menções sem
link, com o resultado/decisão já registrado no texto.

---

## Posicionamento / modelo de negócio

Consolidado de uma análise externa de tendências de IA para 2026 que
corroborou três teses já assumidas no projeto. Não é backlog — é o
enquadramento que orienta o que vira produto (ver nota de arquivamento
acima e **FM2** em Aberto).

### Diagnóstico de mercado 2026 (validação externa)

- **FOMO não gera lucro.** Adoção por medo de ficar pra trás — licenças
  avulsas, chatbots soltos no WhatsApp — gera churn. Automatizar processo
  ruim só escala o erro mais rápido.
- **Processo e dados antes da ferramenta.** "Base limpa" é pré-requisito,
  não consequência da adoção de IA.
- **Virada agêntica: de responder a executar.** O modelo deixa de ser
  interlocutor e passa a motor cognitivo que planeja, chama ferramentas
  (MCP/APIs), navega sistemas e devolve ao humano só o julgamento de
  exceção (Human-in-the-Loop). Fim da era do prompt simples.
- **SLMs especializados + hardware próprio** no lugar da corrida por
  modelos gigantes: elimina custo abusivo de token de nuvem em rotinas
  mecânicas e dá soberania sobre os dados.
- **Governança como critério de compra.** Conformidade (LGPD,
  rastreabilidade, auditoria) é critério de fechamento comercial em PMEs e
  médias empresas — não burocracia.

### Diferencial arquitetural: memória canônica local-first em Markdown

O Markdown em `~/.assistant-os/souls/` é a fonte da verdade; o
Postgres/pgvector é só índice descartável e reconstruível. Frente a
concorrentes presos a um banco vetorial proprietário, isso mantém a base
legível, versionável e portável — a resposta técnica direta ao "organize
os dados primeiro".

### Modelo de negócio: consultoria produtizada de infraestrutura (AI-First OS)

O ponto que o texto de tendências omite — *como implementar sem gastar
milhões nem inchar a equipe de TI* — é onde está a monetização:

- O cliente não quer mais um SaaS nem horas de desenvolvimento; quer a
  **arqueologia dos próprios processos** — regras tácitas que ele não sabe
  documentar.
- O serviço extrai essas regras, estrutura a base em Markdown e instala o
  "cérebro".
- **Cobrança:** setup estruturado para resolver o gargalo + mensalidade de
  sustentação e governança. O `terrasIA` é engine/moat, não um SaaS
  vendido avulso.

---

## Aberto

### Governança / infraestrutura de release

- **E7 — Cloudflare Access service token.** Procedimento documentado em
  [docs/CLOUDFLARE-ACCESS.md](CLOUDFLARE-ACCESS.md) (criar, autorizar na
  policy, guardar, usar, rotacionar); nenhum código de daemon muda — os
  headers `CF-Access-*` são consumidos na borda da Cloudflare. Falta só a
  ação do usuário no dashboard Cloudflare Zero Trust + preencher
  `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` em `~/.assistant-os/.env`.
- **Onda 3f residual** (multi-tenant já decidido "sim" — Modo Amigável, ver
  Concluído): falta o ADR do modelo de dados de conta (e-mail + hash de
  senha, base legal/retenção — mesmo gate G3 do `ADR-PRIV-001`), o preflight
  de requisitos de skill + co-concessão de tools no picker amigável, e a
  limpeza do caminho legado `X-Client-Id`/`client_key` (coexiste com
  `accounts` sem reconciliação) e do `ffmpeg` hardcoded.

### Modo Amigável — PAUSADO (decisão do usuário, 2026-09-04)

Trabalho existente (Fases 0–4 + upload de conhecimento, ver Concluído) segue
funcional, sem manutenção ativa. Detalhe item-a-item (critério de aceite,
arquivos afetados) arquivado na soul `consultoria_ia` (cliente SousaLima) —
aqui só o resumo:

- **FM1** (P0) — ~~ingestão de PDF/DOCX/XLSX no upload self-service~~ **FEITO
  2026-09-06** (ver Concluído).
- **FM2** (P1) — decisão de posicionamento SaaS hospedado × auto-hospedável;
  onboarding hoje é 100% dev (Node/Postgres/Docker/`.env` manual).
- **FM3** (P1) — white-label: marca/logo hoje hardcoded em `friendly.html`.
- **FM4** (P1) — fluxo "esqueci minha senha" (não existe nenhum reset hoje);
  depende de um canal de e-mail transacional, que também não existe.
- **FM6** (P2) — auditoria completa de mensagens de erro expostas ao
  friendly (parcialmente feito; faltam vários caminhos: RAG "evidência
  insuficiente", sessão expirada, upload rejeitado, 429/503, timeout de LLM).
- **B-DEPLOY-1 / B-DEPLOY-2** (pausados junto, mesma infra de contas): `AuthScreen`
  real no `packages/web` (hoje token fixo `VITE_DEV_TOKEN` embutido no
  build) + roteamento em `server.ts` (`/` deveria servir `packages/web` com
  sessão de conta válida, `/hud` exigir token admin). `FM5` do backlog de
  friendly é o mesmo item que B-DEPLOY-2 — não tratar como dois.
- **Gaps de isolamento** (arquitetura, não UX — fora do board de friendly mas
  documentados lá): `soul.config.ownerAccountId` não tem FK, isolamento é só
  por aplicação rota-a-rota, sem teste que quebre ao esquecer o gate numa
  rota nova; `excluirFamilia` (LGPD) não tem dimensão de conta.

### RAG / medição

- **E13 — protocolo "zero → real" (Fase 2/3)**: Fase 1 (o runbook de deploy +
  teste, [docs/TESTES-DEPLOY-COMPLETO.md](TESTES-DEPLOY-COMPLETO.md)) está
  pronta. Fase 2 (volume) e o relatório de prontidão dependem de corpus real
  de cliente — não têm como avançar sem isso.
- **Toggles OFF a medir em staging**: `RAG_RERANK` (cross-encoder/llm),
  `RAG_SEMANTIC_CACHE`, `ROUTER_ESCALATION`, `RAG_DOC_ENTITY_EXTRACTION`
  (extração de entidades/relações também sobre documentos indexados, não só
  chat — ver CHANGELOG 2026-09-06), prefill da Etapa 9 — todos shipam
  desligados por padrão, aguardando medição real de ganho/custo. `os rag
  eval --history` é a ferramenta pra isso.
- **Spike BitNet (`bitnet.cpp`)**: inferência 1.58-bit CPU-first pro tier mais
  barato do router, rodando em paralelo ao Ollama. Motivação original ("Ollama
  CPU lento" na máquina de deploy) foi parcialmente atenuada por um setup de
  Ollama remoto numa máquina de trabalho mais forte (uso pessoal/dev) — mas a
  meta de baratear o tier de produção pra instalações de cliente reais
  (sem acesso a essa máquina) continua uma motivação distinta e válida.
  Diretório preparado em `/home/support/bitnet-spike/`. Esforço: S–M.

### Fine-tuning para clientes — avaliação (2026-09-07)

- **Enquadramento**: RAG já resolve conhecimento; fine-tuning só entra para
  comportamento/formato/tom em tarefa estreita, repetida, estável e com dado
  real — e como último degrau da escada (prompt → context engineering → RAG →
  agent skills → fine-tuning). Material de referência: curso em
  `docs/knowledge/Processamento_dados_fine_tuning_de_modelos.pdf`.
- **Ativo reutilizável**: o Decision Framework do material (gate de
  governança + quatro perguntas + AHP/NPV/Real Options) é candidato a virar
  `os finetune-assess <soul> <tarefa>`, gravando um decision record auditável
  (perguntas, sinais verde/vermelho, justificativa, recomendação). Esforço S–M.
- **Dimastec — rodado 2026-09-07, veredito "não agora" nos 3 candidatos**:
  - código do Hub nas convenções — falha Q2 (RAG/skill sobre a
    hub-knowledge-base ainda não construída), Q3 (sem dataset) e Q4 (stack
    Java 25/Spring Boot 4.0.0 ainda se formando);
  - documentos normativos do SGSI — volume finito/único, prompt+RAG não
    esgotado;
  - extração estruturada — sem tarefa de volume hoje (fluxo de GMUD/tickets
    nem formalizado ainda).
  - **Gate de governança**: código/política classificados "Restrito"
    (INV-CLASS-001) + review do DPO pra qualquer fluxo externo — exige
    aprovação da Dimastec + DPA, ou LoRA/QLoRA local air-gapped (coerente com
    ADR-INTEGRACAO-001).
  - **Condições de reativação**: (1) baseline de RAG medido; (2) dataset de
    dezenas a baixas centenas de pares reais representativos; (3) stack
    hub-api congelada; (4) governança resolvida. Candidato mais provável de
    sobreviver: conformidade de convenção de código do hub-api, como adaptador
    LoRA local.
- **Valor imediato do material, independente de fine-tuning**: a disciplina
  de preparação de dados (gate de relevância, esquema canônico, PII
  scrubbing, deduplicação MinHash/LSH, hash/proveniência, Model Card) já se
  aplica hoje à construção/higiene do corpus de RAG.
- **Custo recorrente a considerar**: cada modelo fine-tunado vira artefato
  versionado — reavaliação obrigatória a cada troca de modelo base.
- **Cross-ref**: "SLMs especializados + hardware próprio" (Posicionamento);
  Spike BitNet; E13 (também depende de corpus real de cliente).

### ~~HUD: central de agenda/missões/worktrees~~ **FEITO 2026-09-07**

Nova aba "Central" no HUD (`daemon/web/index.html` + `assets/app.js`),
agregando em modo leitura os 5 tools/endpoints que antes só existiam
isolados: `GET /agenda`, `GET /api/missions`, `GET /api/worktree`,
`GET /router/status`, `GET /costs`. Zero backend novo — só UI. Auto-refresh
de 20s enquanto a aba está ativa (para ao trocar de aba, pra não bater nos 5
endpoints à toa em background); botão "Atualizar" manual também. Validado
ao vivo via Playwright (5 seções carregando dado real, sem erro de console).
Fase 2 (iniciar/agendar trabalho pela UI — `agenda_add`/`mission_run`) fica
em aberto, porque aí vira ação de escrita e entra questão de permissão/auth.

### Dívida técnica conhecida

- **CI flakiness**: `kill-switch.test.ts` falhou 1x no CI (PR #36) com
  `deadlock detected` (`40P01`) no `DROP SCHEMA` de `pgTestHelper.js` —
  sintoma de testes em paralelo disputando schema no mesmo Postgres. Não
  reproduziu localmente, não investigado a fundo. P3, monitorar recorrência.
- **B-FUTURE**: streaming token-a-token pro tier LangGraph — adiado
  explicitamente como follow-up na spec original, não bloqueia nada hoje.

### Ações operacionais pendentes (não são item de planejamento)

- ~~**OPS-01** — limpar threads de teste (#1–#4) na soul `main`.~~ **FEITO
  2026-09-07** (aprovação explícita do usuário). #1–#4 já não existiam (banco
  e API concordavam); a #5 remanescente também era vazia (0 mensagens, sem
  título) e foi removida junto via `DELETE /souls/main/threads/5`. Soul
  `main` sem threads de teste agora.
- **OPS-02** — rodar `os memory backfill-entities` sobre o conteúdo já
  indexado. Decidido 2026-09-06: `qwen2.5-coder:3b` (não o modelo de chat,
  26B, que estourava timeout) via `ENTITY_EXTRACTION_MODEL`. **Em andamento
  desde 2026-09-06** pra soul `consultoria_ia` (738 documentos) — rodando em
  background, ~92% de taxa de sucesso na amostra real (vs. 28% histórico).
  Progresso 2026-09-07: 348/740 processados (319 ok, 29 falharam — falhas
  reprocessam sozinhas na próxima run). Ainda falta: as outras 13 souls
  (~359 documentos restantes do `--dry-run` original de 1.097) — não
  iniciado, decisão de quando rodar em aberto.

### Vertical Clínicas — adoção AI-4 (2026-09-07)

Rascunho técnico (`clinic_triage_lead`/`clinic_prevent_noshow`, soul `clinica_template`)
processa dado de saúde de paciente — `standards_classify_profile` confirmou perfil **AI-4**.
Diferente do domínio famílias (ver "Exclusões de escopo" abaixo), o usuário decidiu
explicitamente a trilha de adoção formal completa **dentro** do terrasIA, não como produto
separado.

- ADR de adoção: `docs/adr/ADR-PRIV-003-clinicas-base-legal-retencao-ai4.md` — status
  **Proposta**, Bloco G avaliado via `standards_gate_blockg` com veredito **BLOCKED**
  (G3/G4/G5 reprovados — base legal/retenção, provedor de mensageria, `MCP_ZERO_TRUST`
  desligado por padrão).
- Instrumentos completos (questionário Blocos G+1–14, mapa de artefatos/lacunas, declaração
  de conformidade = "Não conforme" nesta rodada): `docs/compliance/clinicas/`.
- Pendências P1–P8 (`ADR-PRIV-003` §5) exigem decisão do usuário/DPO/responsável clínico —
  base legal do dado sensível, retenção, DPO, provedor de mensageria, modelo de
  multitenancy. Nenhuma inventada por analogia com o ADR-PRIV-001 de famílias.
  Scaffolding técnico (soul + tools) pode avançar em ambiente de teste/dry-run,
  sem dado real, mas produção fica bloqueada até o Bloco G ser reaprovado.
- `docs/AI-INVENTORY.md` #11 registra o sistema.

### Exclusões de escopo registradas

- **ADR-PRIV-002 / ADR-AI-005 (perfil AI-4 de famílias)**: excluído do
  backlog deste projeto em 2026-09-05 (decisão do usuário) — o domínio
  famílias foi um teste que vira produto separado, fora do escopo do
  terrasIA. O ADR-PRIV-001 (aceito, arquivado — ver nota abaixo) e
  `docs/AI-INVENTORY.md` #6 registram o resíduo formalmente, com nota de
  coordenação apontando pra esta exclusão. **Nota (2026-09-07):** esses dois
  códigos ficam definitivamente aposentados/reservados a este resíduo — a
  vertical Clínicas (também AI-4, ver acima) usa um código novo,
  `ADR-PRIV-003`, para não colidir com este histórico.

---

## Ideias não comprometidas

16 ideias especulativas (tieradas Tier 1–3), consolidadas de um brainstorm
maior, arquivadas na soul `consultoria_ia` (cliente SousaLima). **Nada ali
está aprovado** — é material de prospecção, não backlog ativo. Arquivado à
parte de propósito pra não se misturar com o que é trabalho comprometido
nesta página.

---

## Concluído (histórico)

### 2026-09-06 — FM1: ingestão de PDF/DOCX/XLSX no upload self-service

Upload de PDF/DOCX/XLSX deixou de "ficar morto". Novo
`packages/daemon/src/extract.ts`: PDF via `pdf-parse` (dep nova, no allowlist
de `deps-zones.mjs` com justificativa; import do módulo interno
`pdf-parse/lib/pdf-parse.js` + warm-up do pdf.js pra contornar o
"bad XRef entry" da 1ª invocação); DOCX/XLSX via `adm-zip` já presente
(parse manual do XML — parágrafos do `word/document.xml`; `sharedStrings` +
`## <planilha>` + células por ` | ` no XLSX); teto defensivo de 5 M de
caracteres. O handler `/souls/:id/upload` (`routes/memory.ts`) extrai
síncrono, grava um sidecar `<arquivo>.md` (cabeçalho de origem + texto) que
entra no caminho de indexação existente, e responde com
`documents: { indexed, skipped }`; documento ilegível (escaneado/protegido/
corrompido) é salvo para proveniência, reportado em `skipped` e **não**
derruba o upload. `indexFile`/CLI seguem intactos (já ignoram binário via
`scanTextFiles`). Testes: `extract.test.ts` (8, fixtures OOXML/PDF montadas
em memória) + `friendly-doc-upload.test.ts` (2, rota ponta a ponta).

### 2026-08-27 — E1–E10

Dez epics fechados numa sessão (branch `feat/roadmap-execution`), 413 testes,
typecheck limpo:

- **E1 — FinOps, captura de tokens no chat.** Cada resposta de chat grava
  `prompt_tokens`/`completion_tokens`/`model_used`/`execution_mode` em
  `router_history` (linha `status='executed'` separada das sondas de
  roteamento) e `getUsageSummary()` agrega por soul/mode/model. Ollama lê
  `prompt_eval_count`/`eval_count` nativos; LangGraph soma `usage_metadata`
  das mensagens; opencode usa estimativa por caractere como fallback
  declarado. `packages/core/src/router.ts`, `packages/core/src/tokens.ts`.
- **E2 — Sessões multi-turno, endurecimento.** Histórico truncado por
  orçamento de caracteres (`ASSISTENTE_OS_SESSION_HISTORY_MAX_CHARS`);
  reidratação do checkpoint LangGraph via `seedMessages` (sobrevive a
  restart do daemon, já que a fonte de verdade é o Postgres); isolamento por
  `client_key` (`X-Client-Id` ou hash do token) evita vazar histórico entre
  clientes da mesma soul. `packages/core/src/sessions.ts`.
- **E3 — Mission Runner ligado ao daemon.** Steps antes falsos
  (`browser-*`, `guardian-audit`) agora fazem trabalho real; modos
  `headless`/`guarded`/`full` (os dois últimos interrompem a missão se a
  auditoria do Guardian reprovar). REST `/api/missions` + MCP
  `mission_list`/`mission_run`. Corrigiu no caminho um bug estrutural sério:
  `packages/daemon/tsconfig.json` excluía `src/test/**` desde um commit
  anterior — a suíte do daemon não compilava havia tempo.
  `packages/daemon/src/orchestrator/mission-runner.ts`.
- **E4 — Terminal Sanitizer + cache em camadas, ligados à produção.**
  Sanitizer trunca saída verbosa de build/test no merge de worktree; cache
  (Redis com fallback em memória) em `getUsageSummary` (TTL 30s) e
  `retrieveContext` (TTL 60s).
- **E5 — `soul_create` + `worktree_list` no MCP.** `soul_create` com
  dry-run/commit por `plan_hash` (L3, exige `AGENT_SOUL_ID` autorizado);
  `worktree_list` reusa a mesma função da rota REST.
- **E6 — Observabilidade: Sentry + Prometheus/Grafana.** `GET /metrics`
  (Bearer, prefixo `aos_`), Sentry opcional via `SENTRY_DSN` (no-op sem
  DSN, `beforeSend` roda o content-filter), stack local via
  `docker compose --profile observability up`.
- **E7 — Cloudflare Access, doc pronto.** Ver Aberto — só falta ação externa
  no dashboard.
- **E8 — Governança AI-3.** Suíte cross-tenant (RAG/grafo/sessões/custos
  isolados por soul), execution manifest determinístico
  (`GET /api/manifest`, anexado ao build pelo CI), testes de kill-switch
  (provider nunca chamado quando o limite corta), `docs/AI-INVENTORY.md`
  (10 sistemas classificados), RACI do `ADR-AI-003` aceita pelo owner.
  Achado e corrigido no caminho: `execution_logs.verdict` vazava `snippet`
  de documento em `/infra/status` — `sanitizeVerdictForLog`.
- **E9 — LGPD, fechar `ADR-PRIV-001`.** ADR aceito; gate de consentimento no
  onboarding de famílias (`consent_evidence_ref`, não avança sem isso);
  rotação de backup vs. eliminação documentada (§8 do ADR). Resíduo formal:
  ADR dedicado ao perfil AI-4 (`ADR-PRIV-002`/`ADR-AI-005`) — **excluído do
  escopo em 2026-09-05**, ver "Exclusões de escopo" acima.
- **E10 — RAG, estágio de reranking.** `rerank()` (cross-encoder via
  `@xenova/transformers` ou juiz LLM), default `off`. Correção 2026-08-28
  (abaixo): o caminho cross-encoder era um no-op silencioso até então.

### 2026-08-28 — Revisão de arquitetura

`docs/ARCHITECTURE-REVIEW.md` (arquivado). Backlog concluído:
gate de compliance no CI, golden set de RAG + baseline, conserto do bug de
no-op silencioso no reranker cross-encoder (`getCrossEncoderScorer` chamava
o pipeline do `@xenova/transformers` com assinatura de par não suportada —
reescrito para tokenizer + model diretos), Prompt Garden, cache semântico de
RAG, canvas de arquitetura por soul, escalonamento do roteador por
confiança, reordenação do montador de prompt (`buildPrompt`, do bloco mais
estático pro mais volátil, pra maximizar reuso de prefix cache). Medição
real (`ADR-RAG-001 §6`) mostrou que o modelo default de reranker
(`Xenova/ms-marco-MiniLM-L-6-v2`, só-inglês) piora corpus PT-BR — por isso
`RAG_RERANK`/`RAG_SEMANTIC_CACHE`/`ROUTER_ESCALATION` seguem **desligados**
por padrão (ver "Toggles OFF a medir" em Aberto).

### 2026-08-29/30 — Remediação da análise crítica + RAG enterprise

Runbook de deploy + protocolo de teste completo:
[docs/TESTES-DEPLOY-COMPLETO.md](TESTES-DEPLOY-COMPLETO.md).

- **Remediação em ondas**: Onda 0 (contenção — `/health` sem PII, agenda por
  soul, higiene de git), Onda 1a (Zero Trust no MCP e LangGraph,
  `MCP_ZERO_TRUST`), Onda 1b (rate limit + cap de concorrência), Onda 2
  (trace unificado `x-trace-id`/`execution_spans` + `os trace`), Onda 3a
  (docs sincronizados + `.env.example`), Onda 3b (checksum de migração),
  Onda 3c (jobs de fundo com log/métrica + reaper de agenda).
- **RAG enterprise-ready**: E11 (citações + confidence multi-sinal + modo
  "evidência insuficiente"), E12a (fidelidade heurística + casos
  adversariais), E12b (`runFaithfulnessEval` + tabela `rag_eval_runs` +
  `os rag eval --record`/`--history` + amostragem online).

### 2026-08-31 — Modo Amigável (Fases 0–4)

Camada de acesso self-service completa — detalhe em
[docs/FRIENDLY-MODE.md](FRIENDLY-MODE.md): contas (`accounts`,
`account_sessions`, migrações `0018`/`0019`), wizard de criação de soul
(`dry_run → plan_hash → confirmar`), configurações escopadas, upload de
conhecimento com teto em KB por conta, allowlist de admin fechada por
padrão. **Resolve a "Onda 3f" (decisão multi-tenant: sim)** — residual
listado em Aberto. Pausado como iniciativa ativa desde 2026-09-04 (decisão
do usuário) — ver "Modo Amigável — PAUSADO" em Aberto.

### 2026-09-02 a 2026-09-05 — Design System (`packages/ui`, DS1–DS15)

Backlog completo fechado (15 itens, detalhe original por tarefa/PR nos
commits de `packages/ui`). Resumo:

- **DS1** — `ScrollArea` expõe `viewportRef` + scrollbar horizontal (pré-requisito do `MessageList`).
- **DS2** — notas de integração do A1 (fundação de tokens) formalizadas no spec do redesign de app (B).
- **DS3** — `Field` ganhou uma forma render-prop pra compor com `Select` sem depender de `cloneElement`.
- **DS4** — testes de regressão de a11y em Tabs/DropdownMenu/Switch/Checkbox.
- **DS5** — cap de chroma (`TINT_CHROMA_CAP=0.05`) corrige `--accent`/`--chat-user-bubble` saindo ~7x mais saturados que o spec previa.
- **DS6** — todo `color()` do preset Tailwind ganhou fallback igual a `tokens.css`, com teste de drift automático.
- **DS7** — 6 achados cosméticos soltos (asChild em CardTitle, props do Toaster, barrel exports, sweep de cor hardcoded recursivo, Markdown/Citation viraram forwardRef).
- **DS8** — token `--overlay` dedicado pro scrim do Dialog, desacoplado de `--foreground` (prepara dark mode futuro sem esperar ele existir).
- **DS9** — Global Constraint de `forwardRef` reformulada no plano correto (estava referenciando o arquivo errado).
- **DS10** — `CodeBlock` com highlight real (shiki) + `Markdown` renderiza `[[n]]` como `<Citation>` interativa só quando existe fonte real (fecha um achado de spoofing).
- **DS11** — `Markdown` deixou de perder silenciosamente imagens e checkboxes de task-list GFM.
- **DS12** — `ScrollArea` com `viewportLabel` opcional (`role="region"` + `aria-label`).
- **DS13** — `MessageList` ganhou `ResizeObserver` além do `MutationObserver`, cobrindo reflow sem mutação de DOM.
- **DS14** — `StreamingText` sinaliza fim do stream (`done`) sem remontar o conteúdo.
- **DS15** — `MessageList`/`StreamingText` com `role="log"`/`aria-live`/`aria-busy`.

### 2026-09-04 — Onda 3d, Onda 3e, contenção (SPEC-HR2/HR6/BUG-01)

- **Onda 3d — centralizar config**: fechada sem migração mecânica adicional.
  Fase 1 (5 fixes: 2 bugs reais + 3 riscos de duplicação unificados) já
  tinha resolvido o único candidato com bug real confirmado
  (`RAG_INJECTION_MODO`/`PROMPT_INJECTION_MODO`, unificado pelo M3 na mesma
  sessão). As ~90 leituras restantes de `process.env` são single-site sem
  duplicação comprovada — migrá-las exigiria adotar `zod`/`envalid` como
  dependência nova, decisão reservada ao usuário; sem bug motivador, não
  migrado.
- **Onda 3e — quebrar god-objects**: `chat.ts` 1177→22 linhas (4 módulos +
  `promptPipeline.ts` compartilhado); `tools/src/index.ts` 2075→338 linhas
  (13 famílias, 59 tools, padrão `ToolContext`/`FAMILY_HANDLERS`).
- **SPEC-HR6** (P0) — `WsHub` agora escopa cada cliente por `accountId`;
  eventos sem escopo (voice/monitor/agenda/whatsapp/telegram/mission) vão só
  pra admin, antes iam pra todo mundo. 2 bugs adjacentes corrigidos:
  `daemon.close()` travava com WS aberto; close-frame do cliente nunca era
  notado (socket pendurado).
- **SPEC-HR2** (P0) — `purgeCredentials` tinha zero chamadores em produção;
  segredo detectado em qualquer chat ficava em memória até o processo
  reiniciar. Corrigido em 3 pontos (`chat.ts`, `stream.ts`, `sentry.ts`).
  Gap residual conhecido e aceito: modo `recusar` (não é o default) pode
  reter segredo até o próximo turno da mesma sessão — não corrigido por
  exigir refactor maior de `preparePromptContext`.
- **BUG-01** — watchdog externo do `/stream` (310s absoluto) corria em
  `Promise.race` sem jeito de cancelar a chamada ao Ollama; corrigido com
  `AbortSignal` real. Escopo: só o tier Ollama (era o caso reproduzido).
- **SPEC-HR4, SPEC-FO1** — auditados e confirmados já implementados (hard-stop
  de 5 iterações no LangGraph; diretriz FinOps incondicional no prompt) —
  não precisaram de código novo, só deixaram de estar erroneamente listados
  como pendentes.

### 2026-09-05 — Governança (SPEC-HR1/HR3/HR5, GR1–4, EP1–3, M3)

Dia de maior atividade — 12+ PRs.

- **SPEC-HR1 — degradação suave DB/LLM.** Fatia 3 fecha o item:
  `routes/agenda.ts` (GET/POST) e o job `processDueAgenda` sondam
  `isDbHealthy` e respondem/pulam com erro claro em vez de deixar o timeout
  de conexão do `pg` estourar; RAG ingest (`indexFile`) ganhou a mesma
  sonda nos 4 pontos de entrada (CLI, tool MCP, LangGraph, upload HTTP).
- **SPEC-HR3 — tools MCP com autorização + auditoria.** `authorizeTool` já
  era blanket check; `logIntention` (audit-trail) agora roda no `finally`
  de `handleToolCall` — toda chamada registra intenção, sucesso ou falha.
  Bug pré-existente corrigido no caminho: 3 funções de log resolviam `home`
  via `resolveHome()` global em vez do `home` do chamador (7 call sites).
- **SPEC-HR5 — reconciliar dependências (STDLIB_FIRST).** `deps-zones.mjs`
  nunca rodava de fato em CI (só tinha testes unitários das próprias
  funções) — novo step "Dependency zones gate" no job `compliance`.
  ADR-HR5-001 (arquivado): 22 dependências fora do conjunto original
  verificadas por uso real no código — veredito manter todas, nenhuma tem
  equivalente stdlib viável.
- **SPEC-GR1 — 4º loop de autoaprendizado.** Reincidência (3+ lições do
  mesmo tópico) → proposta de Regra de Ouro → aprovação por código de 6
  dígitos via Telegram → `buildPrompt` injeta a regra ativa **ao vivo, a
  cada prompt**, pra qualquer soul do home (não um diff estático em
  `SOUL.md` por soul — mecanismo mais robusto, cobre souls futuras
  automaticamente).
- **SPEC-GR2 — rodapé `usage_metadata`.** `appendUsageMetadata`
  (`packages/core/src/alma.ts`) anexa o bloco na sessão do dia, idempotente
  por `session_id`, ligado em `postChat.ts` sem risco de derrubar a
  resposta do chat.
- **SPEC-GR3 — browser harness semântico.** A ordem "a11y tree → seletor →
  screenshot" já valia na prática (nunca existiu clique por coordenada). O
  gap real era `browser_execute_fix`: sandbox por substring, trivialmente
  contornável, rodando no mesmo realm JS da página. Corrigido com
  `evaluateInIsolatedWorld()` (CDP), DOM compartilhado mas realm de JS
  separado.
- **SPEC-GR4 — gate Discriminator no CI.** Causa raiz do crash em ~2s: `os
  discriminator` pulava migração de Postgres, mas o job do CI não tem
  serviço Postgres — corrigido (mesma lista de skip de `help`/`backup`).
  `ZEN_API_KEYS` (rodízio round-robin já existia em
  `packages/core/src/zen-keys.ts`, só não estava ligado ao job) cadastrado
  como secret de CI — **item fechado de ponta a ponta**: PR posterior já
  mostrou o gate julgando um diff de verdade (score real, não mais
  "Guardian indisponível").
- **SPEC-EP1 — planejamento em PR.** Seção "Plano (arquivos + ordem)"
  obrigatória no template, validada de verdade pelo gate `compliance`.
- **SPEC-EP2 — tipagem estrita + Zod nos limites.** Frente 1: ESLint criado
  do zero (`no-explicit-any: error`); dos ~36 `any` de produção, 8
  corrigidos com tipo real, ~28 documentados com justificativa pontual.
  Frente 2 (3 fatias): as 13 rotas HTTP do daemon que fazem parsing de body
  ganharam schema Zod (`parseBody`); as ~50 tools MCP ganharam validação de
  args derivada do próprio `inputSchema` (fonte única, sem duplicar
  schema); a CLI ganhou validação de argumento obrigatório/enum,
  corrigindo dois bugs reais de comportamento silencioso. Efeito colateral
  consciente e recorrente: input malformado agora é **rejeitado**
  (400/erro MCP/exit 1), não mais coagido a um default em silêncio.
- **SPEC-EP3 — script único de DoD.** `npm run dod` encadeia build →
  typecheck → lint → test → manifest → discriminator, sem parar na
  primeira falha.
- **M3 — endurecimento de prompt injection.** Default mudou de `aviso`
  (nunca bloqueava) pra `recusar` (bloqueia severidade medium+high — era só
  high). Resolução de env var unificada num só lugar
  (`resolvePromptInjectionMode`).
- Design System (DS2–DS9, finalização) — ver seção própria acima.

Nota de coordenação: com o domínio famílias (AI-4) excluído do escopo neste
mesmo dia (ver "Exclusões de escopo" em Aberto), `docs/AI-INVENTORY.md` ganhou
uma nota apontando pra essa decisão — a aceitação do ADR-PRIV-001 (arquivado)
e a classificação AI-4 provisória continuam válidas, só o "ADR dedicado ainda
por vir" deixou de ser um resíduo real.

---

## Convenções

- **Migrações**: string embutida em `packages/core/src/migrations.ts`, id
  sequencial `00NN_nome`, idempotente (`IF NOT EXISTS`/`ADD COLUMN IF NOT
  EXISTS`).
- **Tools novas**: entram negadas por Zero Trust; só ficam visíveis se em
  `DEFAULT_ALLOWED_TOOLS` (leitura) ou no `agent.permissions.tools` da soul;
  nível L1/L2/L3 declarado em `policy.ts`.
- **Segredos**: só em `~/.assistant-os/.env` / secrets do GitHub; nunca no
  repo.
- **Testes**: `npm run build` antes; `node --test` por workspace; conexões
  (Redis, pool) fechadas no `after()`.
- Ao fechar um item de "Aberto", mover a entrada pra "Concluído" com a data
  real, e atualizar o README se o item mudar uma feature já documentada lá.
- **Branches (desde 2026-09-06)**: `dev` é o branch de integração — todo PR
  mira `dev`; `main` só recebe promoções via PR `dev`→`main`. Detalhe em
  `CONTRIBUTING.md`/`AGENTS.md`.
