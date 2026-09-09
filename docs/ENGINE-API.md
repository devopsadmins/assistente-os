# Engine API — o assistente-os como motor headless

> Estado: **Fase 0 (contrato) em andamento.** Plano completo em
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
(`chat`, `souls`, `memory`, `agenda`, `admin`, …) ou `<domain>:read` /
`<domain>:write`. Fase 2 adiciona `mcp` / `mcp:<família>`. O gate central
(`server.ts` → `matchRoute` + `scopeAllows`) recusa fora do escopo com
`403 {code: "E_AUTHZ"}`. Rotas não catalogadas não são alcançáveis por chave
(fail-closed) — mais um motivo para manter `REST_ROUTES` completo.

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
canais WhatsApp/Telegram, famílias, contas self-service + planos + allowlist,
manifesto de execução, trace por id, métricas. Ver `REST_ROUTES`.

### Só via MCP `os-mcp` — hoje **stdio + in-process** (não alcançável pela rede)

As ~65 tools de `MCP_TOOL_CATALOG`, com destaque para o que **não** tem
equivalente REST: `graph_walk`, `soul_record_lesson`/`soul_get_lessons`,
`soul_generate_aiia`, `guardian_*` (ciclo de golden-rules + aprovação HITL),
`sales_*`, `spec_grill_plan`, `ado_*`, `browser_*`, `editorial_*`, `clinic_*`,
`skill_create`/`skill_list`, `worktree_*`.

- **Gap:** o servidor MCP (`packages/tools`) só fala JSON-RPC por stdin/stdout e
  importa `@assistente-os/core|memory|daemon` em processo (precisa de Postgres +
  FS + `opencode`). Um cliente remoto não consegue consumir.
- **Fecha em:** Fase 2 — transporte streamable-HTTP + SSE no servidor MCP,
  co-localizado com o daemon e exposto em `/mcp`.

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

## Consumo hoje (referência)

- `packages/web` — SPA React que já consome o daemon via `src/api/{client,stream}.ts`
  (threads + SSE). É a referência viva do padrão cliente-separado.
- `packages/desktop` — casca Electron sobre o build de `web`, apontada por
  `VITE_API_BASE_URL` a um daemon na LAN. Desliga `webSecurity` como gambiarra
  na falta de CORS (a Fase 1 remove essa necessidade).

## Fora de escopo (não adotar do LionCorp)

RBAC de 3 camadas (Master/Empresa/Colaborador); billing de revenda (câmbio
USD→BRL, multiplicador de token, Stripe, reconciliação assíncrona); a
arquitetura interna Electron de 3 processos do cliente; renomear os arquivos de
persona para `SOUL.md`/`RULES.md`/`USER.md`/`MEMORY.md`. O assistente-os é motor,
não SaaS revendido — cada `account` já é a unidade.
