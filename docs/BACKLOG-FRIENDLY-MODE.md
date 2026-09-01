# Backlog — Perfil "Modo Amigável" (self-service multi-tenant)

Backlog **gerenciável** dos gaps que separam o modo amigável de um produto que um
cliente não-técnico (ex.: escritório fiscal/contábil) usa sozinho, sem depender do
operador a cada passo. Estado **verificado no código** em 2026-09-01.

Escopo: só experiência self-service / white-label / onboarding do cliente final.
Governança da spec fica em [`BACKLOG-SPEC-COMPLIANCE.md`](BACKLOG-SPEC-COMPLIANCE.md);
features gerais em [`ROADMAP.md`](ROADMAP.md).

---

## Como gerenciar

- **ID**: `FM<n>` — estável, use em branch/commit/PR.
- **Status**: `TODO` → `DOING` → `REVIEW` (PR aberto) → `DONE` · ou `BLOCKED`.
- **Fonte de verdade do status**: a coluna Status do board abaixo.
- **Prioridade**: `P0` = bloqueia o cliente alimentar/usar o sistema sozinho ·
  `P1` = vira ticket/suporte manual recorrente ou trava venda white-label ·
  `P2` = higiene de UX / decisão de posicionamento.

---

## Board

| ID | Item | Área | Prio | Esforço | Status | Depende |
|---|---|---|---|---|---|---|
| FM1 | Ingestão de PDF/DOCX/XLSX no upload self-service | Conhecimento | P0 | M | TODO | SPEC-HR5 (allowlist de deps) |
| FM2 | Posição de produto: SaaS hospedado × auto-hospedável (onboarding) | Produto | P1 | S (ADR) / L (instalador) | TODO | — |
| FM3 | White-label: marca parametrizável no friendly | White-label | P1 | M | TODO | — |
| FM4 | Fluxo "esqueci minha senha" | Auth | P1 | M | TODO | canal de e-mail transacional |
| FM5 | Porta de entrada padrão sempre o friendly (nunca o HUD por acidente) | Roteamento | P1 | S | TODO | — |
| FM6 | Auditar mensagens de erro expostas ao friendly | UX | P2 | S | TODO | — |

---

## Itens

### FM1 — Ingestão de PDF/DOCX/XLSX no upload self-service  ·  P0
**Objetivo**: o cliente sobe contratos em PDF, planilhas e documentos Word pela tela
amigável e eles entram no RAG, sem conversão manual pra Markdown.
**Estado atual (verificado)**: `handleUpload` (`packages/daemon/src/upload.ts`) grava
qualquer arquivo como está; só `.zip` é extraído (com defesa contra zip-slip).
**`packages/daemon/src/routes/memory.ts:135` indexa em segundo plano só `.md`/`.txt`**
recém-salvos. Um PDF/DOCX subido é gravado em `sources/uploads/` e **nunca é
chunked nem indexado** — fica morto. Não há extrator de texto de PDF/DOCX/XLSX em
nenhum pacote.
**Gap**: sem isso, "o cliente alimenta o sistema sozinho" não existe — todo upload
útil (contrato, planilha, Word) exige o operador converter antes.
**Aceitação**:
- Upload de `.pdf`, `.docx`, `.xlsx` → texto extraído → chunk + index no RAG do soul.
- Formato não suportado → rejeição **explícita** com mensagem amigável (ver FM6),
  nunca gravação silenciosa que não indexa.
- O teto em KB por conta (`friendlyUploadKbLimit`) passa a contar o texto extraído,
  não o binário.
- Teste: sobe um PDF de fixture, `memory ... search` acha um trecho dele.
**Arquivos**: `packages/daemon/src/upload.ts`, `packages/daemon/src/routes/memory.ts`,
novo extrator (`packages/memory` ou `packages/core`).
**Relacionado**: SPEC-HR5 — pdf-parse/mammoth/xlsx trazem deps fora da allowlist
STDLIB_FIRST; decidir keep/replace no mesmo ADR.

### FM2 — Posição de produto: SaaS × auto-hospedável  ·  P1
**Objetivo**: onboarding condizente com o público. Hoje é 100% dev.
**Estado atual (verificado)**: `QUICKSTART.md` exige Node ≥ 22.5, PostgreSQL 17 +
pgvector, `~/.assistant-os/.env` editado à mão (dezenas de variáveis documentadas),
Docker Compose, Ollama opcional. `npm run setup` é guiado mas ainda pressupõe
terminal, Docker e Postgres na máquina.
**Gap**: nenhum cliente não-técnico roda isso.
**Aceitação**:
- ADR curto fixando a decisão: **SaaS hospedado pelo operador** por ora — e o
  pitch/material de venda diz isso explicitamente ("nós hospedamos", não "você
  instala").
- Se/quando virar produto auto-hospedável: imagem Docker única + assistente de
  configuração via web (sem editar `.env` à mão) viram épicos próprios.
**Arquivos**: `docs/adr/`, `QUICKSTART.md` (seção "para quem é"), material de venda.

### FM3 — White-label: marca parametrizável  ·  P1
**Objetivo**: vender com a cara do cliente (ex.: Elebece), não com "Assistente OS"
visível pro usuário final dele.
**Estado atual (verificado)**: `packages/daemon/web/friendly.html` fixa
`<title>Assistente OS</title>` (l.6), `<img class="friendly-logo" src="/assets/logo.png">`
(l.13) e `<span class="friendly-title">Assistente OS</span>` (l.14). `displayName`
por soul existe, mas é o nome do *assistente*, não a marca do produto/página.
**Gap**: marca e logo hardcoded no HTML.
**Aceitação**:
- Nome do produto, logo e cor primária vêm de config (por conta ou por deploy);
  `friendly.html` lê de um endpoint/CSS var. Default = "Assistente OS".
- Teste cobre um override completo (nome + logo + cor).
**Arquivos**: `friendly.html`, `packages/daemon/web/assets/friendly.css`,
`packages/daemon/src/routes/friendlyAdmin.ts`, `packages/core/src/accounts.ts`.

### FM4 — Fluxo "esqueci minha senha"  ·  P1
**Objetivo**: usuário final recupera acesso sozinho.
**Estado atual (verificado)**: `packages/core/src/accounts.ts` só tem
createAccount / createAccountSession / resolveAccountSession / deleteAccountSession.
`grep -i "reset|forgot|recover|esqueci"` nas rotas do daemon → nada. Login e signup
existem; recuperação não.
**Gap**: cada senha esquecida vira ticket manual — não escala.
**Aceitação**:
- Fluxo de reset por e-mail: token de uso único, com expiração; tela no friendly;
  rate-limit por conta/IP.
- Teste: token expirado e token já usado são rejeitados.
**Arquivos**: `packages/core/src/accounts.ts`, `packages/daemon/src/routes/accountAuth.ts`,
`friendly.html` / `friendly.js`, migração (tabela de tokens de reset).
**Depende**: canal de e-mail transacional — hoje inexistente; decidir provedor
(ligado ao FM2, se SaaS).

### FM5 — Porta de entrada padrão sempre o friendly  ·  P1  ·  S
**Objetivo**: um leigo nunca cai no HUD de operador sem pedir.
**Estado atual (verificado)**: `packages/daemon/src/server.ts:422` — `/` serve
`index.html` (o HUD sci-fi). `/friendly.html` é rota explícita à parte
(`PUBLIC_ROOT_FILES`). Ou seja, **o default (`/`) é o HUD**.
**Gap**: o ponto de entrada natural leva ao lugar errado pro usuário final.
**Aceitação**:
- Requisição a `/` **com sessão de conta** (cookie/token de `account_sessions`)
  serve ou redireciona pro friendly.
- O HUD fica sob `/hud` (ou exige token admin). Sem sessão de conta e sem token
  admin → friendly (ou tela de login do friendly).
- Teste de roteamento cobre os três casos (conta, admin, anônimo).
**Arquivos**: `packages/daemon/src/server.ts` (serveStatic + roteamento de `/`).

### FM6 — Auditar mensagens de erro expostas ao friendly  ·  P2  ·  S
**Objetivo**: toda falha que o `friendly.js` pode receber vira frase humana em
PT-BR com ação sugerida — nunca stack trace, `code` interno ou rota crua.
**Estado atual (verificado)**: parcial. `routes/memory.ts:119` já devolve texto
humano ("limite de conhecimento (N KB) atingido…"). **Não auditado**: RAG
"evidência insuficiente", sessão expirada, upload rejeitado por formato/tamanho,
`429`/`503` (rate limit / cap de concorrência), timeout ou erro do LLM, erros de
auth.
**Gap**: é fácil esquecer um caminho e vazar erro técnico — frustração silenciosa.
**Aceitação**:
- Varredura de todas as respostas de erro nas rotas sob sessão de conta; tabela
  "condição → texto exibido" neste doc.
- Cada uma: PT-BR + o que o usuário faz a seguir; zero stack / `code` / rota.
**Arquivos**: `packages/daemon/web/assets/friendly.js`, `routes/memory.ts`,
`routes/accountSouls.ts`, `routes/chat.ts`, `routes/accountAuth.ts`.

---

## Relacionado (fora do escopo deste board)

Gaps de **isolamento multi-tenant** levantados na revisão de 2026-09-01, que
sustentam o modo amigável mas são de arquitetura, não de UX:

- `soul.config.ownerAccountId` vive no arquivo de spec da soul, **não** numa coluna
  com FK — isolamento é só na camada de aplicação, rota por rota
  (`chat.ts:218`, `souls.ts:34`, `memory.ts:46`, `server.ts:528`), sem teste que
  quebre ao adicionar rota sem o gate.
- Caminho legado `client_key` / `X-Client-Id` (`chat.ts:268`, migração `0012`)
  coexiste com `accounts` sem reconciliação — ROADMAP Onda 3f.
- `excluirFamilia` (LGPD) não tem dimensão de conta.

Ver [`BACKLOG-SPEC-COMPLIANCE.md`](BACKLOG-SPEC-COMPLIANCE.md) e ROADMAP Ondas 3e/3f.

---

## Rastreio de mudança

| Data | Item | Evento |
|---|---|---|
| 2026-09-01 | — | Backlog criado a partir da revisão do perfil amigável (6 itens). |
