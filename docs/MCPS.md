# MCPs do Assistente OS

Servidores MCP configurados no `opencode.json` global (`~/.config/opencode/opencode.jsonc`).

## assistente-os (local)

Exposição do kernel via MCP sobre stdio (`packages/tools`). **54 tools**, todas
protegidas por Zero Trust (só disponíveis para uma soul se estiverem em
`DEFAULT_ALLOWED_TOOLS` ou no `agent.permissions.tools` do `config.json` da soul)
e classificadas por nível de risco L1/L2/L3 em `packages/core/src/policy.ts`.

A lista completa e categorizada vive no [README](../README.md#mcp-tools-54-tools)
(fonte da verdade). Resumo por família:

| Família | Tools |
|---|---|
| **Soul** | `souls_list`, `soul_context`, `soul_chat`, `soul_create` (L3, dry-run/commit por `plan_hash`), `soul_anotar`, `soul_licao`, `soul_decidir`, `soul_record_lesson`, `soul_get_lessons`, `soul_generate_aiia` |
| **Memória** | `memory_search`, `memory_index`, `memory_status` |
| **Grafo** | `graph_list`, `observation_add` |
| **Agenda** | `agenda_add`, `agenda_list` |
| **Custos/Infra** | `costs_summary`, `router_status`, `action_execute` |
| **Worktree** | `worktree_create`, `worktree_list`, `worktree_merge_locally` (L3), `worktree_destroy` (L3) |
| **Mission Runner (ORCA)** | `mission_list`, `mission_run` (L3) |
| **Guardian (golden rules)** | `guardian_audit_execution`, `guardian_promote_golden_rule`, `guardian_pending_rules`, `guardian_approve_rule`, `guardian_reject_rule`, `guardian_resend_approval_code`, `guardian_get_golden_rules` — `approve`/`reject` exigem o código de aprovação por Telegram |
| **Sales Intelligence** | `sales_ingest_meeting`, `sales_get_lead_brief` |
| **Spec Grill** | `spec_grill_plan` |
| **Azure DevOps** | `ado_list_projects`, `ado_list_repositories`, `ado_list_work_items`, `ado_create_work_item`, `ado_get_work_item`, `ado_update_work_item`, `ado_list_pipelines`, `ado_run_pipeline`, `ado_list_pull_requests`, `ado_create_pull_request` |
| **Browser** | `browser_navigate`, `browser_click`, `browser_extract_text`, `browser_screenshot`, `browser_close`, `browser_get_accessibility_tree`, `browser_execute_fix`, `browser_audited_screenshot` |

Config (`command` aponta para o `dist/` deste clone):
```jsonc
"assistente-os": {
  "type": "local",
  "command": ["node", "<path-do-clone>/packages/tools/dist/index.js"],
  "enabled": true
}
```

## stitch (remote, Google)

Design de UI (texto → componentes). Hosted MCP oficial da Google (`https://stitch.googleapis.com/mcp`).

> **Estado real (verificado 2026-08-18):** ao contrário do que este doc dizia antes, a config viva em `~/.config/opencode/opencode.jsonc` **não** usa OAuth — usa um bearer token estático (`headers.authorization: "bearer {env:stitch_access_token}"`). O valor de `STITCH_ACCESS_TOKEN`/`STITCH_PROJECT_ID` (expirado) foi removido de `~/.config/opencode/.env` nesta limpeza; a entrada `stitch` do opencode.jsonc ficará sem token até o OAuth de fato ser configurado — trocar para o bloco `oauth` abaixo quando isso acontecer.

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
