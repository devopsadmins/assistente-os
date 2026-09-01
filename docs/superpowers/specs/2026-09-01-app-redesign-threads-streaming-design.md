# Design — Redesign do app (`packages/web`): threads + streaming

**Data:** 2026-09-01
**Status:** proposto — aguardando revisão
**Sub-projeto:** B, do reposicionamento da superfície amigável (ver
`docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` §"Decomposição")

---

## Contexto

O modo amigável hoje é `packages/daemon/web/friendly.html` — HTML/JS vanilla,
Q&A avulso sem histórico visível, sem múltiplas conversas, resposta bloqueante.
O sub-projeto **A** (design system) está concluído em duas frentes: A1
(`packages/ui` — tokens, `deriveTheme`, `ThemeProvider`, catálogo) já está em
`main`; A2 (o inventário de ~20 componentes React da spec do A1 §4) ainda não
foi implementado, mas seu inventário já está definido.

Durante o brainstorming, duas lacunas de backend apareceram que a decisão
anterior de "chat como conversa de verdade" (threads + streaming) exige e que
não existem hoje:
- `POST /souls/:id/chat` é bloqueante — nenhum tier (`local`/`zen`/`langgraph`)
  transmite a resposta.
- `sessions` permite só **uma sessão aberta por (soul, client_key)** — não há
  conceito de múltiplas conversas nomeadas.

Decisão (usuário): **o B inclui o backend necessário** — não é só front-end.

### Sequência de implementação (decidida)

A spec do B fecha primeiro; A2 (componentes) implementa antes do B, usando o
inventário já definido na spec do A1 — sem novo ciclo de brainstorming. B só
começa a implementação depois que A2 estiver em `main`.

### Não-objetivos do B

- Não implementa branding por conta/domínio (isso é o sub-projeto **D**, que
  depende do **C** — isolamento multi-tenant, ainda não iniciado). `B` monta
  `<ThemeProvider brand={null}>` — sempre o tema padrão.
- Não implementa streaming token-a-token para o tier LangGraph (só progresso
  por passo via `onStep`; o texto final chega de uma vez). Full streaming do
  LangGraph fica para um follow-up.
- Não constrói os componentes React em si (isso é o **A2** — pré-requisito de
  implementação, não parte deste plano).
- Não adiciona paginação de histórico de thread (lista tudo; threads longas
  demais são um problema de escala futuro, não do v1).
- Não geram título de thread via LLM — usa os ~40 primeiros caracteres da
  primeira mensagem.

---

## Visão geral da arquitetura

```
packages/web/  (novo — SPA Vite + React + @assistente-os/ui)
   AuthScreen ─┐
   SoulListScreen ─┼─► api/client.ts (Bearer) ──► daemon REST existente
   ThreadScreen ─┤                                (souls, accountSouls, memory)
   SettingsScreen ┘
        │
        └─► api/stream.ts (fetch + ReadableStream) ──► POST .../messages/stream (NOVO)
                                                              │
                                                    preparePromptContext()  (extraído de handleChat)
                                                              │
                                              ┌───────────────┼────────────────┐
                                         Ollama            Zen/soul         LangGraph
                                    (stream:true real) (stream:true real)  (onStep = progresso;
                                                                             texto final de 1x)
```

`packages/web` entra na **zona de frontend** do ADR-UI-001 (mesma allowlist do
`packages/ui`), verificada pelo `deps-zones.mjs` já existente — é exatamente o
caso que a revisão final do A1 previu ("quando B criar `packages/web`, tem
que estar numa zona").

---

## Componentes do sistema

### 1. Estrutura de pacotes

```
packages/web/
  package.json          # @assistente-os/web · vite, react, @assistente-os/ui
  vite.config.ts        # build -> dist/; dev proxy pro daemon em :4310
  tailwind.config.cjs   # presets: [require("@assistente-os/ui/tailwind-preset")]
  index.html
  src/
    main.tsx             # <ThemeProvider brand={null}><App/></ThemeProvider>
    App.tsx              # troca de tela por estado — sem router
    api/
      client.ts           # fetch wrapper: Bearer, JSON, erros tipados -> mensagem humana
      stream.ts            # fetch + ReadableStream reader do protocolo de eventos
    screens/
      AuthScreen.tsx SoulListScreen.tsx ThreadScreen.tsx SettingsScreen.tsx
    state/
      session.ts           # useAuth() — token em localStorage (mesma chave/comportamento do friendly.js atual)
      threads.ts            # useThreads(soulId), useThreadStream(threadId)

packages/core/src/
  threads.ts             # NOVO — CRUD de threads, isolado por account_id
  migrations.ts          # +migração 0020_threads

packages/daemon/src/routes/
  threads.ts             # NOVO — REST de threads
  chat.ts                # +POST .../messages/stream; preparePromptContext() extraído e reaproveitado por /chat e /stream

packages/daemon/src/server.ts   # webRoot -> packages/web/dist; roteamento de / (ver §7)
```

Sem biblioteca de router — o app é pequeno o bastante pra trocar de tela via
um estado (`screen: "auth" | "souls" | "thread"`) em `App.tsx`.

### 2. Modelo de dados: `threads`

**Migração `0020_threads`:**
```sql
CREATE TABLE IF NOT EXISTS threads (
  id BIGSERIAL PRIMARY KEY,
  soul TEXT NOT NULL,
  account_id BIGINT REFERENCES accounts (id) ON DELETE CASCADE,  -- NULL = thread do operador (token admin)
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_threads_soul_account ON threads (soul, account_id, last_message_at DESC);

ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES threads (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_session_messages_thread ON session_messages (thread_id);
```

- `thread_id` em `session_messages` é nullable — o `/chat` sem thread (uso
  direto via API/integrações) continua funcionando sem thread nenhuma.
- **`account_id` é uma coluna com FK na própria tabela**, não só derivado de
  `soul.config.ownerAccountId` — a checagem de posse é `thread.account_id ==
  accountId`, direto no SQL, sem reabrir o spec da soul a cada request. Isso
  evita o padrão frágil (isolamento só na camada de app) apontado na revisão
  de arquitetura anterior.
- Exclusão é **hard delete** (`DELETE ... WHERE id = $1 AND account_id = $2` →
  cascata em `session_messages`). Threads não são dado de família/saúde (esse
  caso já tem `excluirFamilia` com seu próprio cuidado de retenção).

**`packages/core/src/threads.ts`:**
```ts
export interface Thread { id: number; soul: string; accountId: number | null; title: string; createdAt: string; lastMessageAt: string }

export async function createThread(pool: Pool, soul: string, accountId: number | null, title?: string): Promise<Thread>;
export async function listThreads(pool: Pool, soul: string, accountId: number | null): Promise<Thread[]>; // ORDER BY last_message_at DESC
export async function renameThread(pool: Pool, threadId: number, accountId: number | null, title: string): Promise<Thread | null>;
export async function deleteThread(pool: Pool, threadId: number, accountId: number | null): Promise<boolean>;
export async function touchThread(pool: Pool, threadId: number): Promise<void>; // atualiza last_message_at
```
Todo método com `accountId` filtra por ele na query
(`WHERE id = $1 AND account_id IS NOT DISTINCT FROM $2`).

### 3. Endpoints + protocolo de streaming

```
GET    /souls/:id/threads                          -> Thread[]
POST   /souls/:id/threads                            { title? }        -> Thread
PATCH  /souls/:id/threads/:threadId                  { title }         -> Thread
DELETE /souls/:id/threads/:threadId                                    -> 204
GET    /souls/:id/threads/:threadId/messages                           -> SessionMessage[]
POST   /souls/:id/threads/:threadId/messages/stream   { prompt }       -> stream
```

Todos exigem sessão de conta (mesmo gate de `chat.ts`/`memory.ts`) + o filtro
de `account_id` da própria thread.

**`preparePromptContext(soul, prompt, session): Promise<PreparedContext>`** —
extraído de `handleChat`: sanitização, retrieval de RAG, screening de prompt
injection, checagem de confiança. Chamado tanto por `/chat` (bloqueante, como
hoje) quanto por `/stream` (novo) — o que muda entre os dois é só a etapa
final (chamar o executor de uma vez vs. transmitir). Evita duplicar/divergir
os guardrails de segurança entre os dois caminhos.

**Protocolo:** corpo em formato SSE (`data: {...}\n\n`), consumido via
`fetch()` + `ReadableStream` — **nunca `EventSource`** (não suporta
`Authorization: Bearer` num `GET`; aqui é um `POST` com o header normal).
`Content-Type: text/event-stream`; cada `res.write()` seguido de flush
explícito.

```ts
type StreamEvent =
  | { type: "step"; step: string; tool?: string }
  | { type: "token"; text: string }
  | { type: "done"; messageId: number; usage: UsageMetadata; sources?: Citation[] }
  | { type: "error"; message: string };
```

- **Ollama** — `stream: true` na chamada existente; encaminha
  `message.content` de cada linha NDJSON como `token`.
- **Zen/soul** (clientes OpenAI-compatible) — `stream: true`; parseia os
  chunks SSE da resposta; encaminha `delta.content` como `token`.
- **LangGraph** — `onStep` (já existe) vira eventos `step`; texto final chega
  como **um** `token` só, no fim.
- Erro no meio do stream → `{type:"error"}` e a conexão fecha; o front trata
  como resposta parcial + aviso, não erro técnico cru.

### 4. Arquitetura do front-end

| Tela | Função | Componentes do A2 |
|---|---|---|
| `AuthScreen` | Login/signup (paridade com as 2 abas atuais) | `AuthCard`, `Field`, `Button` |
| `SoulListScreen` | Lista de assistentes da conta + criar novo | `EmptyState`, `Card`, `Button` |
| `ThreadScreen` | `AppShell` com `ThreadList` na sidebar + `MessageList`/`Message`/`StreamingText`/`Composer` | quase o inventário inteiro |
| `SettingsScreen` | Modal com as configs atuais (nome, persona, contexto, turnos, rigor RAG, capabilities, upload) | `SettingsPanel`, `Dialog`, `Field` |

**Estado — hooks + Context, sem lib externa** (Redux/Zustand seriam
over-engineering pro tamanho do app):
- `useAuth()` — token em **`localStorage`** (mesma chave/comportamento do
  `friendly.js` atual — trocar pra `sessionStorage` derrubaria login
  persistente sem avisar ninguém).
- `useThreads(soulId)` — lista/cria/renomeia/apaga; thread ativa.
- `useThreadStream(threadId)` — consome o endpoint de stream; expõe
  `messages`, `streaming`, `send(prompt)`; cada evento atualiza o estado
  incrementalmente (é o que dá o efeito de "aparecendo aos poucos").

**Tema:** `<ThemeProvider brand={null}>` fixo — tema padrão sempre no v1
(branding por conta é D, que depende do C). Com `brand={null}` a árvore de
`deriveTheme` nunca roda, então o boundary de erro (achado da revisão do A1)
não é alcançável neste v1 — fica marcado como TODO no código pra quando D
ligar `brand` de verdade.

**API client** (`api/client.ts`): wrapper fino sobre `fetch`; injeta
`Authorization: Bearer`; mapeia erro HTTP → mensagem amigável — é onde o
**FM6** do backlog (`docs/BACKLOG-FRIENDLY-MODE.md`) se resolve de fato.

---

## Fluxo de dados (enviar uma mensagem)

1. `ThreadScreen` chama `useThreadStream().send(prompt)`.
2. `api/stream.ts` faz `POST .../threads/:id/messages/stream` com o prompt e o
   Bearer.
3. No daemon: gate de conta → `preparePromptContext` (sanitiza, RAG, screening
   de injection) → despacha pro executor do tier resolvido pelo roteador.
4. Cada evento do executor vira uma linha `data: {...}\n\n` escrita e
   flushada na resposta.
5. `api/stream.ts` lê o `ReadableStream`, decodifica linha a linha, entrega
   cada `StreamEvent` pro hook.
6. No daemon, antes de emitir `done`: grava a mensagem do usuário e a
   resposta final em `session_messages` (com `thread_id`) e chama
   `touchThread` (atualiza `last_message_at`) — tudo isso é responsabilidade
   do handler do endpoint, não do front.
7. `useThreadStream` aplica cada evento no estado local: `step` → atualiza
   indicador de progresso; `token` → concatena no texto da mensagem em
   construção; `done` → grava `usage`/`sources`, marca a mensagem como
   finalizada; `error` → marca a mensagem como parcial + erro. O front não
   persiste nada — só reflete o que o backend já gravou.

---

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| Login falha | mensagem humana no `AuthCard`, sem revelar e-mail vs. senha |
| Token expirado/sessão inválida | client intercepta `401`, limpa `localStorage`, volta pra `AuthScreen` com aviso |
| Stream cai no meio | evento `error` → mensagem parcial visível + toast "não consegui terminar, tenta de novo" |
| Upload rejeitado | erro da rota → toast humano (FM6) |
| Daemon fora do ar | `fetch` falha → banner fixo "sem conexão", não tela em branco |
| Criar/renomear/apagar thread falha | toast de erro; sem update otimista |

---

## Plano de teste

- **Backend:** `threads.ts` — CRUD + isolamento por `account_id` (thread da
  conta A não aparece/edita pra conta B); teste de integração no `/stream`
  com um executor fake emitindo eventos NDJSON conhecidos; teste da migração
  `0020`.
- **Frontend:** `useThreadStream` é o núcleo — testado com `fetch` mockado
  emitindo `step`→`token`→`done` (e o caso `error`), verificando a montagem
  incremental da lista de mensagens. Fluxos de tela (auth, criar thread) via
  Testing Library. Teste de componente isolado (`Message`, `Composer`) é do
  **A2**, não repete aqui.
- Sem E2E no v1 (mesmo padrão do resto do repo).

---

## Deploy: roteamento no daemon

`server.ts`'s `webRoot` passa a apontar pro build do `packages/web`
(`dist/`). Isso também fecha o item **FM5** do backlog
(`docs/BACKLOG-FRIENDLY-MODE.md`) como efeito direto, não como item separado:

- **`/` com sessão de conta válida** → serve o app novo.
- **`/` sem sessão de conta** → serve a `AuthScreen` do app novo.
- **HUD move para `/hud`**, só acessível com token admin
  (`ASSISTENTE_OS_DAEMON_TOKEN`) — nunca mais é o que abre por padrão.
- **`/friendly.html`** (rota antiga) vira redirect 301 para `/` — sem manter
  duas cópias do app vivas.

---

## Esforço

- Migração `0020` + `threads.ts` + testes de isolamento: **S–M**
- `preparePromptContext` (extração de `handleChat`) + rotas REST de threads: **M**
- Streaming por tier (Ollama real, Zen/soul real, LangGraph via `onStep`) + protocolo: **L**
- `packages/web` scaffold + telas + hooks (consumindo componentes do A2): **L**
- Roteamento no `server.ts` (webRoot, `/hud`, redirect): **S**

Total do B: **L** (2–3 semanas), depende do A2 estar em `main` antes do
scaffold do front-end começar a valer.

---

## Questões em aberto

- Se o `AOS_RATE_LIMIT` existente cobre bem o endpoint de stream (conexões
  mais longas que uma request normal) — validar no plano de implementação.
- Boundary de erro do `ThemeProvider` fica como TODO explícito no código
  (não bloqueia o v1, já que `brand={null}` nunca lança) — D deve resolver
  isso quando ligar branding de verdade.

## Decisão: heartbeat do `/stream` (resolvida durante a revisão da spec)

Cogitou-se reaproveitar o hub WS existente (`server.ts`'s `WsHub` +
`chat.ts`'s `hub.broadcast({type:"chat.step"|"graph.step"|"chat.done"})`)
como heartbeat do stream. Descartado por dois motivos concretos, achados ao
ler o código:
1. **É uma conexão TCP separada** da do `fetch()+ReadableStream` do
   `/stream` — o WS ficar vivo não prova que a conexão do stream em si
   segue viva (proxy, timeout, aba em background podem matá-la sem o WS
   notar).
2. **O hub faz broadcast sem escopo** — o próprio código documenta:
   *"qualquer cliente que alcançasse a porta recebia todos os broadcasts"*.
   `graph.step` já inclui `lastContent` (texto parcial da resposta) e vai
   pra **todo cliente conectado, de qualquer conta**. Rotear o texto do
   `/stream` por esse canal herdaria esse vazamento entre contas — inaceitável
   pra uma superfície multi-tenant.

**Decisão:** heartbeat é um comentário SSE (`: ping\n\n`) periódico **na
própria conexão do `/stream`** — mantém viva e permite detectar a morte
exatamente da conexão que importa, sem tocar no hub existente.

**Observação separada (fora do escopo do B):** o hub WS de fato faz
broadcast sem isolamento por conta hoje — `chat.step`/`graph.step`/`chat.done`
vazam pra qualquer cliente WS conectado. Isso já existe independente do B;
vale registrar como item de backlog de segurança (relacionado ao MCP_ZERO_TRUST
e à revisão de isolamento multi-tenant já levantada), não é algo que o B
introduz nem precisa corrigir pra fechar sua própria spec.
