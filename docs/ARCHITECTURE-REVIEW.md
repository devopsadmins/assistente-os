# Revisão de Arquitetura — consolidação de 3 análises

> Consolida: (1) a crítica ao template `ARCHITECTURE_CANVAS.md` proposto por soul,
> (2) o confronto do projeto contra a arquitetura de referência AI-First do curso
> "Arquitetura de Sistemas com IA" (caso TrialForge / Vitalis Pharma), e
> (3) três observações pontuais do usuário (Stitch OAuth, gate de compliance no CI,
> Prompt Garden).
>
> Formato igual ao [ROADMAP](ROADMAP.md): objetivo, estado verificado no código,
> arquivos, esforço (S ≈ ½–1 dia · M ≈ 2–4 dias · L ≈ 1–2 semanas), dependências.
> Este documento é **backlog selecionável** — nada aqui foi implementado.

## Diagnóstico em uma frase

O assistente-os tem governança forte no eixo **dados/decisão** (LGPD, Guardian OTP,
golden rules, ADRs, `rag` no hash do manifesto após os 7 epics de RAG) mas **não
estendeu esse rigor a dois lugares** — o pipeline de CI e os artefatos de
prompt/config — e carrega **uma pendência de segurança conhecida e documentada**
(Stitch MCP com bearer estático em vez de OAuth). As três análises convergem nisso.

---

## O que as 3 análises produziram

### Análise 1 — template `ARCHITECTURE_CANVAS.md` por soul

**Veredito:** o *conceito* (um canvas de decisão arquitetural versionado, no espírito
ML Canvas / Louis Dorard, como "filtro arquitetural oficial") é bom. O *template
específico* proposto estava ~50% aspiracional — descrevia primitivas que o projeto
não tem:

| Template dizia | Realidade no código |
|---|---|
| Escalonamento para Claude Sonnet | Não há provider Anthropic. Providers reais: Ollama + OpenCode Zen + opencode CLI |
| Model Cascading `Local→Fast→Pro` | Confunde dois eixos distintos: **tiers** `["local","zen","soul"]`+`langgraph` (fallback por *probe* de disponibilidade, `packages/core/src/router.ts`) × **ExecutionMode** `fast`/`pro` (por tamanho/keywords do prompt, `packages/daemon/src/orchestrator/router.ts`). Não há cascata por confiança |
| RAG híbrido 70/30 | `retrieveContext` faz vetorial (pgvector 768, HNSW) → fallback ILIKE literal. Sem BM25/RRF |
| Cache semântico | Cache é chave exata sha1, TTL 60s (`retrieveContext`). Não é semântico |
| HITL via `interrupt()` do LangGraph | Grafo é `retrieve→generate→tools→END`, `maxIterations` 5. Aprovação humana só existe como **Guardian OTP-over-Telegram** para promoção de golden rule |
| `ERR_BUDGET_EXCEEDED` / limite estourado | `dailyLimit` por soul → resposta HTTP 429, sem esse código |
| Parsing com Zod nos tool schemas | Não é o padrão do projeto |

**Recomendação:** adotar o canvas, mas **descritivo e gerado**, não redigido à mão:
- `os soul canvas <id>` preenche os blocos determinísticos a partir de
  `config.json` + `os manifest`; deixa em branco só os campos de decisão humana
  (qual ação exige aprovação, fallback esperado, custo do erro).
- Gerar **só para souls agentic** (tier `langgraph` + tools L3), não para todas.
- Vocabulário casado 1:1 com as primitivas reais (tabela acima).
- **Não** criar 19 arquivos manuais que vão apodrecer desatualizados.

### Análise 2 — projeto × arquitetura de referência do curso

**Já coberto** (informalmente, mas coberto): Gateway (rotas do daemon), Orchestrator
determinístico (`orchestrator/router.ts` + `authorizeExecution`), núcleo
Model+Tools+RAG, observabilidade + trilha de auditoria (`logFullAuditEntry` →
`sessoes/<data>.md`, `buildExecutionManifest` com hash determinístico, métricas
Prometheus `aos_*`), os 5 pilares de forma não-formalizada.

**Vale adotar** (gap real, primitiva já existe ou é barata):

| Item | Por quê | Onde encaixa |
|---|---|---|
| **Evaluation Gate** a partir de `os rag eval` | O primitivo foi construído no Epic C mas não roda contra corpus real nem trava CI | `docs/RAG-EVAL.md`, `ADR-RAG-001 §6` |
| **Cache semântico** no `retrieveContext` | Cache exato tem hit-rate baixo; similaridade de embedding aproveita paráfrase | `packages/memory/src/rag-chain.ts` |
| **Framework das 3 perguntas** como gate | (regra finita >90%? / erro caro-irreversível? / comportamento depende de contexto?) — hoje a decisão "isto precisa de IA?" é implícita | Canvas gerado (Análise 1) |
| **Cascata / escalonamento por confiança** | `local` responde primeiro; sobe para `zen`/`soul` só em baixa confiança (score de recuperação + `lg.usage`) | `packages/daemon/src/orchestrator/router.ts` |

**Não vale** (escala TrialForge, não copiloto single-node):
Saga/compensação e comportamento dirigido por CAP (não há partição de rede entre
agentes); GroupChat / Supervisor hierárquico (as missões são lineares e auditáveis);
K8s / Serverless / Edge / multi-região / budget por tenant elaborado
(`dailyLimit` por soul + pm2 bastam); Hybrid/RRF/Multi-Index/Agentic RAG **antes de
medir** — o `hybridSearch` antigo já era código morto e foi removido no Epic A.

### Análise 3 — três observações do usuário (verificadas)

1. **Stitch MCP: auth estática, não OAuth.** `docs/MCPS.md:43` diz textualmente que
   a config viva em `opencode.jsonc` "**não** usa OAuth — usa um bearer token
   estático (`headers.authorization: "bearer {env:stitch_access_token}"`)". O bloco
   `oauth` (`clientId`/`clientSecret`) está documentado como alvo, **não ligado**.
   Histórico: token `ya29.` já expirou causando `401` (sem refresh; `gcloud` não
   instalado). Curso Módulo 6 = *security from the start*, auth/authz real em MCP
   remoto. **Pendente, não implementado.**
2. **Nenhum gate de compliance no CI.** `.github/workflows/ci.yml` roda
   build → typecheck → test → *prime db* → *execution manifest* (só **anexa** o
   artefato; `if-no-files-found: error` só falha se o arquivo sumir, **não** em
   drift de hash). Não há checagem estilo Danger.js: PR ligado a item de tracking,
   descrição mínima, bloqueio de mudança em arquivo sensível sem aprovação, plano
   de rollback. Curso: "Governança como Código" roda isso na abertura do PR, não
   em checklist manual. Projeto tem governança de dados/ADR forte, mas não a
   estendeu ao CI.
3. **Sem "Prompt Garden".** Não existe pasta `prompts/`. Prompts espalhados:
   `packages/core/src/prompts/system-base.ts` (`CONCISE_OUTPUT_DIRECTIVE`),
   `packages/memory/src/prompt-templates.ts` (`langchainTemplates`), e literais
   inline em `pipelines/meeting-ingest.ts:277`, `pipelines/email-ingest.ts`,
   `orchestrator/spec-grill.ts`, `memory/src/entity-extraction.ts`,
   `memory/src/rerank.ts` (scorer LLM). Prompts de *soul* são versionados (git +
   `soulSystemPromptHash` em `manifest.ts:65`); os de **pipeline/tool** não têm
   diff, versão, nem estrutura padrão (papel / objetivo / regras / formato de saída).

---

## Backlog priorizado

### Tier 1 — fazer agora (gap real que o próprio projeto já admite, esforço S)

#### T1.1 — Gate de compliance no CI  *(Análise 3 #2)*  — ✅ implementado (branch `feat/ci-compliance-gate`, 2026-08-27)

**Objetivo:** o rigor de governança de dados/ADR passa a valer no PR, automaticamente.

**Arquivos entregues:**
- `.github/workflows/ci.yml` — job `compliance` (só em `pull_request`, sem Postgres, rápido).
- `.github/scripts/compliance-rules.mjs` — lógica pura `evaluateCompliance({body, changedFiles, labels}) → string[]`, sem deps.
- `.github/scripts/compliance-rules.test.mjs` — 13 testes `node --test` (rodam no CI antes do gate).
- `.github/scripts/compliance-gate.mjs` — wrapper: lê `GITHUB_EVENT_PATH` + diff `base...head`, sai 1 se houver pendência.
- `.github/pull_request_template.md` — seções `Descrição` / `Rastreabilidade` / `Rollback`.
- `CHANGELOG.md` (novo) — passa a ser exigido para mudança de config sensível.
- `docs/adr/ADR-AI-003.md` — nota T1.1 + linha no Histórico.

**Design (checagens, todas bloqueantes no PR):**
- Descrição do PR ≥ 50 chars (fora de comentários HTML).
- Referência de rastreabilidade: `ADR-XXX`, `roadmap`, `Exx`, `Tn.n` ou `#issue`.
- Linha `Rollback:` com plano real (`N/A`, `TBD`, `-` são rejeitados).
- **Paper trail em vez de `manifest.lock`:** o hash de `os manifest` inclui `gitSha`
  (muda a cada commit), então não serve de fingerprint de config. Substituído por
  checagem de path: mudança em `config.ts`/`policy.ts`/`migrations.ts`/`manifest.ts`/
  `prompts/`/`governance/`/`.github/workflows/` exige entrada nova em `docs/adr/` **ou**
  `CHANGELOG.md` no mesmo diff.
- Paths sensíveis (`packages/core/src/governance/**`, `packages/core/src/policy.ts`,
  `packages/core/src/migrations.ts`, `.github/**`, `docs/adr/**`) exigem label
  `governanca-revisada` (escape hatch para merge local: o gate roda só em PR).
- `os rag eval` já falha o CI hoje via `rag-eval.test.ts` dentro de `npm test` (corpus
  sintético). Rodá-lo contra corpus real é **T1.3**, não T1.1.

**Aceitação:** PR sem `Rollback:` falha; mudança em `policy.ts` sem label falha;
mudança em `config.ts` sem ADR/CHANGELOG falha; PR limpo passa. Coberto pelos 13 testes.

**Esforço:** S. **Depende de:** nada. Zero código de produto.

#### T1.2 — Stitch MCP: auth estática  *(Análise 3 #1)*  — ✅ resolvido por remoção (2026-08-27)

**Descoberta ao abrir o item:** não havia entrada `stitch` para migrar. Verificado
em `~/.config/opencode/opencode.jsonc` (global) e `/home/support/assistente-os/opencode.json`
(projeto) — nenhum dos dois tem `stitch`; `~/.assistant-os/.env` não tem `STITCH_*`
nem `GOOGLE_MCP_*`; `scripts/stitch-mcp.mjs` não existe mais. A entrada foi
**removida por inteiro** na limpeza de 2026-08-18, não só o token. Ou seja: o modo
de falha (`401` por token estático) não existe hoje — existe uma ausência.

**Decisão (usuário, 2026-08-27):** não religar. Stitch não é usado desde a remoção
e não há demanda de geração de UI no fluxo atual.

**Entregue:** `docs/MCPS.md` — seção `## stitch` reescrita como "descontinuado",
com o histórico do 401 preservado, sem o bloco `oauth` que sugeria migração, e com
a receita de religamento futuro via OAuth nativo do opencode (≥ 1.18 faz *dynamic
client registration* + fluxo no navegador; token estático **nunca mais**).

**Se reabrir no futuro:** `gcloud` agora está instalado nesta máquina (o `MCPS.md`
antigo dizia que não), então criar um OAuth Client no GCP deixou de ser bloqueio —
mas provavelmente nem é preciso, dado o DCR automático do opencode.

#### T1.3 — Evaluation Gate do RAG contra corpus real  *(Análise 2)*

**Objetivo:** transformar `os rag eval` (primitivo do Epic C) em evidência de
auditoria + trava de regressão para trocar `RAG_RERANK`/`OLLAMA_EMBED_MODEL`.

**Arquivos:**
- Novo: `~/.assistant-os/rag-golden.jsonl` — 15–25 casos derivados da hub-kb de
  `consultoria_ia` (formato em `docs/RAG-EVAL.md`).
- `docs/adr/ADR-RAG-001.md` §6 — preencher a tabela `off` × `cross-encoder`
  (hit@1 / hit@3 / MRR / recall@5).
- `.github/workflows/ci.yml` — `os rag eval consultoria_ia --min-hit1 <n>` como
  passo nomeado (ou job noturno se o tempo de Xenova pesar no PR).

**Passos:** semear o golden set → rodar `os rag eval consultoria_ia --rerank off`
e `--rerank cross-encoder` → colar números no ADR → só então ligar
`RAG_RERANK=cross-encoder` no `.env` do deploy.

**Esforço:** S. **Depende de:** Xenova disponível na máquina que roda o eval real.

### Tier 2 — próximo (valor claro, esforço M)

#### T2.1 — Prompt Garden  *(Análise 3 #3)*

**Objetivo:** prompts de pipeline/tool viram patrimônio versionado com diff + replay,
amarrado ao manifesto.

**Arquivos:**
- Novo: `packages/core/src/prompts/garden/` — 1 arquivo por prompt, cada um com
  frontmatter `papel` / `objetivo` / `regras` / `formato_saida` / `versao` e o
  corpo como `const` exportada (ou loader).
- Migrar literais inline: extração `email-ingest`, extração `meeting-ingest`,
  analista `spec-grill`, `entity-extraction`, template de resposta do `rag-chain`,
  scorer LLM do `rerank`, auditoria do Guardian.
- `packages/core/src/manifest.ts` — bloco `prompts` (sha256 por arquivo do garden)
  **dentro do hash**, mesma ideia do bloco `rag` do Epic E.
- `README.md` / `docs/ARCHITECTURE.md` — seção "Prompt Garden".

**Design:** refactor puro, **sem mudança de comportamento** (os textos são os mesmos,
só saem de dentro do código). "Qual versão de prompt rodou" passa a vir no hash do
manifesto; replay = checkout do commit + re-run. ~8 call sites.

**Aceitação:** nenhum literal de prompt multi-linha em `pipelines/`/`orchestrator/`;
`os manifest` muda de hash quando um arquivo do garden muda; suítes verdes sem edição.

**Esforço:** M. **Depende de:** nada (mas facilita T3.1).

#### T2.2 — Cache semântico no `retrieveContext`  *(Análise 2)*

**Objetivo:** subir o hit-rate do cache de RAG sem mudar resultado observável.

**Arquivos:** `packages/memory/src/rag-chain.ts` — cache de chave sha1 exata →
similaridade de embedding (limiar ~0.85, isolado por soul, invalidado no reindex
via `updated_at` do Epic A).

**Design:** **nunca** para geração de AIIA / artefato de família (esses exigem
determinismo). Medir hit-rate + custo poupado com as métricas Prometheus que já
existem antes de considerar "pronto".

**Esforço:** M. **Depende de:** `updated_at` em `chunks` (Epic A, já em `main`).

#### T2.3 — Canvas de arquitetura honesto + `os soul canvas`  *(Análise 1)*

**Objetivo:** o canvas como filtro arquitetural, descritivo e gerado.

**Arquivos:**
- Novo: `docs/ARCHITECTURE-CANVAS-TEMPLATE.md` — vocabulário real (tiers
  `local/zen/soul`+`langgraph` × mode `fast/pro`; vetorial+fallback literal;
  cache TTL 60s; Guardian OTP; trilha ISO 42001).
- `packages/cli/src/*` — `os soul canvas <id>`: preenche blocos determinísticos de
  `config.json` + `os manifest`; deixa em branco só decisão humana.

**Design:** gerar só para souls agentic (tier `langgraph` + tools L3). Sem os campos
fictícios da tabela da Análise 1.

**Esforço:** M. **Depende de:** T2.1 ajuda (o canvas cita quais prompts a soul usa).

### Tier 3 — depois / medir antes

#### T3.1 — Cascata de modelos / escalonamento por confiança  *(Análise 2)*

`local` responde primeiro; score de recuperação do RAG + `lg.usage` como sinais de
confiança; sobe para `zen`/`soul` só em baixa confiança. Mexe na lógica de mode em
`packages/daemon/src/orchestrator/router.ts`. Fazer **depois** de T2.1 (as prompts
da cascata entram no garden). **Esforço:** M.

#### T3.2 — Hybrid / RRF / Multi-Index / Agentic RAG  *(Análise 2)*

**Só se** o golden eval (T1.3) mostrar `hit@1 < 0.8` no corpus real. Medir antes de
construir. **Esforço:** L.

---

## Explicitamente fora de escopo

Escala TrialForge, não copiloto single-node:

- Saga / compensação, comportamento dirigido por CAP — não há partição de rede entre agentes.
- GroupChat (debate) / Supervisor hierárquico — missões são lineares e auditáveis assim.
- K8s / Serverless / Edge / multi-região, budget por tenant elaborado — `dailyLimit` por soul + pm2 cobrem a escala atual.
- Os campos fictícios do template de canvas original (escalonamento p/ Claude, cache semântico "já ligado", HITL via `interrupt()`) — corrigidos no template honesto (T2.3).

---

## Sequenciamento

```
T1.1 (CI gate)   ✅ feito
T1.2 (Stitch)    ✅ resolvido por remoção (não religar)
T1.3 (eval RAG)  ← próximo do Tier 1
      ↓
T2.1 (Prompt Garden)   → estende o manifesto; base para T3.1
      ↓
T2.2 (cache semântico) ‖ T2.3 (canvas)   independentes entre si
      ↓
T3.1 (cascata)   → depois do garden
T3.2 (hybrid)    → só se T1.3 pedir
```

**Maior alavancagem primeiro:** T1.1 fecha o buraco entre "temos governança" e
"o CI a aplica" e não toca código de produto.

---

## Nota operacional

O MCP `plugin:vercel:vercel` exige OAuth e não pôde ser autorizado nesta sessão
não-interativa — irrelevante para este backlog (nenhum item aberto depende dele),
mas registrado para não travar quem for executar.
