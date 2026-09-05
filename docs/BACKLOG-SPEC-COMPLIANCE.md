# Backlog — Conformidade com a Spec do Engenheiro Sênior

Backlog **gerenciável** derivado do `system_prompt` (Build Mode / Spec-Driven).
Cada `hard_rule`, `golden_rule` e passo do `execution_protocol` vira um item
rastreável, com estado **verificado no código** em 2026-08-31.

Escopo: só governança/spec. Backlog de features fica em [`ROADMAP.md`](ROADMAP.md).

---

## Como gerenciar

- **ID**: `SPEC-<seção><n>` — estável, use em branch/commit/PR (`git commit -m "SPEC-HR2: ..."`).
- **Status**: `TODO` → `DOING` → `REVIEW` (PR aberto) → `DONE` · ou `BLOCKED`.
- **Fonte de verdade do status**: a coluna Status do board abaixo. Atualize no mesmo PR que fecha o item.
- **DoD (Golden Rule 4)**: item só vai a `DONE` com `npm run build` limpo, `npm test` 100%, e — quando o item toca execução de agente — auditoria do Guardian ≥ 95.
- **Cadência de revisão**: varrer `BLOCKED` + `REVIEW` a cada início de sessão de Build Mode.
- **Prioridade**: `P0` = viola isolamento/segurança agora · `P1` = gap de governança auditável · `P2` = higiene/processo.

---

## Board

| ID | Item | Regra | Prio | Esforço | Status | Depende |
|---|---|---|---|---|---|---|
| SPEC-HR1 | Degradação suave DB/LLM → Markdown, sem travar o daemon | HR1 LOCAL_FIRST | P1 | M | Fatia 1+2 ✅ (chat, decisões, lições, agenda-tool) / REST+job de agenda e RAG ingest TODO | — |
| SPEC-HR2 | `purgeCredentials(taskId)` em `finally` de toda execução | HR2 CREDENTIAL_ISOLATION | P0 | M | TODO | — |
| SPEC-HR3 | Todo handler MCP: `authorizeTool` + evento em `audit-trail.ts` | HR3 IDENTITY_SCOPED_TOOLS | P1 | M | TODO | — |
| SPEC-HR4 | `maxIterations`/`LANGGRAPH_MAX_ITERATIONS=5` como hard-stop no runner | HR4 RECURSION_GUARD | P1 | S | TODO | — |
| SPEC-HR5 | Reconciliar dependências com a allowlist STDLIB_FIRST | HR5 STDLIB_FIRST | P2 | S–M | TODO | — |
| SPEC-HR6 | Hub WS: broadcast sem isolamento por conta vaza `chat.step`/`graph.step` entre clientes | (achado fora do system_prompt — ver nota) | P0 | M | TODO | — |
| SPEC-GR1 | 4º loop: 3 reincidências → Regra de Ouro → aprovação 6 dígitos → `SOUL.md` + `.opencode/rules/golden-rules.md` | GR1 AUTOAPRENDIZADO | P1 | M | TODO | — |
| SPEC-GR2 | Rodapé `usage_metadata` em toda `sessoes/YYYY-MM-DD.md` | GR2 TELEMETRIA | P1 | M | TODO | E1 (done) |
| SPEC-GR3 | Browser harness: árvore de acessibilidade + CDP sandbox antes de pixel | GR3 BROWSER SEMÂNTICO | P2 | S | TODO | — |
| SPEC-GR4 | Gate de merge: `build` + `test` + supervisor ≥ 95 no CI | GR4 DISCRIMINATOR | P1 | M | TODO | — |
| SPEC-EP1 | Planejamento prévio em `<thinking>` no template de PR/contribuição | EP1 PLANEJAMENTO | P2 | S | TODO | — |
| SPEC-EP2 | Proibir `any` (lint `error`) + auditoria de cobertura Zod nos limites | EP2 TIPAGEM ESTRITA | P1 | M | Frente 1 ✅ / Frente 2 TODO | — |
| SPEC-EP3 | Script único de DoD (`npm run dod`) rodado antes de encerrar turno | EP3 VERIFICAÇÃO | P2 | S | TODO | SPEC-GR4 |
| SPEC-FO1 | Codificar FinOps guardrail (output conciso/zero-preâmbulo/formatos) no template de SOUL | FO GUARDRAIL | P2 | S | TODO | — |

---

## Itens

### SPEC-HR1 — Degradação suave para Markdown
**Objetivo**: falha de Postgres/pgvector/SQLite ou timeout de LLM nunca trava o daemon; persiste em `~/.assistant-os/souls/<soulId>/*.md` e reindexa depois.
**Estado atual (verificado 2026-09-05, Fatia 2)**: mapeamento completo das escritas feito.
- ✅ `POST /chat` — Fatia 1 (2026-09-04): `isDbHealthy`+`handleChatDegraded`, 200+Markdown em vez de 500.
- ✅ **`soul_decidir`/`soul_licao`/`soul_record_lesson`/`soul_get_lessons` já eram 100% resilientes antes de qualquer mudança** — puramente arquivo/JSONL (`decisoes/*.md`, `licoes.md`, `governance/incidents.jsonl`), zero `pool.query` no caminho de execução. Não precisaram de código novo, só deixaram de estar erroneamente listadas como "sem fallback".
- ✅ `agenda_add`/`agenda_list` (tool MCP) — Fatia 2 (2026-09-05): `isDbHealthy` antes da query, mensagem clara em vez da exceção crua do driver `pg`. **Não é fallback de dados** (não há Markdown equivalente pra agenda) — é falha rápida e legível.
- ⚠️ **Ainda sem tratamento**: `packages/daemon/src/routes/agenda.ts` (rota REST) e `processDueAgenda` (job de despacho em loop, `server.ts`) — mesma exposição da tool MCP, não cobertos nesta fatia.
- ⚠️ **RAG ingest (`memory_index`/`indexDirectory`) é categoricamente diferente**: seu propósito é popular o Postgres/pgvector a partir do Markdown já existente — não existe "fallback markdown" conceitual (a fonte já está em disco, falta é o destino). Hoje vaza a exceção crua do `pg` sem tratamento; candidato a "falhar rápido com mensagem clara", não a um fallback de dados.
**Gap**: rota REST + job de despacho de agenda, e mensagem clara em RAG ingest.
**Aceitação**:
- Teste de integração com Postgres derrubado: `POST /souls/:id/chat` responde 200 e grava Markdown; `os status` mostra "degraded". ✅
- Tool `agenda_add`/`agenda_list` com Postgres derrubado: erro claro, não exceção crua do driver. ✅
- Timeout de LLM no executor → resposta de fallback + lição registrada, sem exceção não tratada.
- `docs/` documenta a matriz "componente → fallback" (esta seção agora é essa matriz).
**Arquivos**: `packages/daemon/src/routes/chat/postChat.ts`, `packages/tools/src/misc/index.ts`, `packages/core/src/souls.ts`, `alma.ts`, `packages/daemon/src/pipelines/*`.

### SPEC-HR2 — Purga de credenciais em `finally`  ·  P0
**Objetivo**: `TempVault` (RAM) é o único lar de segredos efêmeros; `purgeCredentials(taskId)` roda em `finally` de todo bloco de execução (sucesso ou erro). Zero gravação em disco/log/Markdown.
**Estado atual (verificado)**: `packages/core/src/security/temp-vault.ts` tem o singleton, `purgeCredentials()` e `purgeAll()`. **`grep` não encontra nenhum `finally` chamando purge** fora do próprio módulo. Memory M4: "temp-vault nunca faz purge".
**Gap**: nenhum call-site de execução (chat, LangGraph runner, opencode runner, pipelines, tools MCP que recebem token) chama `purgeCredentials` no encerramento.
**Aceitação**:
- Todo executor que aceita credencial embrulha o corpo em `try { … } finally { purgeCredentials(taskId); }`.
- Teste: após execução com erro forçado, `TempVault` não tem entradas para o `taskId`.
- Lint/grep de CI falha se um novo `set`/`store` no TempVault não tiver `purge` correspondente no mesmo arquivo.
- Varredura confirmada: nenhum segredo em `execution_logs`, `sessoes/*.md`, `licoes.md`, `pino`.
**Arquivos**: `packages/core/src/security/temp-vault.ts`, `packages/daemon/src/routes/chat.ts`, `langgraph-runner.ts`, `runner.ts`, `packages/tools/src/index.ts`, `packages/daemon/src/pipelines/*`.
**Relacionado**: ROADMAP M4 (LGPD).

### SPEC-HR3 — Tools MCP com autorização + trilha de auditoria
**Objetivo**: toda ferramenta em `packages/tools/src/index.ts` valida `authorizeTool(soulId, toolName)` e emite evento em `audit-trail.ts` sob ISO/IEC 42001.
**Estado atual (verificado)**: `authorizeTool(configHome, soulId, toolName)` existe e é chamado em ~40 handlers. `packages/core/src/governance/audit-trail.ts` existe com testes. `MCP_ZERO_TRUST` (default off) é defesa adicional.
**Gap**: (1) confirmar que **todo** handler chama `authorizeTool` — não há teste que quebre ao adicionar tool sem o gate; (2) a emissão para `audit-trail.ts` não está amarrada a cada tool — hoje depende de `guardian_audit_execution`/`execution_spans`.
**Aceitação**:
- Teste de meta-cobertura: itera o registro de tools e falha se algum handler não passar por `authorizeTool` + `recordAuditEvent`.
- Cada invocação de tool grava `{ ts, soulId, toolName, decision, risk, argsHash }` na trilha.
- `os audit` (ou equivalente) lista os eventos por soul/período.
**Arquivos**: `packages/tools/src/index.ts`, `packages/core/src/governance/audit-trail.ts`.

### SPEC-HR4 — Recursion guard = 5, hard-stop
**Objetivo**: `LANGGRAPH_MAX_ITERATIONS = 5` (ou `guardrails.maxIterations`) encerra a cadeia — não só conta.
**Estado atual (verificado)**: default `maxIterations: 5` em `packages/core/src/types/agent.ts:92`; `aiia.test.ts` asserta 5; `langgraph-runner.ts` **expõe `iterationCount` mas não há `recursionLimit` nem corte explícito**.
**Gap**: passar `maxIterations` como `recursionLimit` do grafo LangGraph e/ou `break` quando `iterationCount >= max`, com lição registrada ao estourar.
**Aceitação**:
- Grafo com tool que sempre pede outra tool para em ≤ 5 iterações com resultado parcial + `GraphRecursionError` tratado.
- Teste unitário do runner cobre o corte.
- Valor vem de `guardrails.maxIterations` (env override), default 5.
**Arquivos**: `packages/daemon/src/langgraph-runner.ts`, `langgraph-tools.ts`, `packages/core/src/types/agent.ts`.

### SPEC-HR5 — STDLIB_FIRST: reconciliar dependências
**Objetivo**: deps restritas a `node:*`, `playwright-core`, `@langchain/*`, `pg`, `zod`.
**Estado atual (verificado 2026-09-05)**: `package.json` raiz também traz `@xenova/transformers`, `pino`, `pino-pretty`, `say`, `telegraf` (e mais ~15 deps de backend, todas já "grandfathered" em `.github/scripts/deps-zones.mjs` desde o ADR-UI-001, 2026-09-01). A zona frontend (`packages/ui`) **já estava fechada pelo ADR-UI-001** — só não tinha sido riscada aqui (pendência que o próprio ADR já apontava). `zod` está na allowlist original mas nenhum pacote do monorepo o usa hoje.
**Gap fechado 2026-09-05**: o 3º critério de aceitação ("Check de CI falha em dep nova fora da lista aprovada") **não estava cumprido de fato** — `deps-zones.mjs` tinha testes unitários cobrindo suas funções, mas o `main()` (que varre os `package.json` reais) nunca rodava em CI; uma dependência nova fora da allowlist não era barrada por nada. Corrigido: novo step "Dependency zones gate" no job `compliance` do CI, rodando `node .github/scripts/deps-zones.mjs` de verdade — mesmo padrão já usado para `compliance-gate.mjs` no mesmo job. No caminho, `packages/web` (que não existia quando o guard foi escrito, comentário dizia "landing later") foi atribuído à zona frontend, e `FRONTEND_ALLOW`/`BACKEND_ALLOW` ganharam as entradas que faltavam pra passar contra o estado real (`@assistente-os/*` em frontend, `vite`/`@vitejs/plugin-react`/`undici`, e `eslint`/`typescript-eslint` no backend — estes dois adicionados pelo próprio SPEC-EP2 Frente 1 na mesma sessão).
**Gap ainda aberto** (maior, não fechado nesta rodada): divergência entre a allowlist "grandfathered" (ampla, bate com a realidade) e a allowlist original de 5 itens do `system_prompt` (`hard_rules`) — decidir por item: manter (e atualizar a allowlist da spec com justificativa) ou remover/substituir por stdlib. Isso exige um ADR formal com veredito por dependência (~15 na zona backend), fora do escopo desta fatia.
**Aceitação**:
- ADR curto listando cada dep fora da allowlist original + veredito (keep/replace) + razão. **Não feito.**
- `hard_rules` da spec atualizada para refletir a allowlist real. **Não feito.**
- Check de CI (`depcheck`/allowlist) falha em dep nova fora da lista aprovada. ✅ **Feito 2026-09-05.**
**Arquivos**: `package.json` (workspaces), `docs/adr/`, `system_prompt`, `.github/scripts/deps-zones.mjs`, `.github/workflows/ci.yml`.
**Relacionado**: ROADMAP Onda 3d (centralizar config); ADR-UI-001 (zona frontend, já fechada).

### SPEC-HR6 — Hub WS sem isolamento por conta  ·  P0
**Nota de origem**: diferente dos demais itens deste backlog, não vem de uma regra nomeada do `system_prompt` — foi achado lendo o código durante o brainstorm do sub-projeto B (redesign do app). Mantido no mesmo ID scheme por ser da mesma natureza (violação de isolamento) e pra ficar rastreável junto dos outros.
**Objetivo**: eventos do hub WS (`chat.step`, `graph.step`, `chat.done`, e os demais broadcasts de `voice.ts`/`agenda.ts`/`monitors.ts`/`events.ts`) só chegam a clientes autorizados a ver aquela soul/conta — não a todo cliente conectado.
**Estado atual (verificado)**: `packages/daemon/src/server.ts` — `WsHub.broadcast()` escreve o frame pra **todo** socket em `this.clients`, sem filtro. O próprio código documenta a lacuna: comentário no construtor diz que sem o `token` de conexão *"qualquer cliente que alcançasse a porta recebia todos os broadcasts (chat, custos, passos do grafo)"* — e mesmo com `token` configurado, é um token único pro daemon inteiro, não por conta/soul. `packages/daemon/src/routes/chat.ts:527` confirma que `graph.step` inclui `lastContent` — **texto parcial da resposta do LLM** — no payload.
**Gap**: qualquer cliente WS conectado (de qualquer conta, no modo amigável) recebe o progresso e trechos de resposta de chats de **todas as outras contas**, não só o dela. É um vazamento de conteúdo entre contas, não só de metadado.
**Aceitação**:
- `WsHub` ganha conceito de "sala"/escopo — cliente se identifica na conexão (via `?token=` de conta, não só o token global do daemon) e só recebe broadcasts da(s) soul(s)/conta que ele tem acesso.
- Teste: dois clientes WS autenticados como contas diferentes; broadcast de um chat da conta A não chega no socket da conta B.
- Auditoria dos demais `hub.broadcast(...)` (`voice.ts`, `agenda.ts`, `monitors.ts`, `events.ts`, `missions.ts`) — decidir caso a caso se cada um precisa do mesmo escopo ou é legitimamente global (ex.: `monitor.added` pode ser info do operador, sem PII de conta).
**Arquivos**: `packages/daemon/src/server.ts` (`WsHub`), `packages/daemon/src/routes/chat.ts`.
**Relacionado**: sub-projeto B (`docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md`) decidiu não rotear o novo endpoint de streaming por este hub exatamente por causa deste gap. `MCP_ZERO_TRUST` resolve autorização de *tools*, não de *broadcasts* — este item é ortogonal ao SPEC-HR3.

### SPEC-GR1 — 4º loop de autoaprendizado ponta a ponta
**Objetivo**: erro/exceção/correção → `~/.assistant-os/souls/<soulId>/licoes.md`; 3 reincidências no mesmo tópico → sintetiza Regra de Ouro → aprovação humana (código 6 dígitos no Telegram) → promove para `SOUL.md` e `.opencode/rules/golden-rules.md`.
**Estado atual (verificado)**: `packages/core/src/governance/golden-rules.ts` implementa registro de lição, contagem de reincidência, síntese e aprovação; MCP `guardian_*` (pending/approve/reject/promote/resend_code) expostos.
**Gap**: validar o fluxo completo com o Telegram real e confirmar a **escrita nos dois destinos** (`SOUL.md` + `.opencode/rules/golden-rules.md`) após aprovação.
**Aceitação**:
- E2E: 3 lições do mesmo tópico → regra pendente → `guardian_approve_rule` com código → diff em `SOUL.md` e `.opencode/rules/golden-rules.md`.
- Código de 6 dígitos expira e `resend` gera novo.
- Rejeição não promove e registra o motivo.
**Arquivos**: `packages/core/src/governance/golden-rules.ts`, `packages/core/src/alma.ts`, `packages/tools/src/index.ts`.

### SPEC-GR2 — Rodapé `usage_metadata` nas sessões
**Objetivo**: toda sessão concluída anexa `usage_metadata` (`prompt_tokens`, `completion_tokens`, `latency_ms`) no rodapé de `sessoes/YYYY-MM-DD.md`.
**Estado atual (verificado)**: captura de tokens no chat concluída (ROADMAP E1); `packages/core/src/tokens.ts` normaliza uso. `aiia.ts:44` observa que a contagem é "regex sobre `sessoes/*.md`, não fonte auditável" — sinal de que o rodapé não é escrito de forma consistente.
**Gap**: hook de fim de sessão que serializa o bloco e faz append idempotente no md do dia.
**Aceitação**:
- Após `POST /souls/:id/chat`, o md do dia termina com bloco ` ```yaml usage_metadata ` contendo os 3 campos + `model_used` + `execution_mode`.
- Append é idempotente por `sessionId` (não duplica ao rotacionar).
- Teste lê o md e valida o bloco.
**Arquivos**: `packages/daemon/src/routes/chat.ts`, `packages/core/src/souls.ts`, `tokens.ts`.

### SPEC-GR3 — Browser harness semântico
**Objetivo**: automação web prioriza `getAccessibilityTree` + CDP com sandbox para injeções dinâmicas; pixel/coordenada é último recurso.
**Estado atual (verificado)**: tools `browser_get_accessibility_tree`, `browser_navigate`, `browser_execute_fix`, `browser_audited_screenshot` existem.
**Gap**: garantir a **ordem de preferência** no código (a11y tree → seletor → screenshot) e que `browser_execute_fix` roda em sandbox CDP.
**Aceitação**:
- `packages/daemon/src/tools/browser.ts` resolve alvo pela árvore de acessibilidade antes de qualquer clique por coordenada; doc registra a hierarquia.
- Injeção de fix roda isolada (sem acesso ao contexto principal) e é auditada.
**Arquivos**: `packages/daemon/src/tools/browser.ts`.

### SPEC-GR4 — Gate Discriminator no CI  ·  bloqueia merge
**Objetivo**: entrega só fecha com `npm run build` limpo, `npm test` 100% e nota do supervisor ≥ 95/100.
**Estado atual (verificado)**: `.github/workflows/ci.yml` roda `npm run build` + `npm test` + anexa `manifest-<sha>.json`. **Não há passo do supervisor (≥ 95)** nem branch protection documentada exigindo o job.
**Gap**: adicionar job que roda `guardian_audit_execution` sobre o diff/execução da branch e falha < 95; exigir os jobs como required checks.
**Aceitação**:
- CI tem step `Discriminator` que sai != 0 se score < 95, com o JSON do parecer no log/artefato.
- `main` protegida: `build-and-test` + `Discriminator` são required.
- `docs/` descreve como rodar o gate localmente.
**Arquivos**: `.github/workflows/ci.yml`, `packages/cli/src/*` (subcomando `os discriminator`/`manifest`), `packages/core/src/governance/golden-rules.ts`.

### SPEC-EP1 — Planejamento prévio em `<thinking>`
**Objetivo**: todo trabalho começa detalhando raciocínio arquitetural, arquivos impactados e ordem de modificação.
**Gap**: não há artefato que force isso.
**Aceitação**: template de PR (`.github/pull_request_template.md`) com seção obrigatória "Plano (arquivos + ordem)"; `AGENTS.md` referencia a regra.
**Arquivos**: `.github/pull_request_template.md`, `AGENTS.md`.

### SPEC-EP2 — Tipagem estrita + Zod nos limites
**Objetivo**: zero `any`; schemas Zod validando toda entrada externa (HTTP, tools, env, arquivos de alma).
**Estado atual (verificado 2026-09-05 — corrige alegação anterior de "zod já em uso amplo", que estava ERRADA)**: `zod` está instalado e usado em **exatamente 1 arquivo** do monorepo inteiro (`packages/daemon/src/langgraph-tools.ts`, ~7 schemas de tool-calling do LangChain). Zero cobertura Zod nas 29 rotas HTTP do daemon, nas ~13 famílias de tools MCP (`packages/tools/src/*/index.ts`), ou no parsing de args da CLI. Cerca de 43-44 ocorrências de `any` no código-fonte, concentradas em `packages/daemon` (~65%) — majoritariamente padrões legítimos (`catch (err: any)`, resposta JSON de API externa não tipada, contorno de libs de terceiros sem `.d.ts`, manipulação de DOM via CDP em `browser.ts`), não preguiça generalizada. Não existe nenhuma configuração de ESLint no repo hoje (zero infraestrutura de lint).
**Gap**: `any` não é erro de lint (nem existe lint); cobertura Zod nos limites não é auditada nem existe na prática.
**Aceitação**:
- `@typescript-eslint/no-explicit-any: error` (+ `no-unsafe-*`), CI verde após correções.
- Inventário: cada rota/tool/parser de env tem schema Zod; lacunas viram sub-tarefas.
**Arquivos**: `eslint.config.*`, rotas do daemon, `packages/tools/src/index.ts`, loader de config.
**Relacionado**: ROADMAP Onda 3d.
**Divisão em 2 frentes independentes** (2026-09-05): Frente 1 = política de lint (`no-explicit-any` como erro, CI, `any`s existentes justificados com `eslint-disable-next-line` pontual); Frente 2 = validação Zod real numa fronteira por vez (rotas do daemon, tools MCP, CLI — não simultâneo).
**Frente 1: ✅ concluída 2026-09-05.** `eslint.config.js` novo na raiz (ESLint 9 flat config, `typescript-eslint`), regra restrita só a `no-explicit-any` (sem puxar o ruleset "recommended" inteiro — fora de escopo). Testes (`**/test/**`, `*.test.ts`) excluídos da regra. Step `Lint` novo no job `build-and-test` do CI. Dos 36 `any` de produção encontrados: 8 corrigidos com tipo real (`catch (err)` como `unknown` com `instanceof Error` — `packages/cli/src/backup.ts`/`index.ts`; `pool.query<{...}>` tipada em `packages/memory/src/rag-chain.ts`; tipo `Build` real do SDK ADO em `packages/tools/src/ado/index.ts`; shape real de `toolCalls` em `packages/daemon/src/routes/chat/postChat.ts`), 28 documentados com `eslint-disable-next-line @typescript-eslint/no-explicit-any -- <motivo>` pontual (payload de API externa não tipada — WhatsApp/Telegram/Ollama; libs de terceiros sem `.d.ts` — `@xenova/transformers`, `say`; DOM/CDP em `browser.ts`; 1 cast (`status as any` em `ado/index.ts`) mantido por incerteza de comportamento sem teste/conexão real com ADO pra validar uma mudança de tipo). **Frente 2 segue aberta.**

### SPEC-EP3 — Script único de DoD
**Objetivo**: um comando roda a suíte de verificação antes de encerrar o turno e reporta diffs + logs.
**Aceitação**: `npm run dod` encadeia `build` → `typecheck` → `test` → `manifest` → `discriminator` e imprime resumo; documentado em `AGENTS.md`.
**Arquivos**: `package.json` (raiz), `AGENTS.md`.
**Depende**: SPEC-GR4.

### SPEC-FO1 — FinOps guardrail no template de SOUL
**Objetivo**: `OUTPUT_CONCISO`, `ZERO_PREAMBULO`, `FORMATOS_PREFERENCIAIS`, `CACHE_OPTIMIZATION` viram parte estável do prompt das souls de engenharia.
**Aceitação**: bloco imutável no topo do template de `SOUL.md` (via `PLANO-CRIACAO-SOULS`/`PROMPT-GARDEN`); prefixo estável para prompt caching; teste de geração de soul cobre a presença do bloco.
**Arquivos**: `packages/core/src/prompts/garden/*`, `docs/PLANO-CRIACAO-SOULS.md`.

---

## Rastreio de mudança

| Data | Item | Evento |
|---|---|---|
| 2026-08-31 | — | Backlog criado a partir do `system_prompt`. |
| 2026-09-01 | SPEC-HR6 | Achado durante o brainstorm do sub-projeto B: hub WS vaza `chat.step`/`graph.step` (incl. texto parcial) entre contas, sem isolamento. |
