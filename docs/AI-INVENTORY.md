# Inventário de Sistemas de IA — Assistente OS

Gate AI-3 / Padrões v4.0. Cada componente que aplica um modelo de IA sobre
entrada em linguagem natural, com finalidade, dados de entrada, classificação de
risco (AI-1 mais baixo … AI-4 mais alto), guardrails efetivos e owner.

> Classificação de risco (v4.0, resumida):
> - **AI-1** — assistivo, saída sempre revisada por humano, sem dado pessoal.
> - **AI-2** — automação de baixo impacto, dado pessoal comum, reversível.
> - **AI-3** — decisão/ação com efeito operacional; exige trilha, limites e kill-switch.
> - **AI-4** — dado sensível (saúde, criança) ou efeito difícil de reverter.

| # | Sistema | Onde | Finalidade | Entrada | Risco | Guardrails efetivos | Owner |
|---|---|---|---|---|---|---|---|
| 1 | **Chat por soul** (tiers local/zen/soul) | `POST /souls/:id/chat` → `routes/chat.ts` | Responder o usuário no contexto da soul, com RAG | Prompt do usuário + markdown da soul + chunks RAG | **AI-3** | Zero Trust de tools; `dailyLimit`/`maxTurns` (429); content-filter I/O (12 padrões); detecção de prompt injection (`PROMPT_INJECTION_MODO`); gate de relevância RAG; trilha `execution_logs`/`router_history`/`cost_calls` | — (pendente) |
| 2 | **Agente LangGraph** (tier `langgraph`) | `langgraph-runner.ts` + `memory/agent-workflow.ts` | Multi-turno com tool-calling (memória/grafo/agenda/custos) | Prompt + histórico da sessão (reidratado do Postgres) | **AI-3** | `LANGGRAPH_MAX_ITERATIONS`; tools wrapadas passam pelo mesmo Zero Trust do MCP; `maxTurns` da sessão; content-filter na resposta; checkpoint isolado por `threadId=session-<id>` | — (pendente) |
| 3 | **Mission Runner (ORCA)** | `orchestrator/mission-runner.ts`, `POST /api/missions/:id/run`, MCP `mission_run` | Missões compostas (ingest + browser + agenda + auditoria) sem prompts intermediários | `mission_id` + soul override | **AI-3** | `mission_run` = L3 (`authorizeAgentSoul` fail-closed); modo `guarded`/`full` exige auditoria Guardian e marca `flagged`/interrompe se reprovar; `full` grava `execution_logs` | — (pendente) |
| 4 | **Extração de entidades/relações** | `daemon/entityExtraction.ts` + `memory/entity-extraction.ts` | Popular o grafo de conhecimento a partir de observações/documentos | Texto de observações e docs indexados da soul | **AI-2** | Isolado por soul (todas as escritas de grafo filtram `soul`); fila de jobs assíncrona; sem efeito externo | — (pendente) |
| 5 | **Guardian — auditoria de execução** | `core/governance/golden-rules.ts::auditExecution` | Nota de qualidade/conformidade 0–100 de uma execução | Resumo de mudanças + resultado de testes (sem PII de terceiros) | **AI-3** | Não decide sozinho: nota alimenta `flagged`; promoção de golden rule exige **código de aprovação humano por Telegram** (SHA-256, comparação em tempo constante); degrada para "pulado" se o LLM não responde | — (pendente) |
| 6 | **Pipelines de reunião / e-mail** | `pipelines/meeting-ingest.ts`, `pipelines/email-ingest.ts`, `POST /api/pipelines/*` | Transcrição/resumo → Markdown + chunks RAG + decisões | Transcrição VTT/SRT/TXT, corpo de e-mail | **AI-2** (**AI-4** se a soul for `familia_<telefone>` — ver ADR-PRIV-001) | Escrita só na pasta da soul; HMAC no webhook de ingestão; para famílias, retenção `FAMILIAS_RETENCAO_DIAS` + sweep de eliminação | — (pendente) |
| 7 | **Sales Intelligence** | `orchestrator/sales-intelligence.ts`, MCP `sales_*` | Brief de lead a partir de reunião de vendas | Transcrição/notas de reunião comercial | **AI-3** | `sales_*` = L3; escrita local; sem envio externo automático | — (pendente) |
| 8 | **Spec Grill** | `orchestrator/spec-grill.ts`, MCP `spec_grill_plan` | Refinar requisitos em 2 fases antes de autorizar "modo build" | Draft de feature do usuário | **AI-3** | `spec_grill_plan` = L3; produz plano para revisão humana, não executa | — (pendente) |
| 9 | **`soul_create` (criação guiada)** | MCP `soul_create`, `core/soul-spec.ts` | Materializar uma nova soul a partir de descrição | Payload wire (id, propósito, capabilities, markdown) | **AI-3** | L3 + `authorizeAgentSoul`; `dry_run` obrigatório antes do commit; guarda de `plan_hash`; `validateSoulSpec` (limites de tamanho, capabilities só do catálogo); criação atômica | — (pendente) |
| 10 | **Roteador local-first** | `core/router.ts` | Escolher o degrau (local/zen/soul) por sonda de disponibilidade | Config + resultado da sonda (sem conteúdo do prompt) | **AI-1** | Não aplica modelo ao conteúdo; só decide rota; toda tentativa em `router_history` imutável | — (pendente) |

## Telemetria não vaza contexto

`sanitizeVerdictForLog` (`core/sessions.ts`) remove `snippet`/`body` das fontes de
RAG antes de gravar `execution_logs.verdict` — mantém só `ok`/`motivo` e, por
fonte, `path`/`method`/`score`. `/infra/status` e o audit trail passam a expor
apenas metadados de retrieval. Coberto por `daemon/test/telemetry-no-leak.test.ts`.

O endpoint `/metrics` (E6) só expõe contadores/labels de baixa cardinalidade
(`soul`, `tier`, `mode`, `status`, `kind`, `severity`) — nenhum conteúdo de prompt
ou resposta.

## Kill-switch / limites

Provados por `daemon/test/kill-switch.test.ts` (o provider **não** é chamado quando
o limite corta):

- `dailyLimit` atingido → `429`.
- `maxTurns` da sessão atingido → `429`.
- `PROMPT_INJECTION_MODO=recusar` + severidade alta → `400`.

## Execution manifest

`GET /api/manifest` / `os manifest` (`core/manifest.ts`) — retrato reproduzível por
release: git sha, tiers, catálogo L1/L2/L3 versionado, hash do system prompt por
soul, dirs de contexto RAG e migrações aplicadas. `hash` determinístico
(`generatedAt` fora do hash).

## Pendências de governança (ação humana)

- Atribuir os **owners** de cada sistema acima (negócio / risco).
- Preencher a RACI de aprovação do **ADR-AI-003 §8** (owner de negócio, owner de
  risco, aprovador de governança) — hoje "pendente".
- Formalizar o perfil **AI-4** do domínio de famílias em ADR próprio (ver E9 / ADR-PRIV-001).
