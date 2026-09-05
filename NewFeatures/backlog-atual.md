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
| **SPEC-HR1** | 🟡 **Fatia 1 corrigida 2026-09-04 (só `POST /chat`)**. Confirmado antes de mexer: o daemon já não caía com Postgres fora do ar (try/catch no nível do servidor), mas a requisição respondia **500 sem registrar nada** — não era a degradação suave prometida. Agora: `isDbHealthy(pool)` (novo, `packages/core/src/db.ts`, sonda de 1,5s em vez de esperar os 5s do `connectionTimeoutMillis` do pool) checa ANTES de `preparePromptContext`; se o banco estiver fora, cai em `handleChatDegraded()` (novo em `chat.ts`) — sem sessão/RAG/limite de turno (tudo isso depende do Postgres), lê `perfil.md`/`licoes.md`/`pessoas.md` direto do disco, chama o Ollama local direto (bypassa o roteador, que também consulta `router_history`), sanitiza e persiste a troca em `sessoes/YYYY-MM-DD.md` via `anotar()` — a mesma fonte que o RAG reindexa quando o banco volta. `os status` agora mostra `postgres: DEGRADED` (novo, mesma `isDbHealthy`). 1 teste de integração novo (`spec-hr1-db-degraded.test.ts`) — Postgres apontado pra uma porta inatingível, prova 200 (não 500) + arquivo Markdown criado. **Bug real achado pelo próprio teste**: o payload do Ollama não tinha `stream:false`, o parse falhava sempre (corrigido). **Escopo restante (não feito)**: decisões (`soul_decidir`), lições, agenda e RAG ingest ainda não têm fallback — só o `/chat` foi coberto, por decisão explícita de ir em fatias menores. | P1 | Fatia 1/N |
| **SPEC-GR4** | ✅ **Concluído.** Gate `Discriminator` no CI (`.github/workflows/ci.yml`) — julga o diff do PR via Guardian, `os discriminator` (CLI), falha se score < 95. Destravou a Onda 3e. | Concluído | — |
| **DS14+DS15** | ✅ **Concluído.** `StreamingText` ganhou prop `done` (cursor some quando true, `aria-busy`); `MessageList` ganhou `role="log"`+`aria-live="polite"`. | Concluído | — |

## 3. Conformidade / ADR — evidência e aceite de risco, não só merge de código

| ID | Item | Prioridade | Nota |
|---|---|---|---|
| **ADR-PRIV-002 + M4** | AI-4 famílias: exclusão não propaga pro backup, dado sensível (saúde de criança) em texto plano, `temp-vault` nunca faz `purge`. | **P0 condicional** | Bloqueador absoluto **se** esse domínio for exposto a clientes externos; fora desse cenário, P1 estratégico. Não lançar sem retenção/exclusão/backup/ADR fechados. |
| **SPEC-HR5** | Reconciliar dependências com allowlist STDLIB_FIRST | P2 | — |

## 4. Dívida estrutural — incremental, não atrasa hotfix de segurança

| ID | Item | Prioridade |
|---|---|---|
| **Onda 3d** | Centralizar config — Fase 1 ✅ concluída 2026-09-04 (5 fixes). ~58 `process.env` soltos restantes → `loadConfig`+schema; matar pares de alias. | P2, Fase 2 por fatias |
| **Onda 3e** | Quebrar god-objects — ✅ **concluída 2026-09-04** (Fase 1+2). `chat.ts` 1177→22 l. (4 módulos); `tools/index.ts` 2075→338 l. (13 famílias, 59 tools). Ver [ROADMAP.md](../docs/ROADMAP.md). Trabalho futuro opcional (não perdido): decompor as 17 variáveis de `handlePostChat`. | Concluído |
| **SPEC-EP2** | Proibir `any` (lint error) + auditoria de cobertura Zod | P1, dividir em duas frentes (política + validação de fronteira) |
| **SPEC-EP3** | Script único de DoD (`npm run dod`) | P2, depende de SPEC-GR4 |
| **SPEC-GR3** | Browser harness: árvore de acessibilidade + CDP sandbox antes de pixel — catálogo de tools já existe (ver auditoria seção 0), falta é harness/política de ordem obrigatória | P2 |
| **SPEC-EP1** | Planejamento prévio em `<thinking>` no template de PR | P2 |
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

---

## Nota de governança

Campos recomendados por item, daqui pra frente: **tipo** (uma das 7 seções acima), **owner**, **bloqueia/depende de**, **evidência**, **critério de aceite**, **status verificado em** (data + como foi verificado — grep, teste, leitura). A auditoria da seção 0 mostra por que isso importa: 3 de 4 itens checados hoje já estavam prontos e só não tinham sido riscados — prioridade sozinha (P0-P3) não distingue "já feito e esquecido" de "nunca começado".

`docs/ROADMAP.md` continua sendo a fonte canônica de detalhe técnico; este arquivo é o índice de navegação e priorização.
