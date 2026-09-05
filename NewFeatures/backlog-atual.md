# Backlog Atual — Assistente OS

**Data:** 2026-09-04 (reorganizado após revisão crítica externa — ver nota abaixo)
**Natureza:** snapshot consolidado do trabalho em aberto no projeto. Fontes: `docs/ROADMAP.md` (tabela "Aberto"), `docs/BACKLOG-DESIGN-SYSTEM.md`, `docs/BACKLOG-FRIENDLY-MODE.md`, `docs/BACKLOG-SPEC-COMPLIANCE.md`, achados da sessão de hoje, e `revisao-critica-backlog.md` ("Manus AI"). O detalhe técnico de cada item continua nos docs de origem — isto é um índice de navegação e priorização, não a especificação completa.

**Sobre a revisão crítica aplicada:** a revisão trouxe uma reorganização por *tipo de trabalho* (em vez de só P0–P3) e pediu para auditar itens de `BACKLOG-SPEC-COMPLIANCE.md` que pareciam contradizer o que outros docs (README/inventário) afirmam já estar pronto. Ela mesma reconheceu não ter acesso aos docs-fonte reais. Verifiquei 4 desses itens direto no código (grep + leitura) antes de aceitar qualquer correção — resultado abaixo, seção 1.

---

## 0. Auditoria de estado — itens verificados em código (2026-09-04)

| Item | Alegação do backlog | Estado real (verificado) | Ação |
|---|---|---|---|
| **SPEC-HR4** | "hard-stop de 5 iterações" ainda TODO | **Já implementado.** `packages/core/src/graph/state-checkpoint.ts:32-116` — `LANGGRAPH_MAX_ITERATIONS` com `clampMaxPermissive`, guardrail real, não só config. | Remover do backlog como TODO. |
| **SPEC-FO1** | "codificar diretriz FinOps" ainda TODO | **Já implementado**, incondicional, em todo prompt de toda soul. `packages/core/src/prompts/garden/concise-output.ts` — `conciseOutput`/`CONCISE_OUTPUT_DIRECTIVE`, montado por `buildPrompt()`. | Remover do backlog como TODO. |
| **SPEC-GR1** | "gatilho de 3 reincidências" ainda TODO | **Já implementado.** `packages/core/src/governance/golden-rules.ts:151` — `proposeRule` disparado por `incidents.length` (3+). | Remover do backlog como TODO — falta só confirmar a escrita coordenada final em `SOUL.md`+`golden-rules.md` via aprovação Guardian (não verificado em detalhe). |
| **SPEC-HR3** | "todo handler MCP precisa de `authorizeTool` + evento em `audit-trail.ts`" | ✅ **Corrigido 2026-09-05.** `authorizeTool` já era blanket check; `logIntention` (audit-trail.ts) agora roda no `finally` de `handleToolCall` — toda chamada de tool registra intenção, sucesso ou falha. No caminho, achado e corrigido bug pré-existente: `logIntention`/`logTelemetry`/`logFullAuditEntry` resolviam `home` via `resolveHome()` global em vez do `home` configurado do chamador — corrigido nas 3 funções + 7 call sites de produção. | Fechado. |

Conclusão da auditoria: 3 dos 4 itens verificados já estavam feitos e só não tinham sido riscados do backlog. Isso não valida automaticamente os itens *não* verificados (HR1, HR2, HR5, HR6, GR2-4, EP1-3) — tratar como abertos até confirmar o contrário.

---

## 1. Fila de contenção — incidente / controle de perda (P0, tratar primeiro)

Itens com risco de vazamento de dado, retenção indevida de segredo, ou indisponibilidade autoinfligida. Correção + teste de regressão antes de qualquer outra coisa.

| ID | Item | Onde | Status |
|---|---|---|---|
| **SPEC-HR6** | ✅ **Corrigido 2026-09-04.** `WsHub` agora escopa cada cliente por `accountId` (admin=`null` vê tudo; sessão de conta só recebe eventos com `scope.accountId` igual ao seu). `chat.step`/`graph.step`/`chat.done`/`upload.done`/`index.done` passam a escopar por `soul.config.ownerAccountId`. Eventos sem escopo (voice/monitor/agenda/whatsapp/telegram/mission) agora vão só pra admin — antes iam pra todo mundo. 4 testes novos em `packages/daemon/src/test/ws-hub-isolation.test.ts` (pass). **2 bugs adjacentes achados e corrigidos no caminho**: (a) `daemon.close()` travava pra sempre com WS aberto (`server.close()` do Node espera sockets fecharem, e o hub nunca destruía os seus — `WsHub.closeAll()` novo, chamado no shutdown); (b) o servidor nunca lia dados do cliente, então um close-frame do cliente nunca era notado e o socket ficava pendurado (`socket.once("data", () => socket.destroy())` novo). |
| **SPEC-HR2** | ✅ **Corrigido 2026-09-04.** `purgeCredentials` tinha ZERO chamadores em produção (só o safety-net de `process.exit`, que só dispara no shutdown do daemon inteiro — dias de uptime). Todo segredo detectado em qualquer prompt/resposta de chat (`taskId=session.id`) ficava em memória até o processo reiniciar. Corrigido em 3 pontos: `chat.ts` (`finally` ao fim do handler de `POST /chat`), `stream.ts` (dentro do `finally` já existente do watchdog), `sentry.ts` (`finally` no `beforeSend`, taskId fixo `"sentry"`). 2 testes de integração novos em `packages/daemon/src/test/spec-hr2-purge-credentials.test.ts` (pass) — provam com uma requisição HTTP real que o segredo é detectado E purgado. **Gap residual conhecido e aceito**: se `PROMPT_INJECTION_MODO=recusar` (não é o default) e a recusa acontece, um segredo do prompt pode ficar retido até o próximo turno da mesma sessão purgar — não corrigido por ser um refactor maior de `preparePromptContext` (260 linhas, já sinalizada pra Onda 3e); registrar como item pequeno separado se `recusar` for ativado em produção. |
| **BUG-01** | ✅ **Corrigido 2026-09-04.** Causa exata: `ollamaChatStream` já tinha timeout interno (idle, 300s) que funciona bem, mas o watchdog EXTERNO do `/stream` (310s, absoluto — não só idle) corria em `Promise.race` contra ela sem nenhum jeito de cancelar; se o watchdog vencesse (ex.: Ollama emitindo bytes esparsos o bastante pra nunca disparar o idle-timeout, mas devagar demais pra terminar em 310s), a chamada ao Ollama ficava órfã, presa no único slot (`-np 1`) até se resolver sozinha — minutos depois, bloqueando qualquer request nova nesse meio tempo. Corrigido com um `AbortSignal` real: `ollamaChatStream()` ganhou um 5º parâmetro opcional `signal`, e `stream.ts` cria um `AbortController` e chama `.abort()` incondicionalmente assim que o `Promise.race` resolve (no-op se já tinha terminado sozinha). 3 testes novos em `ollama-chat-stream.test.ts`, um deles prova que o **servidor** vê a conexão fechar (não só que a promise resolve client-side). **Escopo desta correção**: só o tier Ollama (era o caso reproduzido ao vivo). Os outros dois branches do mesmo `Promise.race` em `stream.ts` (LangGraph via `runLangGraphAgentStream`, e opencode via `run!`) têm o MESMO risco estrutural (nenhum dos dois recebe sinal de cancelamento do watchdog) mas não foram auditados/corrigidos agora — registrar como follow-up se algum desses tiers apresentar o mesmo sintoma. |

## 2. Gate de release — bloqueia colocar algo em produção

| ID | Item | Prioridade | Depende de |
|---|---|---|---|
| **SPEC-HR1** | ✅ **Concluído 2026-09-05 (Fatia 3, fecha o item).** Fatia 1: `POST /chat` degrada pra 200+Markdown via `isDbHealthy`+`handleChatDegraded` (ver detalhe histórico abaixo). Fatia 2: `agenda_add`/`agenda_list` (tool MCP) sondam `isDbHealthy`; confirmado que `soul_decidir`/`soul_licao`/`soul_record_lesson`/`soul_get_lessons` já eram 100% resilientes (arquivo/JSONL, sem `pool.query`). **Fatia 3** fechou os dois pontos que sobravam: `routes/agenda.ts` (GET e POST `/agenda`) agora sonda `isDbHealthy` e responde 503 claro em vez de deixar a exceção crua do `pg` virar 500 genérico (~5s de timeout de conexão); o job em loop `processDueAgenda` (`packages/daemon/src/agenda.ts`) sonda antes de `reapStaleAgenda`/`claimDueAgenda` e pula o ciclo com `logger.warn` em vez de esperar o timeout completo a cada tick de 30s. RAG ingest (`indexFile`, `packages/memory/src/indexer.ts`) — categoricamente diferente (sem fallback conceitual, só falhar rápido) — ganhou a mesma sonda, cobrindo de uma vez os 4 pontos de entrada (CLI, tool MCP `memory_reindex`, tool LangGraph, upload HTTP em `routes/memory.ts`) porque todos passam por `indexFile`. 4 testes novos (`spec-hr1-agenda-db-degraded.test.ts` ×3, `spec-hr1-rag-ingest-db-degraded.test.ts` ×1); suíte completa de `daemon`+`memory`+`tools` sem regressão. | Concluído | — |

<details><summary>Detalhe histórico da Fatia 1 (2026-09-04)</summary>

Confirmado antes de mexer: o daemon já não caía com Postgres fora do ar (try/catch no nível do servidor), mas a requisição respondia **500 sem registrar nada** — não era a degradação suave prometida. `isDbHealthy(pool)` (`packages/core/src/db.ts`, sonda de 1,5s em vez de esperar os 5s do `connectionTimeoutMillis` do pool) checa ANTES de `preparePromptContext`; se o banco estiver fora, cai em `handleChatDegraded()` — sem sessão/RAG/limite de turno, lê `perfil.md`/`licoes.md`/`pessoas.md` direto do disco, chama o Ollama local direto, sanitiza e persiste a troca em `sessoes/YYYY-MM-DD.md` via `anotar()`. `os status` mostra `postgres: DEGRADED`. Teste `spec-hr1-db-degraded.test.ts` prova 200 (não 500) + arquivo Markdown criado. Bug real achado pelo próprio teste: payload do Ollama sem `stream:false`, parse falhava sempre (corrigido).
</details>
| **SPEC-GR4** | 🟡 **Mecanismo concluído, mas quebrado em CI de verdade desde que foi introduzido (2026-09-04 16:03).** Gate `Discriminator` no CI (`.github/workflows/ci.yml`) julga o diff via Guardian (`os discriminator`), falha se score < 95 — só que o secret **`ZEN_API_KEY` nunca foi cadastrado no repositório GitHub** (`gh secret list` vazio), e o design assume Zen sempre disponível no runner do GitHub Actions (comentário no próprio `discriminator.ts`: "é o caso do runner do GitHub Actions, que não tem Ollama local" — o fallback pra Ollama só serve pra máquina de dev). Sem a chave, `auditExecution()` estoura uma exceção não tratada e o job falha em ~2s **sem nunca chegar a julgar o diff** (nenhum JSON de veredito, nenhum "REPROVADO"/"APROVADO" no log) — não é um score baixo, é a ferramenta não rodando. **Achado no PR #34** (2026-09-05, primeiro PR a rodar contra o gate desde que ele foi criado — os PRs #24-33 tiveram suas branches abertas antes do SPEC-GR4 existir, então nunca o exercitaram). Sem branch protection neste repo (plano free do GitHub), nada impede merge mesmo com o check falho — mas o gate para de ter qualquer valor até alguém cadastrar o secret. | P1 — afeta todo PR futuro |
| **DS14+DS15** | ✅ **Concluído.** `StreamingText` ganhou prop `done` (cursor some quando true, `aria-busy`); `MessageList` ganhou `role="log"`+`aria-live="polite"`. | Concluído | — |

## 3. Conformidade / ADR — evidência e aceite de risco, não só merge de código

| ID | Item | Prioridade | Nota |
|---|---|---|---|
| **SPEC-HR5** | 🟡 **Gate de CI fechado 2026-09-05.** `deps-zones.mjs` (guard de allowlist de dependências por zona backend/frontend, existia desde o ADR-UI-001 em 2026-09-01 com testes unitários) nunca rodava de fato em CI — seu `main()`, que varre os `package.json` reais, não estava plugado em lugar nenhum; uma dependência nova fora da allowlist não era barrada por nada. Corrigido: novo step no job `compliance` do CI. `packages/web` (não existia quando o guard foi escrito) atribuído à zona frontend; allowlists atualizadas pro estado real. **Gap maior segue aberto**: ADR formal com veredito keep/replace por dependência (~15 na zona backend) vs. a allowlist original de 5 itens do `system_prompt` — não feito nesta rodada. | P2 (gate fechado); ADR keep/replace ainda P2 |

## 4. Dívida estrutural — incremental, não atrasa hotfix de segurança

| ID | Item | Prioridade |
|---|---|---|
| **Onda 3d** | Centralizar config — Fase 1 ✅ concluída 2026-09-04 (5 fixes). ~58 `process.env` soltos restantes → `loadConfig`+schema; matar pares de alias. | P2, Fase 2 por fatias |
| **Onda 3e** | Quebrar god-objects — ✅ **concluída 2026-09-04** (Fase 1+2). `chat.ts` 1177→22 l. (4 módulos); `tools/index.ts` 2075→338 l. (13 famílias, 59 tools). Ver [ROADMAP.md](../docs/ROADMAP.md). Trabalho futuro opcional (não perdido): decompor as 17 variáveis de `handlePostChat`. | Concluído |
| **SPEC-EP2** | ✅ **Frente 1 concluída 2026-09-05** (política de lint): ESLint criado do zero no monorepo (`eslint.config.js`, não existia nenhuma config antes), `@typescript-eslint/no-explicit-any: error` (testes excluídos da regra), step `Lint` no CI. Dos ~36 `any` de produção encontrados: 8 corrigidos de verdade (tipo real em vez de supressão — `catch` viraram `unknown`, query SQL tipada, tipo real do ADO SDK, tipo real de `toolCalls`), os demais (~28, em payloads de API externa não tipada e libs de terceiros sem `.d.ts`) documentados com `eslint-disable-next-line` + justificativa pontual. **Frente 2 (Zod nas fronteiras) segue aberta** — 0% de cobertura Zod fora de 1 arquivo (`langgraph-tools.ts`, tool-calling do LangChain); doc `BACKLOG-SPEC-COMPLIANCE.md` corrigida (alegava "zod já em uso amplo", que era falso). | Frente 1 concluída; Frente 2 aberta (P1) |
| **SPEC-EP3** | Script único de DoD (`npm run dod`) | P2, depende de SPEC-GR4 |
| **SPEC-GR3** | Browser harness: árvore de acessibilidade + CDP sandbox antes de pixel — catálogo de tools já existe (ver auditoria seção 0), falta é harness/política de ordem obrigatória | P2 |
| **SPEC-EP1** | ✅ **Concluído 2026-09-05.** Seção "Plano (arquivos + ordem)" no template de PR, validada de verdade pelo gate `compliance` do CI (mesmo padrão de Rastreabilidade/Rollback — não decorativa). `AGENTS.md` referencia a regra (e corrigiu, no caminho, a linha desatualizada sobre "sem linter", falsa desde o SPEC-EP2 Frente 1 nesta mesma sessão). | Concluído |
| **M3** | ✅ **Endurecido 2026-09-05.** Default `aviso`→`recusar`; modo `recusar` agora bloqueia medium+high (era só high). Resolução de env var unificada (`resolvePromptInjectionMode`, core) — antes duplicada entre `config.ts` e `packages/memory/src/rag-injection.ts`. Detecção segue regex-only (11 padrões), sem resistência a ofuscação — candidato a follow-up futuro. | Concluído |
| **DS10+DS11** | `CodeBlock`/syntax highlight real, `Markdown` renderiza `[[n]]` como `<Citation>`; `Markdown` perde imagens/checkboxes GFM sob `ALLOWED_TAGS` | P2 |
| **DS12+DS13** | `ScrollArea` sem `aria-label`; `MessageList` só reage a `MutationObserver` (reflow puro não dispara auto-follow) | P3 |

## 5. Operação externa — checklist/runbook, não é feature de código

| Item | Nota |
|---|---|
| **Cloudflare Access service token (E7)** | Doc pronto; ação só no dashboard Cloudflare. |
| **Spike BitNet (`bitnet.cpp`)** | Mitigação pro "Ollama CPU lento" — rodar em paralelo, só no tier mais barato do router. Build pendente na máquina de deploy. Tratar como **benchmark controlado**, não como correção do BUG-01 (são problemas diferentes: BUG-01 é bug de cancelamento, BitNet é throughput). |

## 6. Experimento — hipótese + baseline + métrica + critério de descarte, sem compromisso de entrega

| Item | Nota |
|---|---|
| **Toggles OFF a medir** (`RAG_RERANK`, `RAG_SEMANTIC_CACHE`, `ROUTER_ESCALATION`, prefill Etapa 9) | Usar `os rag eval --history`. **Depende de E13 (corpus real)** — sem consulta representativa e documento esperado, métrica vira smoke test, não evidência. |
| **E13** — protocolo "zero → real" (fase 2/3) | Depende de corpus real do cliente. |
| **Ideias 1–3 do arquivo de ideias** (cláusulas anti-alucinação, ordenação de contexto pra prefix cache, tags XML C.A.R.E.S.) | Todas mexem no mesmo `packages/daemon/src/context.ts` — **testar como um experimento único** com baseline e comparação, não três features paralelas. Ver `ideias-priorizadas.md`. |

## 7. Modo Amigável / Friendly — **PAUSA TOTAL** (decisão do usuário, 2026-09-04)

Trabalho existente (Fases 0–4 + upload de conhecimento) segue funcional, sem manutenção ativa. Nenhum item desta seção entra em execução até o usuário decidir retomar — inclui tudo que depende da infraestrutura de contas/sessão (`account_sessions`, `resolveAccountBearer`), mesmo itens que não estavam originalmente no backlog friendly:

| ID | Item | Prioridade |
|---|---|---|
| FM1 | Ingestão de PDF/DOCX/XLSX no upload self-service | P0 |
| FM2 | Posição de produto: SaaS hospedado × auto-hospedável | P1 |
| FM3 | White-label: marca parametrizável no friendly | P1 |
| FM4 | Fluxo "esqueci minha senha" | P1 |
| ~~FM5~~ | Mesmo item que **B-DEPLOY-2** abaixo — não tratar como dois | — |
| FM6 | Auditar mensagens de erro expostas ao friendly | P2 |
| **B-DEPLOY-1** | `AuthScreen` real no `packages/web` (login por sessão de conta) — hoje token fixo (`VITE_DEV_TOKEN`) embutido no build. **Movido pra cá 2026-09-04**: usa a mesma infraestrutura de contas do friendly. | P1 |
| **B-DEPLOY-2** | Roteamento em `server.ts`: `/` serve o build do `packages/web` com sessão de conta válida, `/hud` exige token admin, `/friendly.html` → 301 `/`. Depende de B-DEPLOY-1. **Movido pra cá 2026-09-04** — mesmo motivo. | P1 |

## 8. Fora do backlog — não consome espaço de planejamento

| Item | Status |
|---|---|
| **OPS-01** — limpar threads de teste (#1–#4) na soul `main` | Tentativa de execução direta **bloqueada pelo classificador de permissão** (ação de DELETE). Precisa rodar manualmente ou com aprovação explícita — não é item de planejamento, é ação operacional pendente. |
| **B-FUTURE** — streaming token-a-token pro tier LangGraph | Explicitamente adiado como follow-up na spec original; não é bloqueador de nada hoje. |
| **ADR-PRIV-002 + M4** — LGPD famílias (AI-4) | **Excluído do backlog deste projeto em 2026-09-05** (decisão do usuário): o domínio famílias foi um teste que vai virar produto próprio, separado do assistente-os. Não tratar retenção/exclusão/backup/ADR-PRIV-002 aqui. `docs/adr/ADR-PRIV-001.md` (aceito) e `docs/AI-INVENTORY.md` #6 ainda registram o resíduo formalmente — não foram alterados nesta rodada; se o produto famílias for mesmo desmembrado, esses dois arquivos (mais `docs/ROADMAP.md`) precisam de uma limpeza dedicada. |

---

## Nota de governança

Campos recomendados por item, daqui pra frente: **tipo** (uma das 7 seções acima), **owner**, **bloqueia/depende de**, **evidência**, **critério de aceite**, **status verificado em** (data + como foi verificado — grep, teste, leitura). A auditoria da seção 0 mostra por que isso importa: 3 de 4 itens checados hoje já estavam prontos e só não tinham sido riscados — prioridade sozinha (P0-P3) não distingue "já feito e esquecido" de "nunca começado".

`docs/ROADMAP.md` continua sendo a fonte canônica de detalhe técnico; este arquivo é o índice de navegação e priorização.
