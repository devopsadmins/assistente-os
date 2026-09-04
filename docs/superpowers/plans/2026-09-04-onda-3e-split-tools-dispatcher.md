# Onda 3e — Split do God-Object `tools/index.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair as famílias de tools **mais autocontidas** de `packages/tools/src/index.ts` (2079 linhas, `switch` de 68 `case`s dentro da classe `McpServer`) pra módulos próprios — sem mudar nenhum comportamento observável do protocolo MCP. Fase 1: `guardian_*`, `ado_*`, `browser_*`, `worktree_*`+`mission_*` (as 4 famílias que o levantamento estrutural classificou como extração mais segura — juntas, ~470 das 1024 linhas do `switch`). O resto fica documentado como Fase 2 opcional.

**Architecture:** O `switch(name)` gigante vira uma tabela de dispatch (`Record<string, ToolHandler>`) consultada **antes** do `switch` — famílias migradas saem do `switch`, o resto continua lá intocado até ser migrado depois. Cada família ganha seu próprio arquivo em `packages/tools/src/<familia>/`, recebendo um `ToolContext` pequeno (`{ configHome, requireSoul, authorizeAgentSoul }`) em vez de fechar sobre `this` — assim os handlers extraídos são funções puras, testáveis sem instanciar `McpServer`.

**Tech Stack:** TypeScript, `node:test`. Mesma técnica de Onda 3e (chat.ts): mover verbatim, compilar, deixar o `tsc` apontar import faltando/sobrando.

**Spec:** `docs/ROADMAP.md` (item "Onda 3e"), relatório de análise estrutural desta sessão (2026-09-04).

## Global Constraints

- **Zero mudança de comportamento** no protocolo MCP — mesmas respostas de `tools/list`, mesmos erros de autorização, mesma ordem de checagem (`zeroTrustGate` sempre roda antes do handler, migrado ou não).
- `TOOLS` (array de schemas, linhas 100-823 hoje) e os `case` bodies estão na mesma ordem — ao mover um handler de família, mover **também** as entradas correspondentes de `TOOLS` pro mesmo arquivo, exportando as duas coisas juntas (schema + handler viajam juntos, não split por camada técnica).
- `handleMessage`, `handleToolCall`, `zeroTrustGate`, `requireSoul`, `authorizeAgentSoul` **ficam** em `index.ts`/`McpServer` — são a casca de orquestração, não fazem parte deste split.
- Build sempre antes de test: `npm run build --workspace=packages/tools` antes de `node --test dist/test/**/*.test.js`.
- `packages/tools/src/test/tools.test.ts` é a **única** rede de segurança automatizada pra este arquivo — cobre `souls_*`, `memory_search`, `agenda_*`, `spec_grill_plan`, `guardian_*`, `soul_generate_aiia`, `worktree_list`, `soul_create`, `mission_*`, `skill_*`, e o próprio gate Zero-Trust. **Não cobre `ado_*` nem `browser_*`** (confirmado no levantamento) — essas duas famílias precisam de smoke test novo antes de mover (mesma lógica do Task 4 do plano irmão de `chat.ts`).

---

## Contexto: estrutura atual (não repetir investigação)

`packages/tools/src/index.ts`, 2079 linhas. Blocos relevantes pra este plano:

| Range | O que é |
|---|---|
| 34-54 | `SOUL_SCOPED_TOOLS` (Set) — allowlist do gate Zero-Trust, referencia nomes de tool por string, não por família — **não precisa mudar** ao mover código de família (os nomes continuam os mesmos) |
| 71-88 | `authorizeTool(home, soulId, name)` — função de módulo, não método de classe, **fica em `index.ts`**, famílias extraídas importam ela normalmente |
| 100-823 | `TOOLS` (array de schemas) — mesma ordem dos `case`s abaixo |
| 871-877 | `this.config` carregado uma vez no construtor — handlers extraídos recebem via `ToolContext.config`, não recarregam |
| 962-997 | `zeroTrustGate` — fica em `index.ts`, roda antes de qualquer handler (migrado ou não) |
| 999-1009 | `requireSoul` (método) — famílias que usam `this.requireSoul` recebem via `ToolContext.requireSoul` |
| 1015-1023 | `authorizeAgentSoul` (método) — famílias que usam `this.authorizeAgentSoul` (não `requireSoul`+`authorizeTool`) recebem via `ToolContext.authorizeAgentSoul` |
| 1244-1301 | `case`s `guardian_*` (7 tools) — só precisa `configHome`, nenhum `requireSoul`/`authorizeTool`/`authorizeAgentSoul` |
| 1403-1710 | `case`s `ado_*` (10 tools, ~307 linhas — a maior família) — `this.requireSoul`+`authorizeTool` + `getAdoConnection(this.config)` (precisa do `config` **inteiro**, não só `home`) |
| 1710-1770 | `case`s `browser_*` (8 tools) — só `this.authorizeAgentSoul(name)`, nenhum acesso a `this.config` |
| 1772-1804 | `case`s `worktree_*` (4 tools) — mistura: 3 usam `this.requireSoul`+`authorizeTool`, `worktree_list` não usa nenhum |
| 1806-1808, 1877-1884 | `case`s `mission_*` (2 tools, **não contíguos** — `skill_*` fica entre eles) — `mission_list` sem auth, `mission_run` usa `this.authorizeAgentSoul` |

(Números de linha conferem com o estado do arquivo no momento do levantamento — **reconferir com grep antes de cada edição**, o arquivo pode ter mudado.)

---

### Task 1: Introduzir o `ToolContext` e a tabela de dispatch (sem mover nenhuma família ainda)

**Files:**
- Modify: `packages/tools/src/index.ts`
- Test: nenhum novo — `tools.test.ts` roda igual, é infraestrutura sem efeito observável ainda

**Interfaces:**
- Produces: `interface ToolContext { config: AssistenteOsConfig; requireSoul: McpServer["requireSoul"]; authorizeAgentSoul: McpServer["authorizeAgentSoul"]; }`, `type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>`, um `Record<string, ToolHandler>` vazio (`FAMILY_HANDLERS`) consultado no início de `executeTool`.

- [ ] **Step 1: Ler `executeTool` e `requireSoul`/`authorizeAgentSoul` completos antes de tocar em nada**

Run: `grep -n "executeTool(name\|private requireSoul\|private authorizeAgentSoul\|async executeTool" packages/tools/src/index.ts`

Confirmar as assinaturas exatas dos dois métodos (tipo de retorno de `requireSoul` — o relatório indica que devolve `{soul: Soul} | {error: string}`, reconferir).

- [ ] **Step 2: Adicionar o tipo `ToolContext`, `ToolHandler` e a tabela vazia, logo antes da classe `McpServer`**

```ts
export interface ToolContext {
  config: AssistenteOsConfig;
  requireSoul: (soulArg: unknown) => { soul: Soul } | { error: string };
  authorizeAgentSoul: (toolName: string) => void;
}

export type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

/** Populada pelos módulos de família migrados (Tasks 2-5). Consultada em executeTool antes do switch legado. */
export const FAMILY_HANDLERS: Record<string, ToolHandler> = {};
```

(ajustar os tipos exatos de `requireSoul`/`authorizeAgentSoul` conforme o Step 1 confirmar — não adivinhar a assinatura.)

- [ ] **Step 3: No início do corpo de `executeTool`, consultar a tabela antes do `switch`**

Logo depois de `zeroTrustGate` já ter rodado (não mudar essa ordem) e antes do `switch(name)`:

```ts
    const familyHandler = FAMILY_HANDLERS[name];
    if (familyHandler) {
      const ctx: ToolContext = {
        config: this.config,
        requireSoul: (soulArg) => this.requireSoul(soulArg),
        authorizeAgentSoul: (toolName) => this.authorizeAgentSoul(toolName),
      };
      return familyHandler(ctx, args);
    }

    switch (name) {
```

- [ ] **Step 4: Build**

Run: `npm run build --workspace=packages/tools`
Expected: limpo (a tabela está vazia, isso é só infraestrutura morta por enquanto).

- [ ] **Step 5: Rodar `tools.test.ts` inteiro**

Run: `node --test dist/test/tools.test.js`
Expected: PASS idêntico a antes — nenhum handler foi movido ainda, `FAMILY_HANDLERS` vazia nunca intercepta nada.

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/index.ts
git commit -m "refactor(tools): introduz ToolContext e tabela de dispatch (FAMILY_HANDLERS)

Infraestrutura pra migrar famílias de tools pra módulos próprios em tasks
seguintes — tabela vazia por enquanto, nenhum comportamento muda.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extrair `guardian_*` (a família mais simples — só precisa `configHome`)

**Files:**
- Create: `packages/tools/src/guardian/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `packages/tools/src/test/tools.test.ts` já cobre (linhas 414-485 do arquivo de teste, conforme levantamento) — nenhum teste novo necessário

**Interfaces:**
- Produces: `export const GUARDIAN_TOOLS: Tool[]` (schemas), `export const GUARDIAN_HANDLERS: Record<string, ToolHandler>` (7 entradas: `guardian_audit_execution`, `guardian_promote_golden_rule`, `guardian_pending_rules`, `guardian_approve_rule`, `guardian_reject_rule`, `guardian_resend_approval_code`, `guardian_get_golden_rules`)
- Consumes: `ToolContext`/`ToolHandler` de `../index.js` (do Task 1); `pendingRuleForAgent` (hoje função de módulo em `index.ts`, linhas 62-65 — mover **junto** com `guardian_*`, é só usada por essa família); `auditExecution`/`proposeRule`/`listPendingRules`/`approveRule`/`rejectRule`/`resendApprovalCode`/`listActiveGoldenRules` de `@assistente-os/core`

- [ ] **Step 1: Confirmar as linhas atuais dos 7 `case`s e de `pendingRuleForAgent`**

Run: `grep -n 'case "guardian_\|function pendingRuleForAgent' packages/tools/src/index.ts`

- [ ] **Step 2: Confirmar as 7 entradas correspondentes em `TOOLS`**

Run: `grep -n '"guardian_' packages/tools/src/index.ts | head -20`

(vai aparecer 2x cada nome — uma vez no array `TOOLS`, outra no `case` — confirmar os dois ranges antes de mover.)

- [ ] **Step 3: Criar `packages/tools/src/guardian/index.ts`, mover os 7 schemas + `pendingRuleForAgent` + os 7 `case` bodies (convertidos pra entradas do `Record`)**

```ts
import {
  auditExecution,
  proposeRule,
  listPendingRules,
  approveRule,
  rejectRule,
  resendApprovalCode,
  listActiveGoldenRules,
  type PendingRule,
} from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

/** Nunca expõe approvalCodeHash pro agente — o código só existe em claro na notificação Telegram. */
function pendingRuleForAgent(rule: PendingRule) {
  const { approvalCodeHash, ...rest } = rule;
  return rest;
}

export const GUARDIAN_TOOLS: Tool[] = [
  // ... colar aqui os 7 objetos de TOOLS confirmados no Step 2, verbatim ...
];

export const GUARDIAN_HANDLERS: Record<string, ToolHandler> = {
  guardian_audit_execution: async (ctx) => {
    // ... corpo colado verbatim do case original, trocando `this.config.home` por `ctx.config.home` ...
  },
  guardian_promote_golden_rule: async (ctx, args) => {
    // ...
  },
  guardian_pending_rules: async (ctx) => {
    // ...
  },
  guardian_approve_rule: async (ctx, args) => {
    // ...
  },
  guardian_reject_rule: async (ctx, args) => {
    // ...
  },
  guardian_resend_approval_code: async (ctx, args) => {
    // ...
  },
  guardian_get_golden_rules: async (ctx) => {
    // ...
  },
};
```

(o corpo de cada handler é o `case` original **verbatim**, só trocando `this.config.home`/`this.config` por `ctx.config.home`/`ctx.config` e removendo o `return { ok: true, ... }`/`break` do padrão de `switch` pelo `return { ok: true, ... }` direto de função — cada `case` já faz `return`, então a tradução é mecânica.)

- [ ] **Step 4: Em `index.ts`, remover os 7 `case`s e `pendingRuleForAgent`, remover as 7 entradas de `TOOLS`, popular `FAMILY_HANDLERS` e o array de schemas exportado**

```ts
import { GUARDIAN_TOOLS, GUARDIAN_HANDLERS } from "./guardian/index.js";

Object.assign(FAMILY_HANDLERS, GUARDIAN_HANDLERS);
```

E no lugar de onde `TOOLS` é montado/exportado, incluir `...GUARDIAN_TOOLS` na posição onde as 7 entradas removidas estavam (preserva a ordem do array pra quem depende de `tools/list` retornar numa ordem estável — checar se `tools.test.ts` afirma ordem exata antes de decidir onde inserir).

- [ ] **Step 5: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 6: Rodar `tools.test.ts` inteiro**

Run: `node --test dist/test/tools.test.js`
Expected: PASS idêntico — os testes de `guardian_*` (linhas 414-485 do arquivo de teste) continuam passando, batendo agora no handler extraído via `FAMILY_HANDLERS` em vez do `switch`.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/guardian/index.ts packages/tools/src/index.ts
git commit -m "refactor(tools): extrai guardian_* pra tools/src/guardian/

7 tools movidas verbatim pra FAMILY_HANDLERS — família mais simples de
extrair (só precisa config.home, nenhum requireSoul/authorizeAgentSoul).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extrair `browser_*` (só precisa `authorizeAgentSoul`, nenhum acesso a `config`)

**Files:**
- Create: `packages/tools/src/browser/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: **sem cobertura no dispatcher MCP hoje** (só via `daemon/src/test/browser.test.ts`, que testa as funções `@assistente-os/daemon` diretamente, não a camada MCP) — escrever smoke test antes de mover

**Interfaces:**
- Produces: `export const BROWSER_TOOLS: Tool[]`, `export const BROWSER_HANDLERS: Record<string, ToolHandler>` (8 entradas: `browser_navigate`, `browser_click`, `browser_extract_text`, `browser_screenshot`, `browser_close`, `browser_get_accessibility_tree`, `browser_execute_fix`, `browser_audited_screenshot`)
- Consumes: `ToolContext.authorizeAgentSoul` (não usa `ctx.config` nem `ctx.requireSoul`); as funções `browserNavigate` etc. de `@assistente-os/daemon`

- [ ] **Step 1: Escrever o smoke test primeiro**

Adicionar em `packages/tools/src/test/tools.test.ts` (seguir o padrão de setup já usado no arquivo pros outros testes):

```ts
test("browser_navigate: tools/list inclui a família browser_* (smoke — sem execução real de browser)", async () => {
  // Reusa o client/server já montado no describe/setup existente do arquivo.
  const res = await client.request({ method: "tools/list" }, ListToolsResultSchema);
  const names = res.tools.map((t) => t.name);
  for (const n of ["browser_navigate", "browser_click", "browser_extract_text", "browser_screenshot", "browser_close", "browser_get_accessibility_tree", "browser_execute_fix", "browser_audited_screenshot"]) {
    assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
  }
});
```

(ajustar pro padrão exato de setup/client que `tools.test.ts` já usa — ler o arquivo primeiro, não adivinhar a API do client de teste.)

- [ ] **Step 2: Build + rodar, confirmar que passa (baseline antes de mover)**

Run: `npm run build --workspace=packages/tools && node --test dist/test/tools.test.js`
Expected: PASS.

- [ ] **Step 3: Confirmar linhas atuais dos 8 `case`s de `browser_*`**

Run: `grep -n 'case "browser_' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/browser/index.ts`, mover os 8 schemas + 8 handlers**

```ts
import {
  browserNavigate,
  browserClick,
  browserExtractText,
  browserScreenshot,
  browserClose,
  browserGetAccessibilityTree,
  browserExecuteFix,
  browserAuditedScreenshot,
} from "@assistente-os/daemon";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const BROWSER_TOOLS: Tool[] = [
  // ... 8 objetos colados verbatim de TOOLS ...
];

export const BROWSER_HANDLERS: Record<string, ToolHandler> = {
  browser_navigate: async (ctx, args) => {
    ctx.authorizeAgentSoul("browser_navigate");
    // ... resto do corpo original verbatim ...
  },
  // ... as outras 7, mesmo padrão: ctx.authorizeAgentSoul(name) + corpo original ...
};
```

(confirmar os nomes exatos das funções importadas de `@assistente-os/daemon` lendo os `case`s originais primeiro — não adivinhar.)

- [ ] **Step 5: Em `index.ts`, remover os 8 `case`s, popular `FAMILY_HANDLERS`, incluir `BROWSER_TOOLS` no array exportado**

```ts
import { BROWSER_TOOLS, BROWSER_HANDLERS } from "./browser/index.js";

Object.assign(FAMILY_HANDLERS, BROWSER_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro (inclui o smoke novo do Step 1)**

Run: `node --test dist/test/tools.test.js`
Expected: PASS, incluindo o smoke test novo.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/browser/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai browser_* pra tools/src/browser/

8 tools movidas verbatim. Sem cobertura MCP-level antes desta task — soma
smoke test de tools/list (não substitui um teste funcional real, que exigiria
mockar Playwright — fora de escopo deste refactor estrutural).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Extrair `ado_*` (a maior família — precisa do `config` inteiro, não só `home`)

**Files:**
- Create: `packages/tools/src/ado/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: **sem cobertura no dispatcher MCP hoje** — escrever smoke test antes de mover (mesmo padrão do Task 3)

**Interfaces:**
- Produces: `export const ADO_TOOLS: Tool[]`, `export const ADO_HANDLERS: Record<string, ToolHandler>` (10 entradas: `ado_list_projects`, `ado_list_repositories`, `ado_list_work_items`, `ado_create_work_item`, `ado_get_work_item`, `ado_update_work_item`, `ado_list_pipelines`, `ado_run_pipeline`, `ado_list_pull_requests`, `ado_create_pull_request`)
- Consumes: `ToolContext.config` (inteiro — `getAdoConnection` precisa de `adoOrg`/`adoPat`/`adoAuthType`), `ToolContext.requireSoul`; `getAdoConnection` de `@assistente-os/core`; tipos de `azure-devops-node-api`

- [ ] **Step 1: Escrever o smoke test primeiro**

Mesmo padrão do Task 3 Step 1, mas checando os 10 nomes `ado_*` em `tools/list`.

- [ ] **Step 2: Build + rodar, confirmar baseline**

Run: `npm run build --workspace=packages/tools && node --test dist/test/tools.test.js`

- [ ] **Step 3: Confirmar linhas atuais dos 10 `case`s**

Run: `grep -n 'case "ado_' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/ado/index.ts`, mover os 10 schemas + 10 handlers + os imports de `azure-devops-node-api` que hoje ficam no topo de `index.ts` só por causa desta família**

```ts
import { getAdoConnection } from "@assistente-os/core";
// ... imports de azure-devops-node-api que os case bodies usam — mover
// pra cá do topo de index.ts, deixar o tsc apontar em index.ts o que ficou
// sem uso lá depois da remoção ...
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const ADO_TOOLS: Tool[] = [
  // ... 10 objetos colados verbatim ...
];

export const ADO_HANDLERS: Record<string, ToolHandler> = {
  ado_list_projects: async (ctx, args) => {
    const soulResult = ctx.requireSoul(args.soul);
    if ("error" in soulResult) throw new Error(soulResult.error);
    // authorizeTool precisa ser importado de "../index.js" também, ou
    // exportado de lá — confirmar no Step 3 se authorizeTool já é exportado;
    // se não for, exportar (`export function authorizeTool`) antes de usar aqui.
    authorizeTool(ctx.config.home, soulResult.soul.id, "ado_list_projects");
    const conn = await getAdoConnection(ctx.config);
    // ... resto do corpo original verbatim ...
  },
  // ... as outras 9, mesmo padrão ...
};
```

- [ ] **Step 5: Confirmar que `authorizeTool` é exportado de `index.ts` (famílias que usam `requireSoul`+`authorizeTool`, não `authorizeAgentSoul`, precisam importar essa função)**

Run: `grep -n "^function authorizeTool\|^export function authorizeTool" packages/tools/src/index.ts`

Se não tiver `export`, adicionar (`function authorizeTool` vira `export function authorizeTool`) — é uma função pura de módulo, exportar não muda comportamento nenhum, só visibilidade pros novos módulos de família.

- [ ] **Step 6: Em `index.ts`, remover os 10 `case`s, popular `FAMILY_HANDLERS`, incluir `ADO_TOOLS`, remover os imports de `azure-devops-node-api` que ficaram sem uso**

- [ ] **Step 7: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 8: Rodar `tools.test.ts` inteiro**

Run: `node --test dist/test/tools.test.js`
Expected: PASS, incluindo o smoke novo.

- [ ] **Step 9: Commit**

```bash
git add packages/tools/src/ado/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai ado_* pra tools/src/ado/

10 tools movidas verbatim (~307 linhas — a maior família do arquivo). Os
imports de azure-devops-node-api saem de index.ts também, junto com o código
que os usa. Sem cobertura MCP-level antes desta task — soma smoke test.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Extrair `worktree_*` + `mission_*` (não-contíguas no arquivo original — ok, viram um módulo só)

**Files:**
- Create: `packages/tools/src/worktree/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `worktree_list` já coberto em `tools.test.ts` (E5, linhas 513-533) — `worktree_create`/`worktree_merge_locally`/`worktree_destroy`/`mission_list` sem cobertura MCP-level, `mission_run` coberto (linhas 575-602)

**Interfaces:**
- Produces: `export const WORKTREE_TOOLS: Tool[]`, `export const WORKTREE_HANDLERS: Record<string, ToolHandler>` (6 entradas: `worktree_create`, `worktree_merge_locally`, `worktree_destroy`, `worktree_list`, `mission_list`, `mission_run`)

- [ ] **Step 1: Escrever smoke test pros 3 sem cobertura (`worktree_create`, `worktree_merge_locally`, `worktree_destroy`, `mission_list`)**

Mesmo padrão de `tools/list` do Task 3/4 — confirma presença na lista, não testa execução real (que exigiria um repo git de verdade / uma mission de verdade).

- [ ] **Step 2: Build + rodar, confirmar baseline**

Run: `npm run build --workspace=packages/tools && node --test dist/test/tools.test.js`

- [ ] **Step 3: Confirmar linhas atuais — lembrar que `mission_*` está separado de `worktree_*` no arquivo, com `skill_*` no meio**

Run: `grep -n 'case "worktree_\|case "mission_' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/worktree/index.ts`, mover os 6 schemas + 6 handlers (juntando as duas famílias num módulo só, já que a divisão original em 2 blocos não-contíguos no arquivo não precisa ser preservada)**

Seguir o mesmo padrão dos Tasks 2-4: `worktree_create`/`worktree_merge_locally`/`worktree_destroy` usam `ctx.requireSoul`+`authorizeTool`, `worktree_list` não usa nenhum, `mission_list` não usa nenhum, `mission_run` usa `ctx.authorizeAgentSoul`.

- [ ] **Step 5: Em `index.ts`, remover os 6 `case`s (nos seus 2 locais originais), popular `FAMILY_HANDLERS`, incluir `WORKTREE_TOOLS`**

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `node --test dist/test/tools.test.js`
Expected: PASS, incluindo os smokes novos.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/worktree/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai worktree_*+mission_* pra tools/src/worktree/

6 tools movidas verbatim, unificadas num módulo só (estavam em 2 blocos
não-contíguos no arquivo original, com skill_* entre eles).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificação final

**Files:** nenhum arquivo novo — só verificação

- [ ] **Step 1: Confirmar o tamanho final de `index.ts`**

Run: `wc -l packages/tools/src/index.ts`
Expected: redução de ~470+ linhas (as 4 famílias migradas) — de 2079 pra ~1600, ainda um god-object mas visivelmente menor, com um padrão de extração provado e replicável pras famílias que ficaram (Fase 2 opcional).

- [ ] **Step 2: Build completo do monorepo**

Run: `npm run build`
Expected: limpo em todos os workspaces (o pacote `tools` é consumido pela CLI/daemon via MCP stdio, não via import direto de símbolo — mas o build precisa passar mesmo assim).

- [ ] **Step 3: Suíte completa de `tools`**

Run: `npm test --workspace=packages/tools`
Expected: mesma contagem do baseline (Task 1 Step 5) + os smoke tests novos de `browser_*`/`ado_*`/`worktree_*`/`mission_*`.

- [ ] **Step 4: Atualizar `docs/ROADMAP.md`**

Marcar a metade "tools/index.ts" de "Onda 3e" como Fase 1 concluída (4 de ~15 famílias identificadas), com a lista abaixo documentada como Fase 2 opcional — não perdida, só não priorizada agora.

---

## Fora de escopo desta fase (Fase 2 candidata, famílias restantes)

Por ordem aproximada de facilidade de extração (mais fácil primeiro), seguindo o mesmo padrão `ToolContext`/`FAMILY_HANDLERS` já estabelecido:

- **`skill_*`** (`skill_list`, `skill_create` — 2 tools, já com boa cobertura de teste): precisa `configHome` + `getSoul` + várias funções de `scanSkillDirs`/`parseSkillFrontmatter`/etc.
- **`soul_create`** (1 tool, isolada, `soulSpecFromWire` — hoje função de módulo em `index.ts:824-853` — precisa viajar junto): usa `authorizeAgentSoul`.
- **`sales_*`** (`sales_ingest_meeting`, `sales_get_lead_brief` — 2 tools): usa `requireSoul`+`authorizeTool` + funções de `@assistente-os/daemon` + escrita de arquivo temporário.
- **`souls_*`** (`souls_list`, `soul_context`, `soul_chat` — 3 tools): usa `requireSoul`+`authorizeTool`+`runOpenCode`+`extractOpenCodeText` (esta última também é usada por `action_execute`, que não migra junto — vira uma dependência compartilhada, exportar de `index.ts` em vez de mover).
- **Família de journal da soul** (`soul_anotar`, `soul_licao`, `soul_decidir`, `soul_record_lesson`, `soul_get_lessons`, `soul_generate_aiia` — 6 tools, boa cobertura de teste): a mais trabalhosa das "fáceis" por ter 6 membros, mas todas seguem o mesmo padrão `requireSoul`+`authorizeTool`+escrita em disco.
- **`memory_*`/`graph_*`/`observation_*`** (5 tools): usa `getPool(ctx.config.databaseUrl)` + funções de `@assistente-os/memory` — `@assistente-os/tools` já importa de `@assistente-os/memory` hoje (checar se isso é aceitável pro módulo extraído ou se precisa de ajuste de dependência de pacote).
- **`spec_grill_plan`** (1 tool, ~46 linhas, a mais ramificada de todas — 2 fases internas): candidata a ficar pra depois das outras por complexidade interna, não por acoplamento externo.
- **`costs_summary`/`router_status`/`action_execute`/`agenda_*`**: pequenas, mas `action_execute` compartilha `extractOpenCodeText` com `soul_chat` (família `souls_*` acima) — migrar as duas juntas se/quando fizer esta fase.
- **`editorial_*`** (3 tools, `editorial_generate_drafts` é a maior `case` do arquivo inteiro, ~110 linhas, **zero cobertura de teste em qualquer nível**): precisa de smoke test (ou idealmente um teste funcional real, já que não existe nenhum) antes de mexer — maior risco da lista, deixar por último.

Cada uma dessas, quando for a vez, segue exatamente o mesmo procedimento das Tasks 2-5 deste plano: confirmar linhas com grep, escrever smoke test se não houver cobertura, mover verbatim, build guiado pelo compilador, rodar suíte, commit.
