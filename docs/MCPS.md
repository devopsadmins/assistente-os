# MCPs do Assistente OS

Servidores MCP configurados no `opencode.json` global (`~/.config/opencode/opencode.jsonc`).

## assistente-os (local)

Exposição do kernel via MCP sobre stdio.

| Ferramenta | Descrição |
|---|---|
| `souls_list` | Lista as souls disponíveis |
| `soul_context` | Contexto de uma soul (perfil/contexto/licoes/pessoas/soul.md) |
| `soul_chat` | Roda `opencode run` headless na soul |
| `memory_search` | Busca RAG (semântica com Ollama; degrada para literal) |
| `memory_index` | Indexa a pasta da soul no memory.db (idempotente) |
| `memory_status` | Chunks e grafo da soul |
| `graph_list` | Entidades, relações e observações do grafo |
| `costs_summary` | Custo por soul e últimas chamadas |
| `router_status` | Degraus do roteador e config do Ollama |
| `observation_add` | Adiciona uma observação ao grafo da soul |
| `action_execute` | Registra e despacha uma ação de imediato (agenda + `opencode run` síncrono) |
| `soul_anotar` | Anota um item cronológico na sessão do dia da soul |
| `soul_licao` | Registra uma lição aprendida em `licoes.md` |
| `soul_decidir` | Grava uma decisão em formato ADR em `decisoes/` |
| `agenda_add` | Agenda uma tarefa para o daemon despachar (F2: imediata ou por `due_at`) |
| `agenda_list` | Lista itens da agenda por status (`pending`/`done`/`all`) |

Config:
```jsonc
"assistente-os": {
  "type": "local",
  "command": ["node", "D:/Projetos/assistente-os/packages/tools/dist/index.js"],
  "enabled": true
}
```

## stitch (remote, Google)

Design de UI (texto → componentes). Hosted MCP oficial da Google (`https://stitch.googleapis.com/mcp`).

> **Estado real (verificado 2026-08-18):** ao contrário do que este doc dizia antes, a config viva em `~/.config/opencode/opencode.jsonc` **não** usa OAuth — usa um bearer token estático (`headers.authorization: "bearer {env:stitch_access_token}"`). O valor de `STITCH_ACCESS_TOKEN`/`STITCH_PROJECT_ID` (expirado) foi removido de `~/.config/opencode/.env` nesta limpeza; a entrada `stitch` do opencode.jsonc ficará sem token até o OAuth de fato ser configurado (ver pendência "Completar OAuth dos MCPs Google" em `BACKLOG.md`) — trocar para o bloco `oauth` abaixo quando isso acontecer.

```jsonc
"stitch": {
  "type": "remote",
  "url": "https://stitch.googleapis.com/mcp",
  "enabled": true,
  "oauth": {
    "clientId": "{env:GOOGLE_MCP_CLIENT_ID}",
    "clientSecret": "{env:GOOGLE_MCP_CLIENT_SECRET}"
  }
}
```

O opencode faz o fluxo OAuth e renova o token automaticamente. Ferramentas (15+): `create_project`, `get_project`, `list_projects`, `list_screens`, `get_screen`, `generate_screen_from_text`, `edit_screens`, `generate_variants`, `create_design_system`, `apply_design_system`, `download_assets`, etc.

> **Histórico:** o setup anterior era um wrapper local (`scripts/stitch-mcp.mjs`) sobre o `StitchProxy` do `@google/stitch-sdk`, autenticando com um access token OAuth2 (`STITCH_ACCESS_TOKEN`, prefixo `ya29.`) lido de `~/.assistant-os/.env`. Esse token expira (sem refresh; `gcloud` não instalado para regenerar), causando `401`. Migrado para o hosted MCP em 2026-08-15.

## Remotos (globais do opencode)

- `cloudflare` (+ docs, bindings, builds, observability) — `mcp.cloudflare.com`
- `vercel` — `mcp.vercel.com`
- `azure-devops` — `npx @azure-devops/mcp`

## Providers Zen (multi-chave)

O opencode global registra 7 providers customizados de OpenCode Zen (`zen-sousa`, `zen-devocional`, `zen-iecsjc`, `zen-evertongame`, `zen-escritor`, `zen-iso`, `zen-avancei`), um por chave do SLC-OS. Cada um usa `@ai-sdk/openai-compatible` com `baseURL: https://opencode.ai/zen/v1` e a chave via `{env:ZEN_*_API_KEY}`.

| Provider | Chave (.env) | Origem SLC-OS |
|---|---|---|
| `zen-sousa` | `ZEN_SOUSA_API_KEY` | eolimabr |
| `zen-devocional` | `ZEN_DEVOCIONAL_API_KEY` | esolimabr |
| `zen-iecsjc` | `ZEN_IECSJC_API_KEY` | iecsjc |
| `zen-evertongame` | `ZEN_EVERTONGAME_API_KEY` | evertongame |
| `zen-escritor` | `ZEN_ESCRITOR_API_KEY` | escritor |
| `zen-iso` | `ZEN_ISO_API_KEY` | ISO |
| `zen-avancei` | `ZEN_AVANCEI_API_KEY` | Avancei |

Modelos free: `nemotron-3-ultra-free` (padrão), `deepseek-v4-flash-free`, `mimo-v2.5-free`, `hy3-free`, `nemotron-3.5-lightning-free`, `laguna-s-2.1-free`.

Uso: `opencode run --model zen-sousa/nemotron-3-ultra-free "..."` ou via `--model <provider>/<modelo>`.

> **Pendente:** mapear cada soul → provider (o "a quem pertence"). O provider nativo `opencode` (auth.json, chave iecsjc) continua servindo o degrau `zen` do roteador.

## Padrão

- Segredos **nunca** em `opencode.json`; usam `{env:VAR}` e ficam em `.env` fora do git.
- MCP local com comando direto (sem `npx -y` para pacotes locais) para arranque rápido.
