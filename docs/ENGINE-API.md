# Engine API — o assistente-os como motor headless

> Estado: **Fases 0/1/2/3/5 feitas** (Fase 4 — SDK `@assistente-os/client` —
> também feita). Plano completo em
> `~/.claude/plans/sim-nisso-que-estou-enumerated-shore.md`.

O objetivo é permitir que uma **aplicação cliente independente** (repo próprio,
possivelmente outra stack), rodando na LAN, consuma o assistente-os como motor —
alcançando **todas** as funcionalidades por uma superfície HTTP única, sem
precisar de acesso ao Postgres, ao filesystem de `~/.assistant-os/` nem ao
binário `opencode`.

## Fontes de verdade do contrato

Tudo deriva de um único módulo: [`packages/daemon/src/routes/catalog.ts`](../packages/daemon/src/routes/catalog.ts).

| Recurso | O que serve |
|---|---|
| `GET /llms.txt` | Catálogo em markdown (rotas, tools MCP, eventos SSE/WS, códigos de erro, verbos só-CLI, souls). Para ingestão por agentes. |
| `GET /api/capabilities` | O mesmo, em JSON estruturado. |
| `GET /api/openapi.json` | OpenAPI 3.1 gerado de `REST_ROUTES` (paths, params, security, respostas). |

`capabilities.test.ts` falha se o catálogo tiver rota/tool duplicada ou se
encolher abaixo dos limites conhecidos. **Ao mexer numa rota em `routes/*.ts`,
atualize `REST_ROUTES` no mesmo commit.**

## Autenticação

Três credenciais no header `Authorization: Bearer <…>`:

| Credencial | Como | Alcance |
|---|---|---|
| token admin | `ASSISTENTE_OS_DAEMON_TOKEN` | tudo (superusuário) |
| sessão de conta | token de `/auth/login` (TTL 30 dias) | rotas do modo amigável, escopadas às souls da conta |
| **chave de API** | `aos_…` criada em `POST /admin/api-keys` | só os escopos concedidos; revogável; opcionalmente presa a uma conta |

Níveis por rota (campo `auth` em `REST_ROUTES`):

| Nível | Significado |
|---|---|
| `public` | sem credencial (`GET /health`; e todas as rotas quando o daemon roda **sem** token) |
| `token` | qualquer uma das três credenciais acima (chave: precisa do escopo do `domain` da rota) |
| `account` | sessão de conta (ou chave presa a essa conta) |
| `admin` | token admin, ou chave de serviço com escopo `admin`/`*` |
| `hmac` | assinatura HMAC no corpo (`POST /events`, webhooks) |
| `query-token` | `?token=` na URL (handshake WebSocket — só token admin) |

### Escopos de chave de API

Um escopo é `*` (tudo, inclusive `admin`), um `domain` de `REST_ROUTES`
(`chat`, `souls`, `memory`, `agenda`, `admin`, `mcp`, …) ou `<domain>:read` /
`<domain>:write`. O gate central (`server.ts` → `matchRoute` + `scopeAllows`)
recusa fora do escopo com `403 {code: "E_AUTHZ"}`. Rotas não catalogadas não
são alcançáveis por chave (fail-closed) — mais um motivo para manter
`REST_ROUTES` completo.

**Domínio `mcp` tem um segundo nível de escopo**, `mcp:<família>` (`souls`,
`memory`, `misc`, `journal`, `guardian`, `sales`, `specGrill`, `ado`,
`browser`, `worktree`, `skill`, `soulCreate`, `editorial`, `clinic` — os
mesmos nomes de `TOOL_FAMILIES_TABLE` em `mcp/kernel.ts`). Qualquer
`mcp:<família>` já basta pra alcançar `POST /mcp` (o gate genérico de domínio
não entende sufixo de família); a rota então refina de verdade, olhando qual
tool o corpo JSON-RPC está chamando — ver `routes/mcp.ts` `scopeAllowsTool`.

### CORS

`ASSISTENTE_OS_CORS_ORIGINS` (lista separada por vírgula, ou `*`). Vazio (padrão)
= nenhum cabeçalho CORS, como sempre. Com origens, o gate ecoa
`Access-Control-Allow-*` e responde o preflight `OPTIONS`. Com isso o
`packages/desktop` não precisa mais de `webSecurity:false` (quando o daemon
alvo declara a origem).

**Ainda não existe:** escopo de chave para o WebSocket (hoje só token admin via
`?token=`); rotação automática de chave.

## Matriz de alcance — o que falta para "tudo por HTTP"

### Já alcançável por REST/SSE/WS hoje

souls (identidade, contexto, buffer, health), chat (`fast`/`pro`, tiers
`local`/`zen`/`soul`/`langgraph`), streaming SSE por thread, threads CRUD,
memória/RAG (status, search, upload, limpar), grafo (list + observation),
alma-base (`anotar`/`licao`/`decidir`), agenda, eventos, monitores, missões
(list/run), pipelines (email/meeting ingest), custos/FinOps, voz, worktree,
canais WhatsApp/Telegram, famílias (admin-only), contas self-service + planos
+ allowlist, manifesto de execução, trace por id, métricas, chaves de API,
backup, discriminator, **e as ~65 tools MCP via `POST /mcp`** (ver abaixo).
Ver `REST_ROUTES`.

### MCP sobre HTTP — `POST /mcp` (Fase 2)

O kernel MCP (`McpServer`, `TOOLS`, `FAMILY_HANDLERS`, `authorizeTool`, as 14
famílias) foi **realocado de `packages/tools/src/` pra
`packages/daemon/src/mcp/`** — `tools` já dependia de `@assistente-os/daemon`
(`runOpenCode`, `meetingIngestPipeline`, `createWorktree`, etc.); importar
`tools` de volta no daemon pra montar `/mcp` seria ciclo de dependência
(`tsc -b`/npm workspaces recusam). `packages/tools` agora é só o lançador
stdio fino (`os-mcp`, consumido por opencode/Claude Desktop), reexportando o
kernel de `@assistente-os/daemon`.

`POST /mcp` é JSON-RPC 2.0 — uma requisição, uma resposta (`McpServer.handleMessage`
já era agnóstico de transporte). **Não** é o streamable-HTTP completo da spec
MCP (sem stream SSE de servidor, sem sessão resumível); suficiente pra
`tools/list`/`tools/call` de um app cliente, que é o caso de uso real. Upgrade
pra streamable-HTTP fica pra quando um cliente MCP de verdade (não o app
próprio) precisar.

**Admin-only, de propósito** (mesmo padrão de `/admin/*`/`/familias/*`): o
kernel MCP não tem noção de `ownerAccountId` — só allowlist de tool por soul
(`soul.config.agent.permissions.tools`), pensado pra um operador confiável
rodando localmente. Abrir pra sessão de conta self-service deixaria uma conta
chamar `graph_walk`/`soul_chat`/etc. contra a soul de OUTRA conta — mesma
classe de vazamento que a Fase 5 fechou em `GET /souls/:id`, só que pior
(execução, não só leitura). Um app cliente independente usa uma **chave de
API de serviço** (`account_id` nulo, escopo `mcp` ou `mcp:<família>`).

**Limite conhecido:** o corpo passa por `readJson` (teto de 1 MB, igual toda
rota REST) — uma tool com payload grande (`sales_ingest_meeting` com
transcrição longa) pode estourar; o stdio não tem esse teto. Não resolvido
nesta fase.

`MCP_TOOL_CATALOG` (`routes/catalog.ts`) agora é **derivado** de
`TOOLS`/`TOOL_FAMILIES` (`mcp/kernel.ts`) — não existe mais como lista mantida
à mão, então não tem como divergir da realidade.

### Só via CLI `os` — sem rota HTTP

`CLI_ONLY_VERBS` em `catalog.ts`, depois da Fase 3:

- `migrate` / `import-sc` — **locais por natureza**: leem um diretório no
  filesystem de quem roda a CLI e importam pra `home/souls/`. Não é lacuna;
  não faz sentido como upload remoto sem um desenho próprio (fora de escopo
  por ora).
- `rag eval` — ainda só CLI (viável remotamente, não fechado nesta fase).
- `prompt` (REPL) e `daemon` (sobe/derruba o próprio processo) — locais por
  natureza, não entram no plano.

Fechado na Fase 3: `POST /admin/backup` (backup completo — souls/ + dump do
Postgres — com a mesma retenção de 7 dias que a CLI já aplicava) e
`POST /admin/discriminator` (gate SPEC-GR4/Guardian; o cliente calcula o
`changesSummary` — commits/stat/diff — como a CLI já fazia via git local, e
manda no corpo, já que o daemon não tem acesso ao git de quem chama).
`createFullBackup`/`pruneOldBackups` saíram de `packages/cli` para
`packages/daemon/src/backup.ts` (a CLI virou consumidora do mesmo código, não
duplicação). `GET /trace/:id` e `GET /api/manifest` já existiam — a CLI só não
foi reapontada pra eles ainda (dogfood adiado; não é gap de alcance).

## Isolamento entre contas

- **Gate central de posse de soul** (`server.ts` `soulBelongsToAccount`) cobre
  todo path que casa `/^\/souls\/([^/]+)(?:\/|$)/` — inclusive o path SEM
  segmento seguinte (`GET /souls/:id` sozinho). **Achado 2026-09-09:** até
  aqui o regex exigia uma barra depois do id, então `GET /souls/:id` escapava
  do gate — qualquer conta lia o config completo de qualquer soul só sabendo
  o id. Corrigido; `soul-ownership-sweep.test.ts` varre automaticamente toda
  rota GET escopada por soul (derivado de `REST_ROUTES`, não lista manual) e
  quebra se alguma voltar a vazar.
- **`/familias/*` é admin-only.** A tabela `familias` não tem `account_id` —
  é uma feature de operador (onboarding via WhatsApp), sem modelo de dono
  self-service. Até 2026-09-09 essas rotas só exigiam `token` genérico —
  qualquer conta self-service conseguia listar/ver/apagar dados de qualquer
  família (nome de criança, telefone, anamnese). `handleFamilias` agora
  recusa toda sessão de conta com 403.
- **`REST_ROUTES` teve entradas fantasmas removidas** (`GET /graph/:soulId`,
  `GET /memory/status`, `POST /memory/search`, `GET /accounts/me/souls`) —
  herdadas sem verificar da lista antiga mantida à mão. `catalog-routes-exist.test.ts`
  chama de verdade toda rota GET catalogada contra um daemon real e falha se
  cair no fallback 404 genérico — o par do `mcp-catalog.test.ts` (que faz o
  mesmo para as tools MCP), agora para REST.
- **`ownerAccountId` não tem FK de banco** (souls não são uma tabela — vivem
  em `config.json` em disco). Não é uma lacuna de verdade hoje: a única
  origem legítima de `ownerAccountId` é `getRequestAccountId(req)` (a própria
  sessão autenticada), nunca um valor vindo do cliente — não existe caminho
  pra gravar um `ownerAccountId` inválido/de outra conta pela API self-service.
  Só entraria em jogo se a criação de soul algum dia aceitasse `ownerAccountId`
  arbitrário no corpo (não aceita).

## Consumo hoje (referência)

- `packages/client` (`@assistente-os/client`, Fase 4) — SDK agnóstico de
  framework (REST + SSE: `listThreads`/`createThread`/`getThreadMessages`,
  `streamThreadMessage` + `SSEFrameParser`); sem dependência de React/Vite,
  exporta TS fonte direto (como `packages/ui`, sem `dist/`) pra qualquer
  bundler transpilar — inclusive um app fora do monorepo via dependência
  `file:`.
- `packages/web` — SPA React reapontada pra `@assistente-os/client` (dogfood
  do SDK). É a referência viva do padrão cliente-separado.
- `packages/desktop` — casca Electron sobre o build de `web`, apontada por
  `VITE_API_BASE_URL` a um daemon na LAN. Desliga `webSecurity` como gambiarra
  na falta de CORS (a Fase 1 já resolve isso quando configurado).
- **App cliente independente** (decisão 2026-09-09): em construção em
  `/home/support/terrasia_client`, fora deste monorepo — Vite + React 19 + TS
  (mesma stack de `packages/web`), pra reaproveitar o encapsulamento Electron
  já validado em `packages/desktop`.

## Fora de escopo (não adotar do LionCorp)

RBAC de 3 camadas (Master/Empresa/Colaborador); billing de revenda (câmbio
USD→BRL, multiplicador de token, Stripe, reconciliação assíncrona); a
arquitetura interna Electron de 3 processos do cliente; renomear os arquivos de
persona para `SOUL.md`/`RULES.md`/`USER.md`/`MEMORY.md`. O assistente-os é motor,
não SaaS revendido — cada `account` já é a unidade.
