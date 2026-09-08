# Modo Amigável — contas multi-tenant self-service

Camada de acesso self-service sobre o terrasIA: uma pessoa cria uma conta
por e-mail/senha, ganha um assistente (soul) próprio e configura o essencial
por uma UI enxuta (`/friendly.html`), sem token de admin e sem tocar em
`config.json`.

Entregue em 2026-08-31, Fases 0–4 + rename + allowlist de admin. Migrações
`0018_accounts` e `0019_friendly_allowlist`.

## Modelo mental

Duas credenciais coexistem no daemon, em paralelo:

| Credencial | Escopo | Rotas |
|---|---|---|
| **Token admin** (`ASSISTENTE_OS_DAEMON_TOKEN`) | Tudo. Modo especialista. | Todas |
| **Sessão de conta** (Bearer, TTL 30 dias) | Só as souls cujo `ownerAccountId` é a conta. | `/auth/*`, `/accounts/me/*`, e `/souls/:id/*` das souls próprias |

O token admin nunca perde acesso a nada. A sessão de conta só é tentada quando
o Bearer recebido **não** bate com o token admin (`server.ts`, gate central).
Souls sem `ownerAccountId` são "do operador" e ficam invisíveis para qualquer
conta.

## Autenticação (Fase 0)

`packages/core/src/accounts.ts` + `packages/daemon/src/routes/auth.ts`.

- `POST /auth/signup` — `{ email, password }` → cria conta + sessão. Senha ≥ 8
  chars, hash **scrypt** nativo (`node:crypto`, sem dependência nova), salt por
  conta. E-mail normalizado (trim + lowercase), `unique`.
- `POST /auth/login` — `{ email, password }` → sessão nova. Resposta única para
  "e-mail não existe" e "senha errada" (anti-enumeração).
- `POST /auth/logout` — apaga a sessão do Bearer.
- `GET /auth/me` — conta da sessão atual.

Sessão: token de 32 bytes aleatórios devolvido **em claro só na resposta**; o
banco guarda só o `sha256`. Tabelas `accounts` e `account_sessions`
(`account_id` FK `ON DELETE CASCADE`). Signup/login são alcançáveis sem token
nenhum; o rate limit por cliente do daemon se aplica normalmente.

## Busca e pergunta (Fase 1)

A sessão de conta passa a ser aceita como segunda credencial no gate central.
Guarda de posse **centralizada**: qualquer `/souls/:id/*` (atual ou futura —
upload, contexto, grafo, chat, memória…) é verificada contra
`ownerAccountId` num lugar só, em vez de rota por rota. `GET /souls` (sem id)
se auto-escopa em `souls.ts`.

## Wizard de criação de soul (Fase 2)

`POST /accounts/me/souls` — `packages/daemon/src/routes/accountSouls.ts`.

Payload deliberadamente mínimo vs. o `soul_create` completo: só `purpose`
(vira `description`) e `id` opcional (auto-sugerido do purpose via slug único).
Todo o resto é default seguro: `autonomy: "ask"`, `capabilities: []` (zero
tools por padrão), `skills: []`.

Fluxo idêntico ao da tool MCP `soul_create`: `dry_run` → `plan_hash` →
reenviar com o hash para confirmar (`409 E_STALE_HASH` se divergir). Reusa a
lógica core (`validateSoulSpec`, `resolveSoulSpecDefaults`, `computePlanHash`,
`createSoulFromSpec`), só que autorizada por sessão de conta em vez de
`AGENT_SOUL_ID`.

Teto: `ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT` (env, default **2**) →
`400 E_ACCOUNT_LIMIT`.

## Configurações escopadas (Fase 3)

`GET` / `PATCH /accounts/me/souls/:id`.

Superfície de edição pelo modo amigável:

- `displayName` (nome editável do assistente, ver "Rename") e `description`;
- as duas personas mais usadas: `perfil.md` e `contexto.md`;
- guardrails numéricos (`maxTurns`, `maxIterations`, `ragRelevanceThreshold`) —
  sempre **re-clampados contra o teto global**, nunca afrouxam;
- `capabilities` / `skills` — **só dentro da allowlist do admin**
  (`validateRequestedGrants`); fora dela = `400 E_VALIDATION`, nunca aceita
  parcial nem ignora em silêncio.

Fixos desde a criação (v1): `autonomy`, `connectors`, `provider`, `model`,
`ownerAccountId`.

## Rename (`displayName`)

`46f3145`. `SoulConfig.displayName` opcional, editável pela Fase 3; usado pela
UI amigável. Não altera o `id` da soul (chave de tudo).

## Upload de conhecimento (Fase 4)

Upload self-service com teto **em KB por conta** (não em nº de chunks) —
`friendlyUploadKbLimit()` (`packages/daemon/src/upload.ts`),
`directoryTotalBytes(sources/uploads)`. A view de settings devolve
`knowledge: { usedKb, limitKb }` com 1 casa decimal (um upload de poucas
dezenas de bytes não vira "0 KB").

### Ingestão de PDF/DOCX/XLSX (FM1, 2026-09-06)

`.md`/`.markdown`/`.txt` entram direto na indexação; `.pdf`/`.docx`/`.xlsx`
passam por `extractDocumentText()` (`packages/daemon/src/extract.ts`) e viram
um **sidecar `<arquivo>.md`** ao lado do original em `sources/uploads/`, que é
o que a indexação RAG consome (`.md`/`.txt`/CLI seguem intactos). A resposta
do `POST /souls/:id/upload` ganha `documents: { indexed, skipped }`; um
documento sem texto extraível (escaneado, protegido, corrompido) é **salvo
para proveniência**, listado em `skipped` com o motivo, e **não** derruba o
upload. PDF usa `pdf-parse`; DOCX/XLSX usam o `adm-zip` já presente (parse
manual do XML). Sem OCR. O binário original e o sidecar contam os dois no teto
de KB.

## Allowlist de admin (capabilities + skills)

`6590ad7`. Tabela `friendly_allowlist (pattern, kind)`, `kind ∈
{capability, skill}`. **Fechada por padrão** — nenhuma conta self-service
recebe capability alguma até o admin abrir algo aqui.

- `GET` / `PUT /admin/friendly-allowlist` — `packages/daemon/src/routes/friendlyAdmin.ts`.
  **Exige token admin, nunca sessão de conta** (mesmo que a sessão tenha
  passado pelo gate): é aqui que se decide o que o self-service pode fazer.
- `PUT` substitui a allowlist inteira (não incremental).
- Capabilities fora do `CAPABILITY_CATALOG` são ignoradas silenciosamente
  (defesa contra bug de UI). Skills **não** têm catálogo fechado — variam por
  instalação; a rota admin oferece só as skills de escopo **global**
  (`scanSkillDirs(...).filter(scope === "global")`), porque skill de soul
  específica pertence ao operador.
- `GET /accounts/me/available-capabilities` (sessão de conta) devolve só o que
  está liberado, para a UI montar os pickers.

Fluxo de skill no modo amigável: skill global existe em `~/.assistant-os/skills/`
→ admin marca em `PUT /admin/friendly-allowlist` → aparece no picker da conta →
conta escolhe → vai para `agent.permissions.skills` do `config.json` da soul.
Ver [ROADMAP.md](ROADMAP.md) para os itens abertos (preflight de requisitos da
skill, co-concessão das tools que a skill declara).

## Configuração

| Env | Default | Efeito |
|---|---|---|
| `ASSISTENTE_OS_DAEMON_TOKEN` | — | Sem ele, o modo amigável ainda funciona, mas o daemon não exige auth para o resto (só recusa boot em host não-loopback). |
| `ASSISTENTE_OS_MAX_SOULS_PER_ACCOUNT` | `2` | Souls por conta no wizard. |
| teto de upload (KB por conta) | ver `upload.ts` | Teto de conhecimento self-service. |

## Testes

`packages/daemon/src/test/`: `account-isolation.test.ts`,
`account-soul-wizard.test.ts`, `account-soul-settings.test.ts`,
`account-knowledge-upload.test.ts`, `friendly-allowlist.test.ts`,
`friendly-doc-upload.test.ts` (FM1, rota ponta a ponta),
`extract.test.ts` (FM1, extração PDF/DOCX/XLSX pura);
`packages/core/src/test/accounts.test.ts`.

## Pendente

- **ADR do modelo de dados de conta** — `accounts` guarda e-mail + hash de
  senha + sessões. Base legal, finalidade e retenção não estão declaradas (o
  mesmo gate G3 que motivou `ADR-PRIV-001` para `familias`).
- **Preflight de requisitos de skill** no picker (bins/env/tools) — hoje uma
  skill liberada pode ser escolhida e falhar opaca na máquina da conta.
- **Co-concessão das tools declaradas pela skill** — habilitar a skill sem pôr
  as `tools:` dela em `agent.permissions.tools` deixa a skill meio-quebrada.
- Fluxo de contribuição: as Fases 0–4 entraram por commit direto em `main`,
  fora do fluxo PR+CI do [CONTRIBUTING.md](../CONTRIBUTING.md).
