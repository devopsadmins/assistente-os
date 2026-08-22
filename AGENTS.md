# AGENTS.md — Assistente OS

## Quick commands

```bash
npm install && npm run build   # always build before anything
npm run typecheck              # tsc --pretty false across all workspaces
npm test                       # node --test on dist/ (requires PostgreSQL)
```

**Order matters:** `build` before `typecheck` or `test` — tests run from `dist/`, not `src/`.

To run a single package's tests:
```bash
npm run test --workspace=@assistente-os/core
```

## Project structure

Monorepo using **npm workspaces** (`packages/*`). TypeScript with ESM (`"type": "module"`), targeting ES2023, using `NodeNext` module resolution. Each package has `src/` → `dist/` (gitignored), built via `tsc -b`.

| Package | Role | Entry |
|---|---|---|
| `core` | Config, souls, kernel.db, costs, router, migration | `packages/core/src/index.ts` |
| `memory` | RAG (chunks+embeddings) + knowledge graph in SQLite | `packages/memory/src/index.ts` |
| `daemon` | REST + WebSocket server (port 4310), spawns `opencode run` headless | `packages/daemon/src/index.ts` |
| `tools` | MCP server (stdio, JSON-RPC 2.0) exposing kernel to opencode | `packages/tools/src/index.ts` |
| `cli` | `os` command (status, souls, chat, memory, migrate, daemon, backup) | `packages/cli/src/index.ts` |
| `voice` | VAD + STT (Whisper) + TTS pipeline | `packages/voice/src/index.ts` |

**Dependency graph:** `memory` and `voice` depend on `core`. `daemon` depends on `core`, `memory`, `voice`. `tools` depends on `core`, `memory`, `daemon`. `cli` depends on `core`, `memory`, `daemon`.

## Key non-obvious facts

- **Tests run from `dist/`** — always `npm run build` first. Tests use Node's built-in `node --test` runner (no vitest/jest).
- **PostgreSQL required for full tests** — DB tests need a running Postgres with pgvector. Without it, only a subset of non-DB tests can run via `run-tests.sh`.
- **`~/.assistant-os/`** is the runtime home dir (souls, kernel.db, config). Created manually; not part of the repo.
- **`kernel.db`** (SQLite, at `~/.assistant-os/kernel.db`) is immutable per-call cost tracking. **`memory.db`** (SQLite, per-soul) holds RAG chunks/embeddings/graph.
- **Ollama is optional** — system degrades gracefully. With Ollama offline, embeddings fall back to `@xenova/transformers` locally, and the router skips the `local` tier.
- **No linter or formatter configured** — no eslint, prettier, or biome in the repo.
- **CLI shortcut:** `npm run os <args>` runs `node packages/cli/dist/index.js <args>`.
- **PM2 deployment:** `ecosystem.config.cjs` is the process config. It deliberately does NOT set env vars — they come from `~/.assistant-os/.env` loaded by `loadDotEnv()`.
- **`ASSISTENTE_OS_HOME`** env var overrides the default `~/.assistant-os` home directory.
- **Daemon binds `127.0.0.1` by default** — set `AOS_HOST` and `ASSISTENTE_OS_DAEMON_TOKEN` for remote access.
- **LangGraph integration** — `packages/memory/src/agent-workflow.ts` (StateGraph, runAgent, runAgentStream), `packages/daemon/src/langgraph-runner.ts` (runLangGraphAgent, runLangGraphAgentStream), `packages/daemon/src/orchestrator/router.ts` (routeFromPrompt, selectExecutionMode). Modes: fast/auto/pro.
- **LangGraph UI** — aba `tab-langgraph` em `packages/daemon/web/index.html` com SVG do grafo, step tracker, mode toggle (auto/fast/pro) no chat.
- **LangGraph tests** — unit: `packages/memory/src/test/agent-workflow.test.ts` (14), `packages/daemon/src/test/orchestrator-router.test.ts` (17). Integration (contra um daemon real rodando em `AOS_URL`/porta 4310, não entram no `npm test` — renomeadas para `.live.ts` de propósito pra não bater no glob `*.test.ts` e travar a suíte automatizada com chamadas reais ao Ollama/LangGraph): `packages/daemon/src/test/langgraph-rest-full.live.ts`, `packages/daemon/src/test/langgraph-stream.live.ts`, `packages/daemon/src/test/langgraph-tools-rest.live.ts`. Rode com `npm run test:live --workspace=@assistente-os/daemon` (requer `AOS_URL`/`AOS_TOKEN` apontando pro daemon). Shell: `packages/daemon/src/test/test-langgraph-stream.sh`.
- **LangGraph docs** — `docs/LANGGRAPH.md`, `docs/adr/ADR-AI-004.md`.

## Language

Code, comments, commit messages, and documentation are in **Brazilian Portuguese**. Maintain this convention.

## What NOT to do

- Do not add comments to code unless explicitly asked.
- Do not add linting/formatting tools without being asked.
- Do not commit `.env`, `*.db`, `dist/`, `node_modules/`, or `logs/` (all gitignored).
- Do not assume Docker is required — the app runs natively. Docker is only for Postgres and optional cloudflared tunnel.
