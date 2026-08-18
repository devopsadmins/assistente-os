# Assistente OS

Copiloto residente em Node/TS, API-first, local-first, inspirado no SLC-OS. Monorepo npm workspaces, zero dependências nativas (`node:sqlite` do Node 26+), sem Docker.

## Requisitos

- Node.js ≥ 22.5 (`node:sqlite`)
- (opcional) Ollama local para busca semântica e degrau `local`

## Rápido início

```bash
npm install
npm run build

# CLI
npm run os status
npm run os souls

# migrar almas do SLC-OS (se ainda não migradas)
npm run os migrate D:/Projetos/SLC-OS/almas

# indexar a memória de uma soul
npm run os memory main index
npm run os memory main search "assuntos recentes"

# daemon REST+WS
npm run os daemon
```

O daemon escuta apenas em `127.0.0.1` por padrão. Para expô-lo na rede, defina
`AOS_HOST` e um `ASSISTENTE_OS_DAEMON_TOKEN`; envie-o em `Authorization: Bearer <token>`.

## Pacotes

| Pacote | Papel |
|---|---|
| `packages/core` | kernel: config, souls, kernel.db, custos, roteador local-first, migração |
| `packages/memory` | RAG (chunks + embeddings) e grafo (entidades/relações/observações) em SQLite |
| `packages/daemon` | API REST + WebSocket; executa `opencode run` headless |
| `packages/tools` | servidor MCP (stdio) expondo o kernel ao opencode |
| `packages/cli` | comando `os` (status, souls, chat, memory, migrate, costs, agenda, daemon) |
| `packages/voice` | pipeline de voz (VAD + STT Whisper + TTS) |

## Testes

```bash
npm test          # todos os workspaces
npm run typecheck # tsc em todos os workspaces
```

## Docs

- [Arquitetura](docs/ARCHITECTURE.md)
- [MCPs](docs/MCPS.md)

## Estado

Fases 1-3 concluídas: núcleo/memória/migração/daemon/CLI/MCP (F1), agendador (F2), ferramentas do agente — busca/memória/ação/agenda via MCP (F3). Pendente: F4 (hosting + Stitch MCP em produção).
