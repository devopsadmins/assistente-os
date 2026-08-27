# Roadmap de Implementação — Assistente OS

Backlog acionável dos itens abertos, com spec por epic. O **estado atual** (o que
já funciona) vive no [README](../README.md); este documento é só o que falta
**implementar**, em ordem de execução.

Cada epic traz: objetivo, estado atual verificado no código, arquivos afetados,
design, contratos/assinaturas, critérios de aceitação, plano de teste, esforço
(S ≈ ½–1 dia, M ≈ 2–4 dias, L ≈ 1–2 semanas) e dependências.

> **Execução (2026-08-27):** E1–E6, E8–E10 concluídos numa sessão (branch
> `feat/roadmap-execution`); E7 é doc + ação do usuário no dashboard Cloudflare.
> Testes: core 222 · daemon 119 · memory 48 · tools 22 · cli 2 (**413**, +36),
> typecheck limpo. Correção estrutural de quebra: `packages/daemon/tsconfig.json`
> excluía `src/test/**` — a suíte do daemon não compilava desde o commit
> `2db4a1d`; restaurada. Pendências residuais: assinaturas humanas (RACIs dos
> ADRs, owners do inventário), passo de CI para anexar o manifest, ação Cloudflare.

> **Nota de ground-truth (2026-08-27):** a seção *Pendências* do README estava
> desatualizada em três pontos verificados neste levantamento:
> 1. **Multi-turno já existe em grande parte** — `session_messages` (migração
>    `0009`), `recordSessionMessage`/`getRecentSessionMessages`, rotação de
>    sessão por inatividade (`sessionIdleTimeoutMinutes`, default 120 min) e
>    injeção de histórico no `buildPrompt` já estão implementados e ligados ao
>    `POST /souls/:id/chat`. O que falta é endurecimento (E2), não construção.
> 2. **Ciclo de vida da sessão** já tem rotação por idle; não é greenfield.
> 3. O restante (FinOps de tokens, scaffolding ORCA, `soul_create`/`worktree_list`,
>    observabilidade, gates AI-3, LGPD) confere com o README.

## Sequência de execução

| Onda | Epics | Racional |
|---|---|---|
| **1 — Métricas & produto** | E1 → E2 → E5 | Rápidas, alto valor, destravam E8 (manifest usa tokens) e a criação de souls via chat |
| **2 — ORCA & ops** | E4 → E3 · em paralelo: E7 → E6 | Ligar o scaffolding e subir observabilidade/segurança de borda |
| **3 — Governança & qualidade** | E8 → E9 → E10 | Fechar gates de conformidade e a melhoria de RAG |

| # | Epic | Esforço | Depende de |
|---|---|---|---|
| [E1](#e1--finops-fechar-a-captura-de-tokens-no-fluxo-de-chat) | FinOps — captura de tokens no chat ✅ | M | — |
| [E2](#e2--sessoes-multi-turno-finalizar-e-endurecer) | Sessões multi-turno — finalizar e endurecer ✅ | M–L | — |
| [E3](#e3--orca-ligar-o-mission-runner-ao-daemon) | ORCA — ligar o Mission Runner ✅ | L | E4 |
| [E4](#e4--orca-consumir-terminal-sanitizer-e-cache-em-camadas) | ORCA — consumir Terminal Sanitizer + cache ✅ | M | — |
| [E5](#e5--exposicao-mcp-soul_create-e-worktree_list) | Exposição MCP — `soul_create` + `worktree_list` ✅ | S–M | — |
| [E6](#e6--observabilidade-sentry-prometheus-grafana) | Observabilidade — Sentry + Prometheus/Grafana ✅ | M–L | — |
| [E7](#e7--cloudflare-access-service-token) | Cloudflare Access service token 📄 | S | — |
| [E8](#e8--governanca-ai-3-gates-de-producao) | Governança AI-3 — gates de produção ✅ | L | E1 |
| [E9](#e9--lgpd-fechar-adr-priv-001) | LGPD — fechar ADR-PRIV-001 ✅ | M | — |
| [E10](#e10--rag-estagio-de-reranking) | RAG — estágio de reranking ✅ | M | — |

---

## E1 — FinOps: fechar a captura de tokens no fluxo de chat

### Objetivo
Cada resposta de chat grava `prompt_tokens`, `completion_tokens`, `total_tokens`,
`model_used` e `execution_mode` em `router_history` e `tokens_in`/`tokens_out` em
`execution_logs` / `cost_calls`, para `getUsageSummary()` e a aba Telemetria
deixarem de reportar zero.

### Estado atual (verificado)
- `router_history` já tem as colunas (migração `0010_cost_usage_tracking`).
- `getUsageSummary()` (`packages/core/src/router.ts:151`) já agrega por
  `soul`/`mode`/`model`/período e é servido em `GET /api/costs/usage` + `os costs usage`.
- `packages/daemon/src/routes/chat.ts`:
  - grava `recordCostCall(pool, { inputTokens: 0, outputTokens: 0, cost: 0, ... })`;
  - grava `recordExecution(pool, { ... })` **sem** `tokensIn`/`tokensOut`;
  - `recordRouterSelection` (assinatura já aceita tokens) só é chamado no branch
    `requestedTier === "langgraph"` e mesmo lá sem valores; o INSERT normal vem de
    `route()` (`router.ts:96`), que usa o INSERT de 8 colunas, sem tokens.
- Nenhum dos três executores devolve contagem de tokens:
  - `ollamaChat()` (`chat.ts:36`) faz `JSON.parse` e joga fora `prompt_eval_count`
    / `eval_count` — **o mesmo Ollama já expõe isso** e `pipelines/meeting-ingest.ts:143`
    já lê esses campos (padrão a copiar).
  - `runLangGraphAgentStream()` (`packages/daemon/src/langgraph-runner.ts:145`)
    devolve `{ code, stdout, stderr, timedOut, toolCalls? }`.
  - `run()` opencode (`packages/daemon/src/runner.ts`) devolve `{ code, stdout, stderr, timedOut }`.

### Arquivos afetados
- `packages/daemon/src/routes/chat.ts` — propagar tokens dos 3 branches.
- `packages/daemon/src/routes/chat.ts::ollamaChat` — parsear e devolver `prompt_eval_count`/`eval_count`.
- `packages/daemon/src/langgraph-runner.ts` — somar `usage_metadata` das mensagens do grafo.
- `packages/daemon/src/runner.ts` — expor uso quando o opencode emitir JSON (`--print-logs`/saída estruturada); senão estimar.
- `packages/core/src/router.ts` — `route()` passa a aceitar/gravar tokens opcionais (ou novo `finalizeRouterSelection`).
- `packages/core/src/tokens.ts` **(novo)** — `estimateTokens(text): number` (heurística `chars/4`, já usada em `buffer`) como fallback declarado.

### Design
1. **Tipo comum de resultado de execução** — estender o retorno dos 3 executores
   com `usage?: { promptTokens?: number; completionTokens?: number; source: "provider" | "estimate" }`.
2. **Ollama** — ler `prompt_eval_count` → `promptTokens`, `eval_count` → `completionTokens`, `source: "provider"`.
3. **LangGraph** — no `onStep`/estado final, somar `msg.usage_metadata.input_tokens` /
   `output_tokens` de cada `AIMessage` (LangChain preenche via `ChatOpenAI`). `source: "provider"` se todas as mensagens tiverem metadata, senão `"estimate"`.
4. **opencode** — se a saída tiver bloco de uso, parsear; senão
   `estimateTokens(fullPrompt)` + `estimateTokens(stdout)` com `source: "estimate"`.
5. **Persistência** — depois da execução:
   - `finalizeRouterSelection(pool, { selectionId | (soul,target,ts), promptTokens, completionTokens, totalTokens, modelUsed, executionMode })` — faz `UPDATE router_history SET ... WHERE id = $1` da linha vencedora (retornar `id` de `route()`), ou insere uma linha `status='ok'` se preferir append-only (decisão: **UPDATE da linha vencedora**, mantém 1 linha por turno).
   - `recordCostCall` recebe `inputTokens`/`outputTokens` reais; `cost` continua 0 nos tiers grátis, mas passa a ser calculável quando houver tabela de preço por modelo (fora de escopo aqui).
   - `recordExecution` recebe `tokensIn`/`tokensOut`.
6. **`execution_mode`** — já vem de `orchDecision.mode` (`fast`/`pro`); persistir junto.

### Contratos
```ts
// packages/core/src/router.ts
export interface RouterUsagePatch {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelUsed: string;
  executionMode: string;
  tokenSource: "provider" | "estimate";
}
export async function finalizeRouterSelection(pool: Pool, selectionId: number, patch: RouterUsagePatch): Promise<void>;
// route() passa a retornar { target, latencyMs?, reason?, selectionId: number }
```
```ts
// packages/core/src/tokens.ts
export function estimateTokens(text: string): number; // Math.ceil(text.length / 4)
```

### Status: ✅ CONCLUÍDO (2026-08-27)

Implementação divergiu do design em um ponto: em vez de `finalizeRouterSelection`
(UPDATE da linha de sonda), grava-se uma linha nova `status='executed'` pós-inferência
e `getUsageSummary` passou a filtrar `status='executed'` — as linhas de sonda de
`route()`/`selectRoute()` (`status ok/fail`) ficam só para diagnóstico. Mais simples e
não mexe na assinatura de `route()` (vários callers: agenda, events, orchestrator).

### Critérios de aceitação
- [x] Chat no tier `local` grava `prompt_tokens`/`completion_tokens` > 0 do Ollama (`prompt_eval_count`/`eval_count`), `tokenSource=provider`.
- [x] Chat no tier `langgraph` acumula `usage_metadata` de cada nó `generate` (reducer `usage` no `AgentState`); cai para estimativa se o provider não expõe metadata.
- [x] Chat no tier `soul` (opencode) grava tokens estimados (`estimateTokens(prompt)+estimateTokens(stdout)`), `tokenSource=estimate` no `note`.
- [x] `GET /api/costs/usage?soul=<id>` retorna `total_tokens` > 0 após um chat (teste `daemon.test.ts`).
- [x] `execution_mode` (`fast`/`pro`) preenchido em toda linha `executed`.
- [x] Exatamente **uma** linha `status='executed'` em `router_history` por turno bem-sucedido.
- [x] Falha/timeout **não** grava tokens nem linha `executed`.

Testes: `core/test/tokens.test.ts` (3), `core/test/usage-summary.test.ts` (2),
`daemon.test.ts::E1/FinOps` (1). Suítes: core 216, daemon 101, memory 44, tools 19 — verdes.

### Plano de teste
- Unit `packages/core/test/router.test.ts` — `finalizeRouterSelection` atualiza a linha certa; `getUsageSummary` soma corretamente por `mode`/`model`.
- Unit `packages/core/test/tokens.test.ts` — `estimateTokens`.
- Unit `packages/daemon/test/chat-usage.test.ts` — mock dos 3 executores devolvendo `usage`; asserta os INSERT/UPDATE (pool de teste).
- Live `packages/daemon/test/*.live.ts` — chat real no Ollama confere `total_tokens` ≈ `prompt_eval_count + eval_count`.

### Esforço: **M** · Dependências: nenhuma

---

## E2 — Sessões multi-turno: finalizar e endurecer

### Objetivo
Histórico multi-turno robusto: (a) truncado por orçamento de tokens, (b)
persistente para o agente LangGraph através de restart, (c) coberto também nos
caminhos `events`/`agenda`, (d) isolado por cliente quando fizer sentido.

### Estado atual (verificado)
- `session_messages` (`migrations.ts:274`, migração `0009`), `recordSessionMessage`,
  `getRecentSessionMessages(sessionId, turns)` — pega os últimos `turns*2` sem
  orçamento de chars/tokens (`sessions.ts:133`).
- `openSession` já rotaciona por inatividade (`sessionIdleTimeoutMinutes()`, default 120 min).
- `chat.ts` persiste turno `user` + `assistant` e injeta `history` no `buildPrompt`
  (`chat.ts:220` e `:395`). LangGraph usa `threadId: session-${session.id}`.
- **Lacunas:**
  - `getRecentSessionMessages` não respeita o `ctx` do Ollama (default 2048) — histórico grande empurra o system prompt/RAG para fora da janela.
  - MemorySaver do LangGraph é in-memory (comentário explícito em `chat.ts`): não sobrevive a restart do daemon; o histórico persistido em `session_messages` **não** é reinjetado no `threadId` após restart.
  - `events.ts:71` e `agenda.ts:44` chamam `openSession`+`bumpSessionPrompt` mas nunca `recordSessionMessage` — execuções por evento/agenda não acumulam memória.
  - Uma soul tem **uma** sessão aberta global (`idx_sessions_soul_open (soul) WHERE ended_at IS NULL`): dois clientes conversando com a mesma soul compartilham histórico.

### Arquivos afetados
- `packages/core/src/sessions.ts` — `getRecentSessionMessages` com orçamento; `openSession` com chave de cliente opcional.
- `packages/core/src/migrations.ts` — `0011_session_client_key` (coluna `client_key TEXT` + índice único parcial `(soul, client_key) WHERE ended_at IS NULL`).
- `packages/daemon/src/routes/chat.ts` — passar `clientKey` (header `X-Client-Id` ou hash do token) para `openSession`; reidratar `threadId` do LangGraph a partir de `session_messages`.
- `packages/daemon/src/langgraph-runner.ts` — aceitar `seedMessages` para popular o checkpoint; opção de `PostgresSaver`.
- `packages/daemon/src/events.ts`, `packages/daemon/src/agenda.ts` — gravar as mensagens.
- `packages/memory/src/context.ts` / `buildPrompt` — cortar histórico ao orçamento antes de montar.

### Design
1. **Orçamento de histórico** — `getRecentSessionMessages(pool, sessionId, { maxTurns, maxChars })`;
   `buildPrompt` reserva `RAG + system + prompt` e passa `maxChars = ctxTokens*4 - reservado`.
   Corte do turno mais antigo primeiro; nunca corta o turno atual.
2. **Persistência do agente** — duas opções:
   - **(recomendada)** *reidratação*: ao abrir o chat, ler `session_messages` e
     passar como `seedMessages` para `runLangGraphAgentStream`, que injeta no
     estado inicial do grafo antes do primeiro nó. Mantém MemorySaver in-memory,
     mas o restart deixa de perder contexto porque a fonte de verdade é o Postgres.
   - *checkpoint Postgres*: trocar `MemorySaver` por `@langchain/langgraph-checkpoint-postgres`.
     Mais fiel ao modelo de threads do LangGraph, mais dependência/tabela nova.
   Decisão: **reidratação** agora; checkpoint Postgres fica como nota se surgir
   necessidade de estado além de mensagens (ex.: scratchpad de ferramentas).
3. **Cobertura events/agenda** — após a execução, `recordSessionMessage(user=título/corpo, assistant=stdout)` no mesmo padrão do chat.
4. **Isolamento por cliente** — `client_key` derivado de `X-Client-Id` (se enviado)
   ou `sha256(token).slice(0,16)`. Sem header e sem token → `client_key = 'default'`
   (comportamento atual). Índice único parcial garante 1 sessão aberta por
   `(soul, client_key)`.

### Contratos
```ts
export interface HistoryBudget { maxTurns: number; maxChars: number; }
export async function getRecentSessionMessages(
  pool: Pool, sessionId: number, budget: HistoryBudget,
): Promise<SessionMessage[]>;
export async function openSession(
  pool: Pool, soul: string, maxTurns: number, budgetCap?: number, clientKey?: string,
): Promise<SessionRecord>;
// langgraph-runner
interface RunAgentOpts { /* ...atual... */ seedMessages?: SessionMessage[]; }
```

### Status: ✅ CONCLUÍDO (2026-08-27)

Migração ficou como `0012_sessions_client_key` (0011 foi usada pelo E1).

### Critérios de aceitação
- [x] `getRecentSessionMessages(pool, id, { maxTurns, maxChars })` corta os turnos mais antigos até caber no teto (`sessionHistoryMaxChars()`, env `ASSISTENTE_OS_SESSION_HISTORY_MAX_CHARS`, default 6000); chat.ts passa o orçamento. Compat com a assinatura antiga (número puro).
- [x] Reidratação LangGraph: `seedMessages` injeta o histórico do Postgres no estado inicial do grafo, **uma vez por thread por processo** (`seededThreads` + `__resetSeededThreads` p/ teste). Após restart o Set volta vazio → reinjeta. Cobertura live (precisa LLM).
- [x] `X-Client-Id` (ou hash do token, senão `default`) → `client_key`; índice único parcial `(soul, client_key) WHERE ended_at IS NULL`; histórico não vaza entre clientes (teste `sessions.test.ts`).
- [x] `events.ts` e `agenda.ts` gravam `recordSessionMessage(user, assistant)` em sucesso.
- [x] `sessionIdleTimeoutMinutes` intacto (regressão verde).

Testes: `core/test/sessions.test.ts` +2 (orçamento maxChars, isolamento client_key). Suítes: core 218, daemon 101, memory 44, tools 19, cli 2 — verdes.

### Plano de teste original
- Unit `sessions.test.ts` — orçamento, `client_key`. ✅
- Live — restart no meio da conversa LangGraph (não no `npm test`).

### Esforço: **M–L** · Dependências: nenhuma

---

## E3 — ORCA: ligar o Mission Runner ao daemon

### Objetivo
Missões compostas (`meetingIngestFull`, etc.) executáveis via REST + MCP, com os
steps hoje falsos (`browser-*`, `guardian-audit`) fazendo trabalho real.

### Estado atual (verificado)
- `packages/daemon/src/orchestrator/mission-runner.ts` — `MISSIONS` estático,
  `runMission(missionId)` exportado, **sem rota, sem tool**. `runStep()` retorna
  literal `{ ok: true, note: "browser-navigate placeholder" }` para todos os
  `browser-*` e para `guardian-audit` (linhas 101–113).
- `meeting-ingest` e `agenda-add` já chamam pipeline/kernel reais.
- `browser.ts` (automação real via Playwright) e `guardian_audit_execution`
  (tool MCP) já existem e podem ser chamados.

### Arquivos afetados
- `packages/daemon/src/orchestrator/mission-runner.ts` — steps reais, telemetria, WS.
- `packages/daemon/src/routes/missions.ts` **(novo)** — `GET /api/missions`, `POST /api/missions/:id/run`.
- `packages/daemon/src/server.ts` — registrar a rota.
- `packages/tools/src/index.ts` — tools `mission_list`, `mission_run` (Zero Trust: L2/L3 conforme os steps; `full`/`guarded` → L3 por causa do guardian-audit e efeitos).
- `packages/core/src/policy.ts` — nível das novas tools.
- `packages/daemon/src/index.ts` — export.

### Design
1. **Steps reais:**
   - `browser-navigate|click|extract|screenshot` → delegar para as funções de `browser.ts` (sessão headless por `taskId`).
   - `guardian-audit` → `guardianAuditExecution({ soul, executionId | note })`, anexando o resultado ao retorno da missão.
2. **Modos** (já previstos no header do arquivo):
   - `headless` — sem auditoria, sem WS.
   - `guarded` — + step Guardian ao final; se a auditoria falhar, a missão termina `status: "flagged"`.
   - `full` — + broadcast WS por step (`mission.step`) + registro em `execution_logs` + respeito à retenção LGPD nos artefatos.
3. **Isolamento** — missões `full`/`guarded` rodam dentro de uma worktree
   (`createWorktree`) quando algum step escreve no repo; missões só de
   leitura/ingestão não precisam.
4. **Autorização** — `authorizeExecution()` antes de cada step com efeito externo;
   `mission_run` de missão com step L3 exige a política de aprovação da soul.

### Contratos
```ts
export interface MissionResult {
  missionId: string;
  mode: Mission["mode"];
  status: "ok" | "flagged" | "failed";
  steps: Array<{ type: MissionStep["type"]; ok: boolean; note?: string; data?: unknown }>;
  audit?: GuardianAuditResult;
  startedAt: string; finishedAt: string;
}
export async function runMission(missionId: string, opts?: { soulOverride?: string; taskId?: string; onStep?: (s: MissionStepEvent) => void }): Promise<MissionResult>;
```
REST: `POST /api/missions/:id/run` → `202` + `{ taskId }`; progresso via WS; `GET /api/missions/:id/run/:taskId` → `MissionResult`.

### Status: ✅ CONCLUÍDO (2026-08-27)

`mission-runner.ts` reescrito: `runMission(id, { soulOverride, onStep })` + `listMissions()`.
Steps reais: `browser-navigate|click|extract|screenshot|close` → `browser.ts`;
`agenda-add` → `addAgendaItem`; `guardian-audit` → `auditExecution` (degrada para
"pulado" quando o Guardian/Ollama não responde, em vez de derrubar a missão).
Modos: `guarded`/`full` marcam `flagged` se a auditoria reprovar e interrompem;
`full` faz broadcast WS `mission.step` (pela rota) + registra em `execution_logs`.
Bugs corrigidos de quebra: `getPool(home)` → `getPool(config.databaseUrl)`;
`resolveSoul` agora honra o `soulId` pedido.

- **REST**: `GET /api/missions`, `POST /api/missions/:id/run` (síncrono; 200, ou
  207 se `status=failed`, ou 404 se a missão não existe). Sem a variante `202+taskId`
  do design original — execução síncrona basta para as missões atuais.
- **MCP**: `mission_list` (L1), `mission_run` (L3, `authorizeAgentSoul` fail-closed).
- **Fix estrutural achado no caminho:** `packages/daemon/tsconfig.json` **excluía
  `src/test/**`** (commit `2db4a1d`) — a suíte do daemon não compilava nem rodava
  desde então. Removido o `exclude`; 4 testes pré-existentes de `worktree-manager`
  quebrados (`new WorktreeManager("x", { autonomy: "auto" })` sem `permissions`/
  `guardrails`) corrigidos para `createTestAgentConfig(...)`.

### Critérios de aceitação
- [x] `GET /api/missions` / `mission_list` listam id, modo e nº de steps.
- [x] `runMission` executa todas as etapas mesmo com falha intermediária; `agenda-add` persiste item real (teste).
- [x] `browser-extract` chama `browserExtractText` real (não placeholder).
- [x] `guarded`/`full` com auditoria reprovando → `status: "flagged"`, interrompe.
- [x] `mission_run` via MCP fail-closed sem `AGENT_SOUL_ID` (teste).
- [x] `onStep`/`mission.step` disponível para broadcast WS na rota.

Testes: `daemon/test/mission-runner.test.ts` (4), `tools.test.ts` +1. Suítes: core 219, **daemon 108** (agora compila!), memory 44, tools 22, cli 2 — verdes.

### Esforço: **L** · Dependências: **E4** (feito)

---

## E4 — ORCA: consumir Terminal Sanitizer e cache em camadas

### Objetivo
Tirar `terminal-sanitizer.ts` e `core/cache.ts` do status de código morto,
ligando-os aos caminhos de produção que se beneficiam deles.

### Estado atual (verificado)
- `packages/daemon/src/tools/terminal-sanitizer.ts` — só re-exportado em
  `packages/daemon/src/index.ts:7`, nenhum chamador.
- `packages/core/src/cache.ts` — `export const cache = new CacheService()` em
  `core/src/index.ts:28`; nenhuma chamada `cache.get/set/wrap` em produção
  (só aparece em `cache.test.ts`).

### Arquivos afetados
- `packages/daemon/src/tools/worktree-manager.ts` — sanitizar saída de `npm run build`/`npm test`/`git` no `mergeLocally` antes de logar/retornar.
- `packages/daemon/src/orchestrator/mission-runner.ts` — sanitizar saída de steps que rodam shell (coordenar com E3).
- `packages/daemon/src/tools/browser.ts` (opcional) — truncar dumps de acessibilidade grandes.
- `packages/memory/src/context.ts` / `retrieveContext` — `cache.wrap` no resultado de RAG por `(soulId, hash(prompt))`, TTL curto (ex.: 60 s).
- `packages/core/src/router.ts::getUsageSummary` — `cache.wrap` por `(filtros)`, TTL ~30 s (a aba Telemetria faz polling).
- `packages/daemon/src/routes/*` — invalidar (`cache.del`) as chaves de usage após `finalizeRouterSelection` (integra com E1).

### Design
1. **Sanitizer** — envelopar toda captura de stdout/stderr de subprocessos com
   `sanitizeTerminalOutput(text, { keep: "tail", maxLines })`: mantém as últimas N
   linhas + resumo (`… +1240 linhas`), poupando tokens quando a saída entra em
   prompt ou audit trail. Não altera o `code`/`timedOut`.
2. **Cache** — `cache.wrap(key, ttlSeconds, fn)`:
   - RAG retrieve: chave `rag:${soulId}:${sha1(prompt)}`; evita reembedar/reconsultar em repetições rápidas (voz, retries de UI).
   - `getUsageSummary`: chave `usage:${JSON.stringify(filters)}`; invalidada em toda escrita de token.
   - Redis quando `REDIS_URL` presente; fallback em memória (já implementado em `cache.ts`). `cache.close()` no shutdown do daemon (padrão já usado em `cache.test.ts`).

### Contratos
```ts
// terminal-sanitizer.ts (já existe; confirmar assinatura pública)
export function sanitizeTerminalOutput(text: string, opts?: { keep?: "head" | "tail"; maxLines?: number }): string;
// core/cache.ts (já existe)
cache.wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T>;
```

### Status: ✅ CONCLUÍDO (2026-08-27)

- **Sanitizer** ligado em `worktree-manager.mergeLocally`: a saída de `npm run build`
  e `npm test` que falha passa por `sanitizeCommandOutput` antes de virar mensagem
  de erro — mantém as linhas relevantes (erros/resumo), corta o ruído.
- **Cache** em `getUsageSummary` (`core/router.ts`, TTL 30s) e `retrieveContext`
  (`memory/rag-chain.ts`, TTL 60s). Chave inclui `poolTag` (hash do connectionString)
  para não vazar resultado entre schemas em teste. Sem `init()` explícito → só
  memória (Redis é opt-in no boot do daemon); degrada em silêncio.
- Invalidação: TTL curto no lugar de `del` por chave (chaves são combos de filtro);
  a aba Telemetria faz polling, 30s de staleness é aceitável.
- **Não feito aqui:** sanitizer nos steps do Mission Runner (fica em E3);
  truncamento de dumps de acessibilidade em `browser.ts` (opcional, fora de escopo).

### Critérios de aceitação
- [x] `mergeLocally` com `npm test` verboso → erro truncado, veredito correto (teste `worktree-manager.test.ts`).
- [x] `retrieveContext` idêntico em < 60s serve do cache (não re-embeda).
- [x] `getUsageSummary` repetido em < 30s serve do cache (teste `usage-summary.test.ts`); reflete o novo valor após o TTL.
- [x] Sem `REDIS_URL`: fallback em memória, suítes não travam (nenhum `init()` novo).

Testes: `worktree-manager.test.ts` +1, `usage-summary.test.ts` +1. Suítes: core 219, daemon 101, memory 44, tools 21, cli 2 — verdes.

### Esforço: **M** · Dependências: integra com E1

---

## E5 — Exposição MCP: `soul_create` e `worktree_list`

### Objetivo
Criar souls guiadas por chat e listar worktrees ativas via MCP, sem sair para
REST/CLI.

### Estado atual (verificado)
- Backend de criação pronto e testado: `createSoulFull` (`packages/core/src/souls.ts:127`),
  `validateSoulSpec`/`buildAgentConfigFromSpec`/`resolveSoulSpecDefaults`
  (`packages/core/src/soul-spec.ts`), catálogo de capabilities L1/L2/L3
  (`policy.ts`), `planHash` determinístico para dry-run vs. commit.
- `packages/tools/src/index.ts` **não** registra `soul_create` (grep vazio).
- `worktree_create` / `worktree_merge_locally` / `worktree_destroy` são tools MCP
  (`tools/src/index.ts:655–685`); `worktree_list` só existe em REST (`/api/worktree` GET)
  e CLI (`os worktree list`).

### Arquivos afetados
- `packages/tools/src/index.ts` — declarar as 2 tools no array + `case` no dispatcher; adicionar a `SOUL_SCOPED_TOOLS` (autorização) e `worktree_list` a `DEFAULT_ALLOWED_TOOLS` (leitura L1).
- `packages/core/src/policy.ts` — `soul_create` = **L3** (efeito estrutural: cria diretórios + config); `worktree_list` = **L1**.
- `packages/tools/src/soul-create-wire.ts` **(novo)** — mapeia payload wire (snake_case, string-only friendly) → `SoulSpec`.
- `docs/MCPS.md` — documentar (contagem 50 → 52).

### Design
1. **`soul_create`** — parâmetros wire:
   ```
   soul_id, display_name, purpose, provider?, models?(json), daily_limit?,
   max_turns?, capabilities?(csv), connectors?(json), skills?(json),
   dry_run?(bool, default true)
   ```
   Fluxo: `mapWireToSoulSpec()` → `validateSoulSpec()` →
   - `dry_run: true` → retorna `{ plan_hash, resolved_spec, issues[], would_create: [paths] }`, **não escreve**.
   - `dry_run: false` → exige `plan_hash` do dry-run anterior (guarda contra mudança entre planejar e aplicar) → `createSoulFull()` → retorna `{ soul_id, created: true, plan_hash }`.
   - Autorização L3: `authorizeExecution()` com a política da soul chamadora; recusa se `autonomy` não permitir efeito estrutural.
2. **`worktree_list`** — sem parâmetros; retorna o mesmo payload do `GET /api/worktree`
   (`taskId`, branch, path, base, soul, `created_at`, estado git). Reusa o handler existente.

### Contratos
```ts
// tool: soul_create
type SoulCreateInput = { soul_id: string; display_name: string; purpose: string;
  provider?: string; models?: string; daily_limit?: number; max_turns?: number;
  capabilities?: string; connectors?: string; skills?: string; dry_run?: boolean; plan_hash?: string; };
type SoulCreateResult =
  | { dry_run: true; plan_hash: string; resolved_spec: SoulSpec; issues: SoulSpecValidationIssue[]; would_create: string[] }
  | { dry_run: false; soul_id: string; created: true; plan_hash: string };
// tool: worktree_list -> WorktreeInfo[]
```

### Status: ✅ CONCLUÍDO (2026-08-27)

- `createSoulFromSpec` (novo em `core/soul-spec.ts`) — `SoulSpec` resolvido → `createSoulFull` atômico.
- `soulSpecFromWire` (em `tools/index.ts`) — payload snake_case → `SoulSpec`.
- `listWorktrees` (novo em `daemon/worktree-manager.ts`) — `git worktree list --porcelain`, filtra sob o workspaces root, extrai branch/HEAD reais. REST `GET /api/worktree` passou a usá-la (antes só `readdir`).
- `worktree_list` = L1 no catálogo + `DEFAULT_ALLOWED_TOOLS`; `soul_create` já era L3, adicionado a `SOUL_SCOPED_TOOLS` (autoriza via `AGENT_SOUL_ID`).

### Critérios de aceitação
- [x] `soul_create` `dry_run:true` → `plan_hash` + `issues` + `would_create`, **não** escreve (teste `tools.test.ts`).
- [x] `dry_run:false` + `plan_hash` válido cria a soul atomicamente (`createSoulFromSpec` → `createSoulFull`); `plan_hash` divergente → erro explícito.
- [x] `soul_create` exige `AGENT_SOUL_ID` + autorização L3 da soul chamadora (`authorizeAgentSoul`).
- [x] `worktree_list` via MCP e via REST usam a mesma `listWorktrees`.
- [x] Zero Trust: `soul_create` fora da allowlist → não aparece em `tools/list`.
- [ ] `docs/MCPS.md` atualizado (52 tools) — README atualizado; MCPS.md pendente.

Testes: `tools.test.ts` +2 (worktree_list exposta/responde; soul_create dry-run/commit/hash), `worktree-manager.test.ts` +1 (listWorktrees filtra + parse). Suítes: core 218, daemon 101, memory 44, tools 21, cli 2 — verdes.

### Esforço: **S–M** · Dependências: nenhuma

---

## E6 — Observabilidade: Sentry, Prometheus/Grafana

### Objetivo
Erros do daemon rastreados (Sentry) e métricas em série temporal
(Prometheus + Grafana), substituindo o `/infra/status` sob demanda como única fonte.

### Estado atual (verificado)
- Zero `@sentry/*`, zero `prom-client`/`@opentelemetry/*` no repo.
- `GET /infra/status` dá um snapshot (Ollama, Postgres, CPU, RAM, disco, RAG, eventos, execuções).
- PM2 com `pm2-logrotate`; três apps no `ecosystem.config.cjs`.

### Arquivos afetados
- `packages/daemon/package.json` — `@sentry/node`, `prom-client`.
- `packages/daemon/src/observability/sentry.ts` **(novo)** — init condicional a `SENTRY_DSN`.
- `packages/daemon/src/observability/metrics.ts` **(novo)** — registry + coletores.
- `packages/daemon/src/server.ts` — `Sentry.setupExpressErrorHandler`/wrapper no handler HTTP; rota `GET /metrics` (Bearer, como as demais).
- `packages/daemon/src/routes/chat.ts`, `agenda.ts`, `events.ts`, `orchestrator/*` — incrementar contadores/histogramas.
- `docker-compose.yml` — serviços `prometheus` + `grafana` (opcionais, perfil `observability`).
- `ops/prometheus.yml`, `ops/grafana/` **(novos)** — scrape config + dashboard provisionado.
- `README.md` — seção Deploy/Observabilidade.

### Design
1. **Sentry** — `init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0.1, environment })`.
   Sem DSN → no-op (dev). Capturar exceções não tratadas do handler, do loop de
   agenda e do runner LangGraph; `beforeSend` roda o `contentFilter` para não
   vazar segredo em mensagem de erro.
2. **Métricas** (`prom-client`, prefixo `aos_`):
   - `aos_chat_requests_total{soul,tier,mode,status}`
   - `aos_chat_latency_seconds{tier}` (histograma)
   - `aos_tokens_total{soul,tier,kind=prompt|completion}` (alimentado pelo E1)
   - `aos_router_fallback_total{from_tier,to_tier}`
   - `aos_agenda_queue_depth`, `aos_events_pending`
   - `aos_guardian_pending_rules`, `aos_prompt_injection_alerts_total{severity}`
   - default metrics (event loop lag, heap) via `collectDefaultMetrics`.
3. **Grafana** — 1 dashboard provisionado: throughput/latência de chat, tokens por
   soul, fallback do roteador, profundidade das filas, alertas de segurança.
4. **Alertas** (Prometheus rules): daemon down, `agenda_queue_depth` alto e
   crescente, pico de `prompt_injection_alerts`, erro 5xx sustentado.

### Status: ✅ CONCLUÍDO (2026-08-27)

- `prom-client` + `@sentry/node` adicionados ao `packages/daemon`.
- `observability/metrics.ts` — registry `aos_` + `chatRequests`, `chatLatency`,
  `tokensTotal`, `routerFallback` (definido; wiring core→daemon fica para um hook
  futuro), `promptInjectionAlerts`, `agendaQueueDepth`, `eventsPending` + default metrics.
- `observability/sentry.ts` — `initSentry()` no-op sem `SENTRY_DSN`; `captureError()`
  com fallback pra log; `beforeSend` roda o content-filter.
- `routes/metrics.ts` — `GET /metrics` (Bearer via dispatcher); atualiza os gauges de
  fila antes de responder; não falha se o DB cair.
- `server.ts` — `initSentry()` no boot; `captureError` no catch do handler HTTP.
- `chat.ts` — instrumenta requests/latência/tokens/injection.
- `docker-compose.yml` — profile `observability` (Prometheus `:9090` + Grafana `:3001`);
  `ops/prometheus.yml`, `ops/rules.yml` (4 alertas), `ops/grafana/provisioning/*`
  (datasource + dashboard "Assistente OS — visão geral").

### Critérios de aceitação
- [x] `GET /metrics` → exposição Prometheus válida, `text/plain`, com `aos_*` (teste `daemon.test.ts`).
- [x] Chat incrementa `aos_chat_requests_total` + observa `aos_chat_latency_seconds`.
- [x] `aos_tokens_total{kind=prompt|completion,source}` alimentado pelo `finalUsage` do E1.
- [x] Sentry captura exceção do handler quando `SENTRY_DSN` setado; `beforeSend` mascara segredo; no-op sem DSN.
- [x] `docker compose --profile observability up` sobe Prometheus + Grafana com dashboard provisionado.
- [x] Sem `SENTRY_DSN`/sem profile: daemon idêntico ao atual (suítes verdes).

Testes: `daemon.test.ts` +1 (`/metrics`). Suítes: core 219, daemon 109, memory 44, tools 22, cli 2 — verdes.

### Esforço: **M–L** · Dependências: E1 (feito)

---

## E7 — Cloudflare Access service token

### Objetivo
Bypass programático do Cloudflare Access no domínio público
(`assistente-os.coderstudio.club`), para agentes/CI chamarem a API sem o fluxo de login.

### Estado atual (verificado)
- Tunnel conectado, Access ativo (302 → login). README (Deploy): "service token
  pra bypass programático ainda pendente".
- Daemon já autentica por Bearer próprio (`ASSISTENTE_OS_DAEMON_TOKEN`) — o Access
  fica **na frente** disso.

### Status: 📄 DOC PRONTO — aguardando ação no dashboard Cloudflare (2026-08-27)

Procedimento completo em **[docs/CLOUDFLARE-ACCESS.md](CLOUDFLARE-ACCESS.md)**
(criar token, autorizar na policy, guardar em `~/.assistant-os/.env` + secrets do
GitHub, usar, rotacionar, snippet do CI). README (Deploy) aponta para lá.
**Nenhum código de daemon muda** — os headers `CF-Access-*` são consumidos na
borda da Cloudflare. Resta ação do usuário no dashboard + preencher 2 variáveis.

### Passos
- [x] Procedimento documentado (criar / autorizar / guardar / usar / rotacionar / CI).
- [ ] **Usuário**: criar o **Service Token** no Cloudflare Zero Trust (Access → Service Auth).
- [ ] Adicionar uma policy `Include: Service Token` à aplicação Access do hostname.
- [ ] Guardar `CF-Access-Client-Id` / `CF-Access-Client-Secret` em `~/.assistant-os/.env` (nunca no repo).
- [ ] Documentar em `docs/DEPLOY.md`/README: como o cliente envia os 2 headers + o `Authorization: Bearer` do daemon.
- [ ] Nota de rotação (validade do token, procedimento de troca).
- [ ] Atualizar `.github/workflows/ci.yml` se o passo de deploy/health-check bater no domínio público (usar os secrets do repo).
- [ ] Smoke: `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" -H "Authorization: Bearer …" https://assistente-os.coderstudio.club/health` → 200.

### Critérios de aceitação
- [ ] Requisição com os 3 headers → 200; sem os headers do Access → 302/403.
- [ ] Segredos só em `~/.assistant-os/.env` e nos secrets do GitHub; `git grep` limpo.
- [ ] README/README-Deploy com o procedimento e a nota de rotação.

### Esforço: **S** · Dependências: nenhuma (config externa + doc; sem código de app)

---

## E8 — Governança AI-3: gates de produção

### Objetivo
Fechar os gates de conformidade AI-3 (Padrões v4.0) ainda abertos, herdados da
spec e do ADR-AI-003.

### Estado atual (verificado)
- ADR-AI-003 aceito (revisão programada 2027-02-16); RACI com owners "pendente"
  (`docs/adr/ADR-AI-003.md:73–75`).
- Enforcement de limite existe no `chat.ts` (429 para `dailyLimit` e `maxTurns`),
  mas **sem teste dedicado** de fallback/kill-switch.
- **Não existe:** suíte cross-tenant, execution manifest por release, inventário
  de IA com classificação de risco.

### Sub-itens

#### E8.1 — Suíte de testes cross-tenant (isolamento entre souls)
- Arquivo `packages/daemon/test/cross-tenant.test.ts` (+ helper de fixtures com 2 souls).
- Cobrir: RAG da soul A nunca retorna chunk da soul B; `graph_list` isolado;
  `session_messages`/`sessions` isolados por soul (e por `client_key`, ver E2);
  `soul_context`/`buffer` não vazam caminho de outra soul; tools MCP com
  `AGENT_SOUL_ID=A` não operam sobre B; `cost_calls`/`router_history` filtrados.
- Saída: relatório de cobertura do modelo de isolamento anexado ao ADR.

#### E8.2 — Execution manifest reproduzível por release
- `packages/core/src/manifest.ts` **(novo)** — `buildExecutionManifest()` registra,
  por release/tag: versão do código (git sha), modelos por tier, hash dos system
  prompts por soul, catálogo L1/L2/L3 vigente, lista de tools + níveis, fontes de
  contexto (dirs RAG por soul), versão das migrações aplicadas.
- `GET /api/manifest` (Bearer) + `os manifest` + artefato `manifest-<sha>.json`
  publicado pelo CI.
- Determinístico: mesmo input → mesmo hash.

#### E8.3 — Testes de fallback / kill-switch
- `packages/daemon/test/kill-switch.test.ts` — `dailyLimit` atingido → 429 e
  nenhuma chamada ao provider; `maxTurns` atingido → 429; corte por budget de
  sessão; `PROMPT_INJECTION_MODO=recusar` + severidade alta → 400 e nenhuma
  execução. Asserta que o provider **não** foi chamado (spy).

#### E8.4 — Inventário de IA + classificação de risco
- `docs/AI-INVENTORY.md` — tabela: cada "sistema de IA" (chat por tier, agente
  LangGraph, extração de entidades, pipelines de reunião/e-mail, sales
  intelligence, spec-grill), com finalidade, dados de entrada, classificação de
  risco (AI-1..AI-4), guardrails efetivos, owner.
- Validar que a telemetria (`/infra/status`, `/metrics` do E6, audit trail) **não**
  emite conteúdo de contexto/PII — teste `daemon/test/telemetry-no-leak.test.ts`.
- Preencher a RACI do ADR-AI-003 (owners de negócio/risco/governança).

### Arquivos afetados
- `packages/core/src/manifest.ts` (novo), `packages/daemon/src/routes/manifest.ts` (novo), `packages/cli/src/index.ts` (comando).
- `packages/daemon/test/{cross-tenant,kill-switch,telemetry-no-leak}.test.ts` (novos).
- `docs/AI-INVENTORY.md` (novo), `docs/adr/ADR-AI-003.md` (RACI), `.github/workflows/ci.yml` (publica manifest).

### Status: ✅ CONCLUÍDO (2026-08-27) — exceto assinatura humana da RACI

- **E8.1** `daemon/test/cross-tenant.test.ts` (4 testes): RAG / grafo / sessões
  (por soul **e** por `client_key`) / custos (`cost_calls`, `getUsageSummary`) isolados.
- **E8.2** `core/manifest.ts::buildExecutionManifest` — git sha, tiers, catálogo
  L1/L2/L3 versionado, hash do system prompt por soul, dirs RAG, migrações aplicadas;
  `hash` determinístico (`generatedAt` fora). `GET /api/manifest` + `os manifest`.
- **E8.3** `daemon/test/kill-switch.test.ts` (3 testes): `dailyLimit` / `maxTurns` /
  `PROMPT_INJECTION_MODO=recusar` cortam **antes** de chamar o provider (contador `run`).
- **E8.4** `docs/AI-INVENTORY.md` (10 sistemas, risco AI-1..AI-4, guardrails).
  **Achado corrigido:** `execution_logs.verdict` carregava `snippet` (200 chars do
  doc) e vazava em `/infra/status` → `sanitizeVerdictForLog` (`core/sessions.ts`)
  corta `snippet`/`body`, mantém `ok`/`motivo`/`path`/`method`/`score`. Teste
  `daemon/test/telemetry-no-leak.test.ts`. ADR-AI-003 §8 anotado (RACI ainda
  "pendente — ação humana").

### Critérios de aceitação
- [x] Suíte cross-tenant verde (RAG, grafo, sessões, custos).
- [x] `GET /api/manifest` determinístico (teste `core/manifest.test.ts` + REST `daemon.test.ts`). *(anexar `manifest-<sha>.json` no CI = passo de workflow, não bloqueia.)*
- [x] Kill-switch: provider não é chamado quando o limite corta.
- [x] `docs/AI-INVENTORY.md` cobre os sistemas de IA com classificação (owners = ação humana).
- [x] Telemetria sem PII/contexto — `sanitizeVerdictForLog` + teste.
- [ ] **Assinatura humana** da RACI do ADR-AI-003 (owners de negócio/risco/governança).

Testes: +11 (`cross-tenant` 4, `kill-switch` 3, `manifest` 2, `telemetry-no-leak` 2) + 1 REST. Suítes: core 221, daemon 119, memory 44, tools 22, cli 2 — verdes.

### Esforço: **L** · Dependências: **E1** (feito)

---

## E9 — LGPD: fechar ADR-PRIV-001

### Objetivo
Levar o ADR-PRIV-001 (domínio de famílias, dados sensíveis de saúde) de
"Proposta" para "Aceito", fechando as pendências datadas do §7.

### Estado atual (verificado)
- `docs/adr/ADR-PRIV-001.md` — Status "Proposta (aguardando assinatura do owner de
  risco/responsável clínico)". Retenção `FAMILIAS_RETENCAO_DIAS` default 1825;
  sweep de eliminação em cascata implementado.
- Pendências §7: P1 (confirmar prazo de prontuário com o Conselho Federal de
  Psicologia); evidência de consentimento dos responsáveis capturada fora do
  banco (canal WhatsApp), requisito do onboarding; política de rotação de
  backup/dump respeitando pedido de eliminação; perfil AI-4 sem ADR próprio.

### Trabalho
- [ ] **Onboarding com evidência de consentimento** — no fluxo `POST /familias`
  (onboarding), exigir e registrar referência à evidência de consentimento
  (id da mensagem/mídia WhatsApp, timestamp, responsável). Coluna
  `consent_evidence_ref` + validação; sem ela, `status` não avança para ativo.
  Migração `0012_familias_consent`.
- [ ] **Rotação de backup vs. eliminação** — documentar e automatizar: o job de
  backup (`assistente-os-backup` no PM2) passa a registrar a data do dump; um
  procedimento (`os familias purge-backups` ou nota operacional) garante que
  dumps mais antigos que o ciclo sejam descartados após um sweep de eliminação,
  para não reter linhas eliminadas além do previsto.
- [ ] **ADR AI-4** — `docs/adr/ADR-AI-004.md` já existe; confirmar se cobre o
  perfil AI-4 do domínio de famílias ou criar/estender para formalizar
  (classificação, AIIA, RIPD/DPIA, ROPA, retention schedule).
- [ ] **P1 (prazo de prontuário)** — item organizacional: registrar owner
  (responsável clínico) e transformar em issue com prazo "antes do go-live";
  ajustar `FAMILIAS_RETENCAO_DIAS` se necessário.
- [ ] Atualizar o Status do ADR-PRIV-001 e a RACI quando assinado.

### Arquivos afetados
- `packages/core/src/familias.ts` + `migrations.ts` (`0012`).
- `packages/daemon/src/routes/familias.ts` — validação de consentimento no onboarding.
- `packages/cli/src/index.ts` — `os familias purge-backups` (ou doc).
- `docs/adr/ADR-PRIV-001.md`, `docs/adr/ADR-AI-004.md`, `docs/DEPLOY.md`.

### Status: ✅ TÉCNICO CONCLUÍDO (2026-08-27) — assinatura do ADR e itens org. seguem com os owners

- Migration `0013_familias_consent_evidence` + `ativarFamilia(pool, id, consentEvidenceRef)`
  que lança `ConsentEvidenceRequiredError` e **não** avança o status sem a referência;
  `registrarConsentimento()`. `Familia.consentEvidenceRef`.
- Rotação de backup vs. eliminação: `pruneOldBackups` já existe; **invariante documentada**
  em ADR-PRIV-001 §8 (registro eliminado sobrevive ≤ `BACKUP_RETENTION_DAYS=7` em dumps;
  procedimento de 3 passos para pedido de eliminação explícito; restauração de dump antigo
  exige re-rodar o sweep).
- ADR-PRIV-001 §8 (progresso de implementação) adicionado; P2 ✅, P3 ✅, P1/P4/P5 ⏳ (org/roadmap).
- **P5** (ADR AI-4 de famílias): ADR-AI-004 é sobre LangGraph, **não** cobre — segue pendente
  (ADR dedicado com AIIA/RIPD/ROPA); classificação AI-4 provisória registrada em `docs/AI-INVENTORY.md` #6.

### Critérios de aceitação
- [x] Onboarding sem `consent_evidence_ref` não ativa a família (teste `familias.test.ts`).
- [x] Rotação de backup vs. eliminação documentada com procedimento (ADR §8); `pruneOldBackups` existente.
- [ ] ADR AI-4 dedicado de famílias — **pendente** (ADR-AI-004 não cobre; ação org.).
- [ ] P1 (prazo CFP) — organizacional, registrado no ADR §8 com owner.
- [x] `docs/adr/ADR-PRIV-001.md` §8 com progresso; riscos §5/§6 endereçados no texto.

Testes: `familias.test.ts` +1. Suítes: core 222, daemon 119 — verdes.

### Esforço: **M** · Dependências: nenhuma técnica (parte é organizacional/assinatura)

---

## E10 — RAG: estágio de reranking

### Objetivo
Adicionar um passo de reordenação após a busca híbrida, para subir a precisão do
top-K sem depender só do score vetorial/lexical.

### Estado atual (verificado)
- Busca híbrida 70/30 (semântica + literal) com scores no audit trail
  (`orchestrator/router.ts` modo `pro`; debug `method`/`score` por fonte no
  `chat.ts`). **Nenhum** rerank (grep `rerank` vazio).

### Arquivos afetados
- `packages/memory/src/rerank.ts` **(novo)** — `rerank(query, candidates, opts)`.
- `packages/memory/src/context.ts` / `retrieveContext` — chamar o rerank entre "buscar" e "montar contexto".
- `packages/core/src/config.ts` — flags `RAG_RERANK` (`off`|`llm`|`cross-encoder`), `RAG_RERANK_TOPN`.
- `packages/daemon/src/routes/chat.ts` — expor `method: "reranked"` + score no debug do audit trail.

### Design
- Recuperar top-N amplo (ex.: 20) da busca híbrida → rerank → top-K (ex.: 5) para o prompt.
- **Modo `cross-encoder`** (recomendado, local, sem custo): modelo cross-encoder
  via `@xenova/transformers` (mesma stack do STT/embeddings fallback), ex.
  `Xenova/ms-marco-MiniLM-L-6-v2`. Score par (query, chunk).
- **Modo `llm`**: prompt binário/escala ao Ollama ("este trecho ajuda a responder
  X? 0–3") — mais lento em CPU; útil quando o cross-encoder não estiver disponível.
- **`off`** (default até validar): comportamento atual, custo zero.
- Auto-skip com log se o modelo não carregar (mesmo padrão dos testes que
  dependem de Ollama/Xenova).

### Contratos
```ts
export interface RerankOpts { mode: "off" | "llm" | "cross-encoder"; topN: number; topK: number; }
export async function rerank(query: string, candidates: RagChunk[], opts: RerankOpts): Promise<RagChunk[]>; // re-scored + reordenado + cortado em topK
```

### Status: ✅ CONCLUÍDO (2026-08-27)

`memory/rerank.ts` — `rerank(query, candidates, cfg, scoreFn?)` + `rerankConfig()`
(env `RAG_RERANK` = `off`|`llm`|`cross-encoder`, `RAG_RERANK_TOPN` default 20,
`RAG_RERANK_TOPK`). `retrieveContext` busca top-N amplo e reordena antes de cortar
no `limit` quando o modo ≠ `off`; com `off` (default) `fetchN == limit` (no-op).
Cross-encoder via `@xenova/transformers` (`Xenova/ms-marco-MiniLM-L-6-v2`), lazy +
cacheado; falha de modelo → `crossEncoderFailed` + log + fallback para ordem por
score. `llm` pontua 0–3 via Ollama por trecho; timeout/erro → `-1` (não pontuado,
mantém ordem original). Chave de cache RAG inclui o modo.

### Critérios de aceitação
- [x] `cross-encoder` (scorer injetado no teste): a isca lexical sai do top-K (teste `rerank.test.ts`).
- [x] `RAG_RERANK=off`: `fetchN == limit`, ordena só por score — idêntico ao atual (suítes memory/daemon verdes).
- [x] Modelo ausente → auto-skip + log, não quebra (fallback `byOriginal`).
- [x] Scorer que devolve `-1` preserva a ordem por score original.
- [x] `method: "reranked"` no audit trail — **feito (2026-08-27)**: `RagChunk` ganhou `reranked?: boolean` (setado em `retrieveContext` quando `RAG_RERANK != off`); o bloco "RAG: retrieval debug" do `chat.ts` grava `method: "reranked"` para essas fontes, com `baseMethod` preservando `semantic`/`literal`. Teste em `rag-faithfulness.test.ts`.

Testes: `memory/test/rerank.test.ts` (4). Suítes: memory 48, daemon 119 — verdes.

### Plano de teste
- Unit `memory/test/rerank.test.ts` — fixtures com isca; `off` == baseline; scorer não-pontuado. ✅
- Fidelidade RAG (juiz LLM opcional) — comparar grounding com/sem rerank.

### Esforço: **M** · Dependências: nenhuma (E4 dá cache para amortizar o custo do rerank em repetições)

---

## Convenções

- **Migrações**: string embutida em `packages/core/src/migrations.ts`, id sequencial
  `00NN_nome`, idempotente (`IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`).
- **Tools novas**: entram negadas por Zero Trust; só ficam visíveis se em
  `DEFAULT_ALLOWED_TOOLS` (leitura) ou no `agent.permissions.tools` da soul; nível
  L1/L2/L3 declarado em `policy.ts`.
- **Segredos**: só em `~/.assistant-os/.env` / secrets do GitHub; nunca no repo.
- **Testes**: `npm run build` antes; `node --test` por workspace; conexões (Redis,
  pool) fechadas no `after()`.
- Ao concluir um epic, atualizar a seção **Status/Pendências** do [README](../README.md).
