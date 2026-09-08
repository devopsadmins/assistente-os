# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**`AGENTS.md` is the canonical, detailed agent guide — read it.** This file adds the
big-picture architecture and corrects a few stale points in AGENTS.md.

## Commands

```bash
npm run setup                     # guided installer on a clean machine (prereqs, .env, Postgres, migrations)
npm install && npm run build      # ALWAYS build first — backend tests/typecheck/CLI run from dist/, not src/
npm run typecheck                 # tsc --pretty false, all workspaces
npm run lint                      # eslint . — single rule: @typescript-eslint/no-explicit-any (tests exempt)
npm test                          # all workspaces (needs a running Postgres + pgvector)
npm run dod                       # build → typecheck → lint → test → manifest → discriminator; runs all, summarizes at end

# Single package / single file
npm run test --workspace=@assistente-os/core
node --test packages/daemon/dist/test/extract.test.js      # after building that package

# CLI (the `os` command) — top-level verbs:
#   status souls soul chat migrate import-sc memory graph costs agenda worktree
#   guardian skill prompt rag trace voice backup daemon manifest discriminator
npm run os -- status

# Live/integration tests (real daemon on AOS_URL, real Ollama/LangGraph — NOT in `npm test`, named *.live.ts on purpose)
npm run test:live --workspace=@assistente-os/daemon      # requires AOS_URL / AOS_TOKEN
```

Node `>=22.16.0` (see `engines`). **Two test setups:** the backend packages
(`core`/`memory`/`daemon`/`tools`/`cli`/`voice`) build `src/` → `dist/` with `tsc -b` and
run Node's built-in `node --test` **on `dist/**`** — always `npm run build` first. The
frontend packages (`ui`/`web`) never emit `dist/`: `build`/`typecheck` are `tsc --noEmit`
(plus `vite build` for `web`) and tests run under **Vitest** (`vitest run`, with Testing
Library + `expectNoA11yViolations`). DB tests create an isolated Postgres schema per file
(`packages/*/src/test/pgTestHelper.ts`); `DATABASE_URL` or `DATABASE_URL_TEST` points at the
instance. Without Postgres only the non-DB subset runs.

## Architecture — the big picture

**Monorepo, npm workspaces (`packages/*`), ESM (`"type": "module"`). Backend packages: `tsc -b`, `src/` → `dist/` (gitignored). Frontend packages (`ui`/`web`): `tsc --noEmit` + Vite, no `dist/`.**

| Package | Role |
|---|---|
| `core` | config/`loadConfig`, souls, migrations, router (tier selection + `router_history`), costs, skills loader, governance/golden-rules, guardian |
| `memory` | RAG pipeline (`rag-chain.ts` `retrieveContext`, `indexer.ts` `indexFile`, `rerank.ts`, `rag-confidence.ts`, `rag-injection.ts`) + knowledge graph + entity extraction + LangGraph `agent-workflow.ts` |
| `daemon` | REST + WebSocket server (binds `127.0.0.1:4310`), route modules under `src/routes/`, `orchestrator/` (router, mission-runner). Runs agent tasks either via `opencode run` headless (`runner.ts`) or the LangGraph StateGraph (`langgraph-runner.ts` → `memory/agent-workflow.ts`). Upload (`upload.ts` + `extract.ts`), WhatsApp/Telegram channels |
| `tools` | MCP server (stdio JSON-RPC) exposing the kernel — 13 tool families, `ToolContext`/`FAMILY_HANDLERS` pattern in `src/index.ts` |
| `cli` | the `os` command |
| `voice` | VAD + Whisper STT + TTS |
| `ui` | shared React 19 component library (`@assistente-os/ui`) — Radix primitives, OKLCH theme tokens, Ladle catalog; the frontend dependency zone |
| `web` | Vite + React 19 SPA (`packages/web`) — in-flight thread-based redesign, **not yet the prod entrypoint** (paused with Modo Amigável; see `docs/ROADMAP.md`) |

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
- **Creating a new soul or vertical** (technical flow + v4-standards compliance
  adoption): see `docs/GUIA-CRIACAO-DE-AGENTES.md` — also covers dev-tooling subagents
  for Claude Code, Codex CLI, and OpenCode (the latter's `.opencode/agents/<soul-id>.md`
  files are a different thing: the OpenCode-native backend for `soul.config.agent`).

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
`ROUTER_ESCALATION` (the default reranker model regresses PT-BR corpora — see `rerank.ts`),
`RAG_HYBRID_SEARCH` (RRF fusion of pgvector + Postgres full-text `tsvector`, `indexer.ts`
`search()` — see `docs/RAG-HYBRID.md`). Same pattern for the knowledge graph:
`GRAPH_ENTITY_DEDUP` gates embedding-similarity entity dedup (migration `0024`); name-fold
dedup runs unconditionally.

### Multi-tenant (Modo Amigável)

Account sessions (`accounts` table, scrypt) run alongside the admin token. Ownership of
`/souls/:id/*` is checked centrally in `server.ts`, not per-route. Self-service upload has a
per-account KB cap (`friendlyUploadKbLimit()`). The live account UI is the lightweight
`packages/daemon/web/friendly.html`; the richer `packages/web` SPA is the intended
replacement but is still in-flight. Migrations `0018_accounts` / `0019_friendly_allowlist`.

## Conventions

- **Everything is in Brazilian Portuguese** — code, comments, commits, docs. Keep it.
- **Naming split:** the product is branded **terrasIA** (README, UI, `package.json` root
  `name: "terrasia"`); every workspace package still publishes under the `@assistente-os/*`
  scope and `~/.assistant-os/` is still the runtime home dir. Don't "fix" this mismatch —
  it's an in-progress rebrand, not a bug.
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
  **start there** for what's done vs. open. `docs/design.md` is the current architecture
  narrative (replaced the deleted `docs/ARCHITECTURE.md`). `docs/adr/` is reopened for new ADRs.

## Do not

- Add comments to code unless asked. Add linting/formatting tools unless asked.
- Assume Docker is required — the app runs natively; Docker is only Postgres + optional cloudflared.
- Commit `.env`, `*.db`, `dist/`, `node_modules/`, `logs/`.
