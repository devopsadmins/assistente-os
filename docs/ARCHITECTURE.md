# Arquitetura do Assistente OS

Copiloto residente em Node/TS, API-first, local-first. Monorepo npm workspaces, sem Docker, sem dependências nativas (`node:sqlite` do Node 26+).

## Visão geral

```
┌─────────────────────────────────────────────────────────────┐
│ opencode (eu)                                               │
│   ├─ MCP assistente-os  ──── packages/tools (stdio)        │
│   └─ MCP stitch  ──────── hosted stitch.googleapis.com     │
│   └─ providers zen-*  ──── 7 chaves OpenCode Zen (global)  │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│ packages/daemon (REST + WebSocket, porta 4310)              │
│   GET  /health, /souls, /souls/:id, /souls/:id/context      │
│   POST /souls/:id/chat    -> runOpenCode (opencode run)     │
│   GET  /costs, /router/status                               │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│ packages/core            packages/memory                    │
│  ~/.assistant-os/          memory.db (SQLite)               │
│  ├─ souls/<id>/...          ├─ chunks (índice RAG)          │
│  ├─ kernel.db               ├─ entities/relations           │
│  ├─ active.json             └─ observations (grafo)         │
│  └─ config.local.json                                      │
└─────────────────────────────────────────────────────────────┘
```

## Camadas

### packages/core — kernel

- **config.ts** — home resolvido de `ASSISTENTE_OS_HOME` (padrão `~/.assistant-os`); `.env` carregado da home; roteador `local -> zen -> soul`.
- **souls.ts** — souls como pastas com `config.json` + `perfil/contexto/licoes/pessoas/soul.md`; soul ativa em `active.json`.
- **kernelDb.ts** — `kernel.db`: `cost_calls` (custo imutável por chamada), `router_history` (decisões do roteador), `agenda` (agendador, F2).
- **costs.ts** — resumo de custo por soul e últimas chamadas.
- **router.ts** — roteador local-first em degraus (`local`, `zen`, `soul`).
- **migration.ts** — migra as almas do SLC-OS: `perfil/contexto/licoes/pessoas/soul.md` no topo; `sessoes/` e `conhecimento/` no topo preservando árvore; o resto vai para `sources/<dir>/`; ignora `config.json`, `*.local.json`, `.env*`, `node_modules`, `__pycache__`, `.git`.

### packages/memory — RAG + grafo

- **memoryDb.ts** — `memory.db` (SQLite nativo): `chunks`, `entities`, `relations`, `observations`.
- **embedders.ts** — `OllamaEmbedder` (cosseno em JS, timeout 4s), `LiteralEmbedder` (fallback ILIKE), `cosine`.
- **indexer.ts** — chunking de markdown/texto, indexação idempotente (UNIQUE soul+doc_key), busca vetorial→literal.
- **graph.ts** — upsert de entidades/relações, observações com timestamp.

### packages/daemon — API-first

- **server.ts** — HTTP + `WsHub` (WebSocket manual, sem dependências) sobre `node:http`/`node:crypto`.
- **runner.ts** — `runOpenCode` spawna `opencode run --format json --print-logs` headless:
  - Windows: resolve o `.exe` real (`%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`), `shell:false`, `stdio:["ignore","pipe","pipe"]` (stdin fechado — evita o processo ficar vivo esperando input).
  - Transmite stdout/stderr em tempo real e corta no timeout.

### packages/tools — MCP

Servidor MCP mínimo (JSON-RPC 2.0 sobre stdio): `initialize`, `tools/list`, `tools/call`. Ferramentas: `souls_list`, `soul_context`, `soul_chat`, `memory_search`, `memory_index`, `memory_status`, `graph_list`, `costs_summary`, `router_status`, `observation_add`, `action_execute`, `soul_anotar`, `soul_licao`, `soul_decidir`, `agenda_add`, `agenda_list` (lista completa e descrições em `docs/MCPS.md`).

### packages/cli — comando `os`

`status`, `souls`, `soul <id> [ativa]`, `chat <soul> <prompt>`, `migrate <src>`, `memory <soul> index|search|status`, `graph <soul> list`, `costs`, `agenda add|list`, `daemon [port]`, `voice`, `backup`, `help`.

## Roteamento local-first

Degraus: **local** (Ollama) → **zen** (provedor customizado) → **soul** (opencode). A decisão é registrada em `router_history`; o custo de cada chamada fica em `cost_calls` e é imutável.

O chat interativo (`POST /souls/:id/chat` e o `onChat` da voz) usa `route()` com uma sonda barata e segura de repetir (`GET /api/tags` no Ollama, sem rodar inferência) para escolher o degrau: se `local` não responder, cai para `zen` automaticamente. `zen`/`soul` não têm sonda equivalente pelo daemon (dependem do provider configurado no opencode.json) e são assumidos disponíveis; falhas neles só aparecem na execução real, que acontece uma única vez, no degrau vencedor.

### Multi-Zen (7 chaves)

O `opencode.json` global registra 7 providers customizados de OpenCode Zen (`zen-sousa`, `zen-devocional`, `zen-iecsjc`, `zen-evertongame`, `zen-escritor`, `zen-iso`, `zen-avancei`), um por chave do SLC-OS, via `@ai-sdk/openai-compatible` com `baseURL: https://opencode.ai/zen/v1`. As chaves ficam em `~/.config/opencode/.env` (config global do opencode, não `~/.assistant-os/.env`) como `ZEN_*_API_KEY` e são injetadas por `{env:...}`. Modelo padrão: `nemotron-3-ultra-free`. O provider nativo `opencode` (auth.json, chave iecsjc) continua servindo o degrau `zen`. O mapeamento soul→provider (o "a quem pertence") está pendente.

### Stitch MCP (hosted, credencial pendente)

O hosted MCP oficial (`https://stitch.googleapis.com/mcp`) está registrado no `opencode.json` global como remoto. **Correção (2026-08-18):** ao contrário do que este doc afirmava, a entrada ainda não usa OAuth de verdade — usa um bearer token estático (`headers.authorization: "bearer {env:stitch_access_token}"`). O token antigo (expirado) foi removido de `~/.config/opencode/.env` na limpeza de credenciais; a entrada fica sem credencial até o fluxo OAuth (`GOOGLE_MCP_CLIENT_ID`/`GOOGLE_MCP_CLIENT_SECRET`, mesmo client de gmail/drive/docs) ser de fato configurado — ver `docs/MCPS.md` e a pendência "Completar OAuth dos MCPs Google" em `docs/BACKLOG.md`.

> **Histórico:** o setup anterior usava o wrapper `scripts/stitch-mcp.mjs` (removido nesta limpeza) sobre o `StitchProxy` do `@google/stitch-sdk` (o pacote `@google/stitch-mcp` não existe no npm público), autenticando com o mesmo access token OAuth2 (`STITCH_ACCESS_TOKEN`) que hoje foi removido de `~/.config/opencode/.env`. O token expirava sem renovação → `401`.

## Estado atual (Fases 1-3 concluídas)

- 12 souls migradas (~770 arquivos) em `~/.assistant-os/souls/`.
- Daemon REST+WS validado com `opencode run` real no Windows.
- RAG indexado (ex.: soul `main` com 2618 chunks / 154 arquivos) com degradação literal quando o Ollama está ausente.
- MCP `assistente-os` registrado no `opencode.json` global, com 16 ferramentas (busca/memória/ação/agenda).
- Agendador (F2): tabela `agenda` com claim/finish, loop de despacho no daemon a cada 30s + disparo imediato, REST `/agenda`, CLI `os agenda`, MCP `agenda_add`/`agenda_list`.

## Próxima fase

- **F4** — hosting + Stitch MCP em produção.
