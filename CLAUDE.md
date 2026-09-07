# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**`AGENTS.md` is the canonical, detailed agent guide — read it.** This file adds the
big-picture architecture and corrects a few stale points in AGENTS.md.

## Commands

```bash
npm run setup                     # guided installer on a clean machine (prereqs, .env, Postgres, migrations)
npm install && npm run build      # ALWAYS build first — tests/typecheck/CLI run from dist/, not src/
npm run typecheck                 # tsc --pretty false, all workspaces
npm run lint                      # eslint . — single rule: @typescript-eslint/no-explicit-any (tests exempt)
npm test                          # node --test on dist/**  (needs a running Postgres + pgvector)
npm run dod                       # build → typecheck → lint → test → manifest → discriminator; runs all, summarizes at end

# Single package / single file
npm run test --workspace=@assistente-os/core
node --test packages/daemon/dist/test/extract.test.js      # after building that package

# CLI (the `os` command)
npm run os -- status | souls | chat | memory | migrate | daemon | backup | manifest | discriminator

# Live/integration tests (real daemon on AOS_URL, real Ollama/LangGraph — NOT in `npm test`, named *.live.ts on purpose)
npm run test:live --workspace=@assistente-os/daemon      # requires AOS_URL / AOS_TOKEN
```

Test runner is Node's built-in `node --test` — **no vitest/jest**. DB tests create an
isolated Postgres schema per file (`packages/*/src/test/pgTestHelper.ts`); `DATABASE_URL`
or `DATABASE_URL_TEST` points at the instance. Without Postgres only the non-DB subset runs.

## Architecture — the big picture

**Monorepo, npm workspaces (`packages/*`), ESM (`"type": "module"`), `tsc -b` per package, `src/` → `dist/` (gitignored).**

| Package | Role |
|---|---|
| `core` | config/`loadConfig`, souls, migrations, router (tier selection + `router_history`), costs, skills loader, governance/golden-rules, guardian |
| `memory` | RAG pipeline (`rag-chain.ts` `retrieveContext`, `indexer.ts` `indexFile`, `rerank.ts`, `rag-confidence.ts`, `rag-injection.ts`) + knowledge graph + entity extraction + LangGraph `agent-workflow.ts` |
| `daemon` | REST + WebSocket server (binds `127.0.0.1:4310`), route modules under `src/routes/`, `orchestrator/` (router, mission-runner). Runs agent tasks either via `opencode run` headless (`runner.ts`) or the LangGraph StateGraph (`langgraph-runner.ts` → `memory/agent-workflow.ts`). Upload (`upload.ts` + `extract.ts`), WhatsApp/Telegram channels |
| `tools` | MCP server (stdio JSON-RPC) exposing the kernel — 13 tool families, `ToolContext`/`FAMILY_HANDLERS` pattern in `src/index.ts` |
| `cli` | the `os` command |
| `voice` | VAD + Whisper STT + TTS |
| `ui` | shared React component library (`packages/ui`) — frontend dependency zone |
| `web` | Vite React app (`packages/web`) — the account-facing SPA |

Package dep graph: `memory`/`voice` → `core`; `daemon` → `core`/`memory`/`voice`;
`tools` → `core`/`memory`/`daemon`; `cli` → `core`/`memory`/`daemon`; `web` → `ui`.
The reverse never happens: `core` must not import from `memory` — this is an enforced
convention (`CONTRIBUTING.md`), not just an emergent pattern.

### Runtime model

- **`~/.assistant-os/`** is the runtime home (not in the repo; `ASSISTENTE_OS_HOME` overrides).
  Holds `.env` (loaded by the daemon, NOT by PM2 — `ecosystem.config.cjs` sets no env),
  and `souls/<id>/`.
- **A "soul"** is a directory: `config.json` (agent permissions, guardrails, capabilities,
  skills allowlist), `perfil.md` / `contexto.md` / `licoes.md` / `pessoas.md` (persona/memory
  injected into the prompt), `sessoes/` (chat history), `sources/uploads/` (RAG source files),
  `skills/` (per-soul `SKILL.md`). Global skills live in `~/.assistant-os/skills/`.
- **Skills** are declarative `SKILL.md` files matched into the prompt by a lexical+embedding
  matcher (`packages/core/src/skills.ts`). Custom FLAT frontmatter parser (not YAML):
  `description` ≤ 280 chars, `keywords`/`tools` must be list form, **CRLF breaks it silently**.
  A skill only reaches the prompt if its name is in the soul's `agent.permissions.skills`.

### Storage — one PostgreSQL, no SQLite

**AGENTS.md is out of date on this.** There is no `kernel.db` / `memory.db` SQLite anymore.
A single PostgreSQL instance (pgvector) reachable via `DATABASE_URL` holds everything:
`cost_calls`, `router_history`, `sessions`, `agenda`, `events`, `execution_logs`, `monitors`
(from `core/src/migrations.ts`), plus RAG `chunks` (with `embedding vector`) and the knowledge
graph (`entities`/`relations`/`observations`). Migrations: embedded SQL strings in
`packages/core/src/migrations.ts`, id `00NN_nome`, idempotent, run by `runMigrations(pool)`.
Redis is an optional cache with in-memory fallback.

### Request flow (chat)

`POST /souls/:id/chat` → `orchestrator/router.ts` `selectExecutionMode` resolves to one of
**two** modes: `fast` (single LLM call) or `pro` (agent loop — `opencode run` or the
LangGraph StateGraph, tool-calling, hard-stop at 5 iterations). "auto" is not a third mode —
it's the absence of an explicit mode, i.e. let the router decide (long prompt / keyword → `pro`).
Before the LLM: RAG retrieval (`retrieveContext` → optional `rerank` → `rag-confidence`
"insufficient evidence" gate → `rag-injection` discards suspicious chunks) and prompt assembly
(`promptPipeline.ts`, ordered most-static → most-volatile for prefix-cache reuse). Model calls
go to Ollama (local/LAN tier) or Zen cloud; **Ollama is optional** — offline, embeddings fall
back to `@xenova/transformers` and the router skips the `local` tier.

Several RAG toggles ship **OFF pending measurement**: `RAG_RERANK`, `RAG_SEMANTIC_CACHE`,
`ROUTER_ESCALATION` (the default reranker model regresses PT-BR corpora — see `rerank.ts`).

### Multi-tenant (Modo Amigável)

Account sessions (`accounts` table, scrypt) run alongside the admin token. Ownership of
`/souls/:id/*` is checked centrally in `server.ts`, not per-route. Self-service upload has a
per-account KB cap (`friendlyUploadKbLimit()`). `packages/web` is the account SPA;
`packages/daemon/web/friendly.html` is the lightweight friendly UI.

## Conventions

- **Everything is in Brazilian Portuguese** — code, comments, commits, docs. Keep it.
- **Branches:** work happens on `dev`; every PR targets `dev`, never `main`. `main` only gets
  `dev`→`main` promotion PRs. GitHub Free → no enforced branch protection; convention only.
- **PR body** has 4 sections enforced by the `compliance` CI job
  (`.github/scripts/compliance-rules.mjs`): Descrição, **`Plano:`** (literal marker, files +
  order, "N/A" rejected), Rastreabilidade (`ADR-XXX` / `roadmap` / `Exx` / `Tn.n` / `#issue`),
  **`Rollback:`** (literal marker, real plan). Touching sensitive paths
  (`core/src/{config,policy,migrations,manifest}.ts`, `core/src/{prompts,governance}/`,
  `.github/`, `docs/adr/`) also requires a `CHANGELOG.md` or `docs/adr/` entry in the same PR.
- **CI** (`.github/workflows/ci.yml`): `compliance` (PR-only) + `build-and-test`. The
  LLM-based `discriminator` gate was removed 2026-09-06 — no PR check calls an LLM. `npm run dod`
  still runs `os discriminator` locally (Zen if configured, else Ollama).
- **Process docs archived 2026-09-06**: ADRs, specs, ARCHITECTURE-REVIEW, backlogs left the
  repo (copied to soul `consultoria_ia`). `docs/ROADMAP.md` absorbed the essential decisions —
  **start there**. `docs/adr/` is being reopened for new ADRs.

## Do not

- Add comments to code unless asked. Add linting/formatting tools unless asked.
- Assume Docker is required — the app runs natively; Docker is only Postgres + optional cloudflared.
- Commit `.env`, `*.db`, `dist/`, `node_modules/`, `logs/`.
