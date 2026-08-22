# Plano de Implementação — FinOps Conciso + Spec Grill + /llms.txt

**Repositório:** assistente-os (npm workspaces, TypeScript ESM, NodeNext)
**Requisito de origem:** `docs/finops_grillme_headles.xml`
**Status:** Aprovado | **Data:** 2026-08-22

---

## 1. Sumário executivo

Três capacidades novas na filosofia Local-First (Markdown canônico, pgvector derivado,
degradação suave sem interromper o daemon):

| # | Capacidade | Pacotes |
|---|-----------|---------|
| 1 | Diretriz FinOps de output conciso no System Prompt de todas as souls | core, daemon |
| 2 | MCP Tool `spec_grill_plan` — refinamento de requisitos em duas fases | daemon, tools |
| 3 | Endpoint `GET /llms.txt` para ingestão headless por agentes externos | daemon |

## 2. Análise de conformidade com o XML

### 2.1 Hard rules já atendidas pelo código atual (sem trabalho novo)

| Regra do XML | Evidência no código |
|---|---|
| IDENTITY_SCOPED_TOOLS | `authorizeTool()` em `packages/tools/src/index.ts:54` |
| Auditoria ISO/IEC 42001 | `logFullAuditEntry()` em `packages/core/src/governance/audit-trail.ts:229` |
| MEMORY_CREDENTIAL_ISOLATION | `TempVault` + `purgeCredentials(taskId)` em `packages/core/src/security/temp-vault.ts` (não aplicável a este escopo: nenhuma credencial transita pelas features) |
| RECURSION_GUARD | `LANGGRAPH_MAX_ITERATIONS = 5` em `packages/core/src/graph/state-checkpoint.ts:31` |
| STDLIB_FIRST | Aderente: apenas `node:*`, sem dependências novas |

### 2.2 Gaps XML × código e decisões aprovadas pelo usuário

1. **`core/src/prompts/system-base.ts` não existe.** O gerador central real é
   `buildPrompt()` em `packages/daemon/src/context.ts:25` (usado por chat, events,
   voice e agenda). Decisão: criar o módulo em core e injetar via `context.ts`.
2. **Fluxo da tool em DUAS FASES** (aprovado): parâmetro opcional `answers[]`.
   Sem ele → Fase 1 gera+persiste perguntas (`status: pending`). Com ele → Fase 2
   valida ≥3 respostas, grava plano refinado e retorna `buildModeAuthorized: true`.
3. **`GET /llms.txt` protegido por Bearer token** (aprovado), consistente com todas
   as rotas exceto `/health`. Catálogo de tools é lista estática no handler
   (importar de packages/tools criaria dependência circular tools→daemon);
   souls dinâmicas via `listSouls(home)`.
4. **Diretriz concisa global incondicional** (aprovado): prefixo estável para todas
   as souls, sem flag de configuração.

## 3. Especificação detalhada

### Fase 1 — Diretriz FinOps (output conciso)

**Criar** `packages/core/src/prompts/system-base.ts`

```ts
export const CONCISE_OUTPUT_DIRECTIVE =
  "## Diretriz de Output (FinOps)\n" +
  "- Sem preâmbulos ('Claro!', 'Aqui está...') nem encerramentos genéricos.\n" +
  "- Resposta técnica direta: diffs concisos, listas acionáveis.\n" +
  "- Preserve a janela de contexto: nada de repetir o pedido do usuário.";
```

Re-exportar em `packages/core/src/index.ts`.

**Modificar** `packages/daemon/src/context.ts` (função `buildPrompt`):

- Injetar a diretriz como PRIMEIRO item do array `prefixParts`, sempre presente.
- Caso sem contexto (hoje: `fullPrompt = prompt` puro) também recebe o prefixo:
  `fullPrompt = CONCISE_OUTPUT_DIRECTIVE + "\n\n" + (prefixParts.join(...) || prompt)`.

### Fase 2 — MCP Tool `spec_grill_plan`

**Criar** `packages/daemon/src/orchestrator/spec-grill.ts`
(padronizado em `orchestrator/sales-intelligence.ts`):

```ts
export interface GrillQuestion {
  id: number;
  categoria: "regra-negocio" | "edge-case" | "dependencia-banco-api";
  pergunta: string;
}
export interface GrillPlanResult {
  ok: boolean;
  soulId: string;
  questions?: GrillQuestion[];
  buildModeAuthorized?: boolean;
  arquivo: string;
}
```

Comportamento:

- **Fase 1** `gerarPerguntasGrill(featureDraft): Promise<GrillQuestion[]>`
  - Extração via Ollama `POST {OLLAMA_URL}/api/chat` com modelo
    `OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free"`, AbortController 30s,
    saída JSON estrito com 3–5 perguntas categorizadas.
  - **Fallback heurístico determinístico** se Ollama offline ou JSON inválido
    (LOCAL_FIRST_RESILIENCE): template de 4 perguntas cobrindo regra de negócio,
    edge cases, schema de banco/API e critério de aceite.
- **Fase 1 persistência:** append em
  `~/.assistant-os/souls/<soulId>/contexto.md` de bloco delimitado:
  `<!-- spec-grill:<uuid> --> ## Spec Grill — <ISO date> (status: pending)` +
  featureDraft resumida + perguntas numeradas.
- **Fase 2** `finalizarPlanoGrill(soulDir, featureDraft, answers: string[])`:
  - Validação: `answers.length >= 3`; senão erro e bloco permanece `pending`.
  - Reescreve o bloco pending → `(status: authorized)` com o plano refinado
    (featureDraft + perguntas + respostas validadas) e data de autorização.
  - Retorna `{ buildModeAuthorized: true }`.

**Modificar** `packages/daemon/src/index.ts`: exportar as duas funções pelo barrel.

### Fase 3 — Endpoint GET /llms.txt

**Criar** `packages/daemon/src/routes/llms-txt.ts` (padrão RouteHandler de
`routes/shared.ts`, como `routes/infra.ts`):

- Aceita apenas `GET /llms.txt`; demais métodos/caminhos → `return false`.
- Resposta `200` com `Content-Type: text/markdown; charset=utf-8`.
- Corpo Markdown com seções:

  1. Visão geral do sistema;
  2. Rotas ativas (lista estática documentada);
  3. Catálogo MCP Tools (nome + descrição, lista estática);
  4. Souls registradas — dinâmico via `listSouls(home)`;
  5. Nota de autenticação (Bearer ASSISTENTE_OS_DAEMON_TOKEN exceto /health).

- SEM exceção no middleware Bearer de `server.ts` → protegida por token.

**Modificar** `packages/daemon/src/server.ts`: importar `handleLlmsTxt` e registrar
no array `ROUTE_HANDLERS`.

### Fase 4 — Registro da tool em packages/tools

**Modificar** `packages/tools/src/index.ts`:

1. Schema em `TOOLS`: `{ soul*, featureDraft*, answers?: string[] }`.
2. Adicionar `"spec_grill_plan"` ao set `SOUL_SCOPED_TOOLS`.
3. Case no `executeTool()`: `requireSoul` → `authorizeTool` → Fase 1 ou 2 conforme
   presença de `answers` → `logFullAuditEntry` de sucesso (norma ISO/IEC 42001).

## 4. Plano de testes (node --test, rodando de dist/, build primeiro)

**Criar** `packages/daemon/src/test/spec-grill.test.ts` (sem PostgreSQL):

- Fallback offline (OLLAMA_URL apontando p/ porta morta) gera 3–5 perguntas categorizadas.
- Fase 1 persiste bloco `pending` em contexto.md (tmpdir).
- Fase 2 com <3 respostas falha e mantém `pending`.
- Fase 2 completa reescreve p/ `authorized` e retorna buildModeAuthorized=true.

**Modificar** `packages/daemon/src/test/daemon.test.ts`:

- Novo caso: startDaemon port 0 → `GET /llms.txt` → 200, content-type markdown,
  corpo contém "main" (soul) e seção de rotas; sem token configurado (loopback).

**Modificar** `packages/tools/src/test/tools.test.ts`:

- `tools/list` inclui `spec_grill_plan`.
- Fluxo completo duas fases via `handleMessage` (tools/call).
- Soul inexistente → erro JSON-RPC.

**Prefixo FinOps:** assert chamando `buildPrompt(..., withRag=false)` verificando
que `fullPrompt.startsWith(CONCISE_OUTPUT_DIRECTIVE)`.

## 5. Verificação final (ordem obrigatória)

```bash
npm run build --workspaces   # 0 erros de tipagem
npm test --workspaces       # suítes verdes (requer PostgreSQL/pgvector ativo)
```

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Ollama indisponível na Fase 1 do grill | Fallback heurístico determinístico (testado sem rede) |
| Corrupção de contexto.md em escrita concorrente | Blocos delimitados por comentários HTML com id único; read-modify-write síncrono |
| Dependência circular tools ↔ daemon | Catálogo de tools é lista estática no handler /llms.txt |
| Regressão no prompt das souls existentes | Diretriz é prefixo aditivo (~90 chars); asserts existentes usam `includes` e continuam válidos |

## 7. Ordem de execução

1. Gravar este plano em docs/ (passo 0 — concluído)
2. Fase 1 (system-base.ts + context.ts)
3. Fase 2 (spec-grill.ts + exports)
4. Fase 4 (registro da tool)
5. Fase 3 (/llms.txt + ROUTE_HANDLERS)
6. Fase 5 (todos os testes)
7. Verificação final + relatório de diffs
