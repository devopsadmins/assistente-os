# AGENTS.md — Assistente OS

## Quick commands

```bash
npm install && npm run build   # always build before anything
npm run typecheck              # tsc --pretty false across all workspaces
npm test                       # node --test on dist/ (requires PostgreSQL)
```

**Order matters:** `build` before `typecheck` or `test` — tests run from `dist/`, not `src/`.

Antes de encerrar um turno de trabalho, rode a suíte completa de verificação
de uma vez (SPEC-EP3):
```bash
npm run dod   # build → typecheck → lint → test → manifest → discriminator + resumo
```
Não para na primeira falha — roda tudo e imprime um resumo no fim, pra ver o
quadro completo antes de descobrir o resto no CI. `manifest`/`discriminator`
exigem `npm run build` prévio (usam `packages/cli/dist/index.js`) e Postgres
alcançável; sem isso, aparecem como "pulado", não como falha.

To run a single package's tests:
```bash
npm run test --workspace=@assistente-os/core
```

## Project structure

Monorepo using **npm workspaces** (`packages/*`). TypeScript with ESM (`"type": "module"`), targeting ES2023, using `NodeNext` module resolution. Each package has `src/` → `dist/` (gitignored), built via `tsc -b`.

| Package | Role | Entry |
|---|---|---|
| `core` | Config, souls, Postgres pool + migrations, costs, router | `packages/core/src/index.ts` |
| `memory` | RAG (chunks+embeddings) + knowledge graph, all in PostgreSQL/pgvector | `packages/memory/src/index.ts` |
| `daemon` | REST + WebSocket server (port 4310), spawns `opencode run` headless | `packages/daemon/src/index.ts` |
| `tools` | MCP server (stdio, JSON-RPC 2.0) exposing kernel to opencode | `packages/tools/src/index.ts` |
| `cli` | `os` command (status, souls, chat, memory, migrate, daemon, backup) | `packages/cli/src/index.ts` |
| `voice` | VAD + STT (Whisper) + TTS pipeline | `packages/voice/src/index.ts` |

**Dependency graph:** `memory` and `voice` depend on `core`. `daemon` depends on `core`, `memory`, `voice`. `tools` depends on `core`, `memory`, `daemon`. `cli` depends on `core`, `memory`, `daemon`.

## Runtime artifacts (not separate projects)

This is a multi-root workspace with **3 folders**, but only `assistente-os/` is
the source repo. The other two are generated *by* code in this repo at
runtime — never edit them as if they were independent codebases:

- **`~/.assistant-os/`** (`ASSISTENTE_OS_HOME`, default) — the app's home dir:
  `souls/` (per-soul markdown knowledge + `sources/uploads/` + `sessoes/`),
  `.env` (secrets loaded by `loadDotEnv()`), `mcp/`, `governance/`. State that
  needs querying (costs, sessions, RAG chunks, graph) lives in PostgreSQL, not
  here. Created/written by `packages/core/src/config.ts` (`resolveHome`) and the
  `os` CLI/daemon — not part of git, not scaffolded by hand.
- **`~/.assistant-os-backups/`** (`ASSISTENTE_OS_BACKUP_DIR`, default) — zip
  backups of `~/.assistant-os/` produced by the `os backup` command
  (`packages/core/src/config.ts`), 7-day retention. Deliberately a sibling
  dir, not nested inside `~/.assistant-os/`, so retention cleanup never
  touches live data.

If a task involves "the project", assume it means the `assistente-os/` repo
unless the user explicitly points at a soul or a backup.

## Key non-obvious facts

- **Tests run from `dist/`** — always `npm run build` first. Tests use Node's built-in `node --test` runner (no vitest/jest).
- **PostgreSQL required for full tests** — DB tests need a running Postgres with pgvector. Without it, only a subset of non-DB tests can run via `run-tests.sh`.
- **One PostgreSQL (pgvector), no SQLite.** `DATABASE_URL` is the single connection; there is no `kernel.db` / `memory.db` anymore (`core/src/db.ts` imports only `pg`; comments say "era assim com node:sqlite"). It holds `cost_calls`, `router_history`, `sessions`, `agenda`, `events`, `execution_logs`, `monitors` (from `core/src/migrations.ts`), plus RAG `chunks` (`embedding vector`) and the graph (`entities`/`relations`/`observations`). Migrations: embedded SQL strings in `packages/core/src/migrations.ts`, run by `runMigrations(pool)`. Tests isolate a schema per file (`pgTestHelper.ts`). Redis is an optional cache with in-memory fallback.
- **Ollama is optional** — system degrades gracefully. With Ollama offline, embeddings fall back to `@xenova/transformers` locally, and the router skips the `local` tier.
- **ESLint configured since 2026-09-05** (`eslint.config.js`, root) — scope deliberately minimal: `@typescript-eslint/no-explicit-any` as the only rule, test files excluded. Run with `npm run lint`. No prettier or biome.
- **CLI shortcut:** `npm run os <args>` runs `node packages/cli/dist/index.js <args>`.
- **PM2 deployment:** `ecosystem.config.cjs` is the process config. It deliberately does NOT set env vars — they come from `~/.assistant-os/.env` loaded by `loadDotEnv()`.
- **`ASSISTENTE_OS_HOME`** env var overrides the default `~/.assistant-os` home directory.
- **Daemon binds `127.0.0.1` by default** — set `AOS_HOST` and `ASSISTENTE_OS_DAEMON_TOKEN` for remote access.
- **LangGraph integration** — `packages/memory/src/agent-workflow.ts` (StateGraph, runAgent, runAgentStream), `packages/daemon/src/langgraph-runner.ts` (runLangGraphAgent, runLangGraphAgentStream), `packages/daemon/src/orchestrator/router.ts` (`selectExecutionMode`). `ExecutionMode` is `"fast" | "pro"` (two modes); "auto" in the UI = no explicit mode, let the router decide.
- **LangGraph UI** — aba `tab-langgraph` em `packages/daemon/web/index.html` com SVG do grafo, step tracker, mode toggle (auto/fast/pro) no chat.
- **LangGraph tests** — unit: `packages/memory/src/test/agent-workflow.test.ts` (14), `packages/daemon/src/test/orchestrator-router.test.ts` (17). Integration (contra um daemon real rodando em `AOS_URL`/porta 4310, não entram no `npm test` — renomeadas para `.live.ts` de propósito pra não bater no glob `*.test.ts` e travar a suíte automatizada com chamadas reais ao Ollama/LangGraph): `packages/daemon/src/test/langgraph-rest-full.live.ts`, `packages/daemon/src/test/langgraph-stream.live.ts`, `packages/daemon/src/test/langgraph-tools-rest.live.ts`. Rode com `npm run test:live --workspace=@assistente-os/daemon` (requer `AOS_URL`/`AOS_TOKEN` apontando pro daemon). Shell: `packages/daemon/src/test/test-langgraph-stream.sh`.
- **LangGraph docs** — `docs/LANGGRAPH.md`, `docs/adr/ADR-AI-004.md`.

## Language

Code, comments, commit messages, and documentation are in **Brazilian Portuguese**. Maintain this convention.

## Branches

Since 2026-09-06 (`main` a virar produto vendável): `dev` is the integration
branch — every feature/fix branch opens its PR against `dev`, not `main`.
`main` only receives promotions from `dev` (a `dev`→`main` PR) after CI is
green and a manual homologação pass. **This repo is on GitHub Free (private,
org `devopsadmins`)** — classic branch protection and rulesets return 403
("Upgrade to GitHub Pro") on this plan, so there is **no technical block**
against pushing straight to `main`; the two-branch model is enforced by
convention only. Follow it anyway: open every PR against `dev`.
`.github/workflows/ci.yml` runs on push to both `main` and `dev`, plus every
PR.

## Pull requests

`.github/pull_request_template.md` has 4 required sections, all enforced by the `compliance` CI job (`.github/scripts/compliance-rules.mjs`): Descrição (min length), **Plano — arquivos + ordem** (SPEC-EP1, 2026-09-05: architectural reasoning before code — which files change, in what order, and why that order; "N/A" or a placeholder is rejected), Rastreabilidade (ADR-XXX, roadmap Exx, Tn.n, or #issue), Rollback (real plan, "N/A" rejected). Changes to sensitive paths (`packages/core/src/{config,policy,migrations,manifest}.ts`, `packages/core/src/{prompts,governance}/`, `.github/`, `docs/adr/`) also require a `CHANGELOG.md` or `docs/adr/` entry in the same PR. `docs/adr/` was archived out in 2026-09-06 and reopened for `ADR-RAG-002` — a new ADR file there satisfies the paper trail; otherwise use a `CHANGELOG.md` entry. The `discriminator` (LLM) CI gate was removed 2026-09-06 — only `compliance` and `build-and-test` run on PRs.

## Documentação arquivada (2026-09-06)

ADRs, specs/plans de `docs/superpowers/`, análises pontuais (ARCHITECTURE-REVIEW,
ARCHITECTURE-REFINEMENT-REVIEW, system_overview), dumps do NotebookLM, e
backlogs já fechados (design system, spec-compliance, friendly-mode, ideias
não comprometidas) saíram do repo — o produto não carrega mais o histórico
de processo interno. Tudo isso foi copiado antes de apagar para a soul
`consultoria_ia`, cliente **SousaLima**
(`~/.assistant-os/souls/consultoria_ia/conhecimento/clientes/sousalima/arquivo-historico/`),
reindexado ali. `docs/ROADMAP.md` absorveu o essencial de cada decisão antes
do arquivamento — comece por ele antes de ir procurar na soul.

## What NOT to do

- Do not add comments to code unless explicitly asked.
- Do not add linting/formatting tools without being asked.
- Do not commit `.env`, `*.db`, `dist/`, `node_modules/`, or `logs/` (all gitignored).
- Do not assume Docker is required — the app runs natively. Docker is only for Postgres and optional cloudflared tunnel.
