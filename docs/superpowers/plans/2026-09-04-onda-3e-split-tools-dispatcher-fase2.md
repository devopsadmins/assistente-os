# Onda 3e — Split do God-Object `tools/index.ts` (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar as ~9 famílias de tools restantes de `packages/tools/src/index.ts` (1262 linhas hoje, depois da Fase 1) pro padrão `ToolContext`/`FAMILY_HANDLERS` já estabelecido e validado (`guardian_*`, `browser_*`, `ado_*`, `worktree_*`+`mission_*`) — sem mudar nenhum comportamento observável do protocolo MCP. Ao final, `index.ts` deve conter só a casca de orquestração (`McpServer`, `handleMessage`, `handleToolCall`, `zeroTrustGate`, `requireSoul`, `authorizeAgentSoul`, `authorizeTool`, `SOUL_SCOPED_TOOLS`, `Tool`/`ToolContext`/`ToolHandler`/`FAMILY_HANDLERS`) e nenhum `case` de tool.

**Architecture:** Mesmo padrão da Fase 1 — cada família ganha um arquivo em `packages/tools/src/<familia>/index.ts` exportando `<FAMILIA>_TOOLS: Tool[]` (schemas) e `<FAMILIA>_HANDLERS: Record<string, ToolHandler>` (handlers), populado em `FAMILY_HANDLERS` via `Object.assign` em `index.ts`. Duas correções de escopo em relação à Fase 1: (1) `souls_*` e `action_execute` migram **juntos** num módulo só (`packages/tools/src/souls/`) porque compartilham o helper privado `extractOpenCodeText` — a Fase 1 tinha previsto "migrar separado, exportar o helper de index.ts", mas migrar as duas famílias juntas é mais simples e evita manter um helper exportado só pra uso interno entre dois módulos; (2) a família `costs_summary`/`router_status`/`agenda_*` perde o `action_execute` (que foi pro grupo acima) e vira só essas 4 tools pequenas sem dependência externa.

**Tech Stack:** TypeScript, `node:test`. Mesma técnica das Fases 1: mover verbatim, compilar, deixar o `tsc` apontar import faltando/sobrando (lembrete da Fase 1: este repo **não tem** `noUnusedLocals`/lint, então "sobrando" nunca aparece como erro de build — a limpeza de imports é sempre manual via grep, task por task).

**Spec:** `docs/ROADMAP.md` (item "Onda 3e"), `docs/superpowers/plans/2026-09-04-onda-3e-split-tools-dispatcher.md` (Fase 1 — já concluída, este plano é a continuação dela e reusa toda a infraestrutura que ela criou).

## Global Constraints

- **Zero mudança de comportamento** no protocolo MCP — mesmas respostas de `tools/list` (schemas e **ordem** — a Fase 1 teve um achado real de revisão final por reordenar um spread; toda task deste plano precisa inserir seu spread na posição do **primeiro** tool removido daquela família, preservando a ordem relativa de tudo o mais), mesmos erros de autorização, mesma ordem de checagem (`zeroTrustGate` sempre roda antes do handler).
- `TOOLS` (array de schemas) e os `case` bodies viajam juntos, na mesma ordem — schema + handler no mesmo arquivo de família.
- `handleMessage`, `handleToolCall`, `zeroTrustGate`, `requireSoul`, `authorizeAgentSoul`, `authorizeTool`, `SOUL_SCOPED_TOOLS`, `Tool`, `ToolContext`, `ToolHandler`, `FAMILY_HANDLERS` **ficam em `index.ts`** — não migram (já existem lá desde a Fase 1, nenhuma task deste plano os toca exceto pra adicionar imports/`Object.assign`).
- Build sempre antes de test: `npm run build --workspace=packages/tools` antes de `node --test dist/test/tools.test.js` (ou `npm test --workspace=packages/tools`, equivalente).
- Cada task reconfirma seus números de linha via `grep` antes de editar — cada task anterior desloca o arquivo, os números abaixo são **do estado no momento em que este plano foi escrito** (2026-09-04, depois do commit `d72470c` que fechou a Fase 1), não confiar neles cegamente.
- **Preservar padrões estruturais estranhos que já existem** (não "consertar" durante o move): `editorial_*` usa `import("node:fs/promises")` dinâmico repetido dentro do handler em vez de import estático no topo — é feio, mas é comportamento existente; mover verbatim, não refatorar.
- Imports órfãos pré-existentes (não causados por nenhuma task deste plano, confirmados via grep no commit-base `d72470c`): `setupEnvironment` (de `@assistente-os/daemon`), `search`, `LiteralEmbedder`, `relevancia` (de `@assistente-os/memory`), `listSkills` (de `@assistente-os/core`) — nenhum tem uso em `index.ts` hoje. Não são causados por nenhuma família específica (não pertencem a nenhum `case`), então nenhuma task individual deve removê-los — isso fica pra Task 10 (verificação final), que faz uma varredura única depois que todas as famílias já saíram, evitando a assimetria que a revisão final da Fase 1 apontou (um dev removeu um órfão e deixou outro por "não ser desta task").

---

## Contexto: estrutura atual (não repetir investigação)

`packages/tools/src/index.ts`, 1262 linhas (depois da Fase 1, commit `d72470c`). Os `case`s que restam, na ordem em que aparecem no arquivo:

| Linha (grep em 2026-09-04) | `case` | Família |
|---|---|---|
| 686 | `souls_list` | souls_* (Task 4) |
| 690 | `soul_context` | souls_* (Task 4) |
| 703 | `soul_chat` | souls_* (Task 4) |
| 717 | `memory_search` | memory (Task 6) |
| 735 | `memory_index` | memory (Task 6) |
| 744 | `memory_status` | memory (Task 6) |
| 752 | `graph_list` | memory (Task 6) |
| 764 | `costs_summary` | misc (Task 8) |
| 771 | `router_status` | misc (Task 8) |
| 774 | `observation_add` | memory (Task 6) |
| 788 | `action_execute` | souls_* (Task 4) — compartilha `extractOpenCodeText` com `soul_chat` |
| 822 | `soul_anotar` | journal (Task 5) |
| 833 | `soul_licao` | journal (Task 5) |
| 844 | `soul_decidir` | journal (Task 5) |
| 865 | `soul_record_lesson` | journal (Task 5) |
| 881 | `soul_get_lessons` | journal (Task 5) |
| 890 | `soul_generate_aiia` | journal (Task 5) |
| 903 | `sales_ingest_meeting` | sales (Task 3) |
| 922 | `sales_get_lead_brief` | sales (Task 3) |
| 932 | `spec_grill_plan` | specGrill (Task 7) |
| 979 | `agenda_add` | misc (Task 8) |
| 991 | `agenda_list` | misc (Task 8) |
| 1002 | `skill_list` | skill (Task 1) |
| 1026 | `skill_create` | skill (Task 1) |
| 1069 | `soul_create` | soulCreate (Task 2) |
| 1113 | `editorial_add_idea` | editorial (Task 9) |
| 1137 | `editorial_get_pipeline_status` | editorial (Task 9) |
| 1184 | `editorial_generate_drafts` | editorial (Task 9) |

Ordem das tasks: da mais simples/testada pra mais arriscada/sem cobertura, mesmo critério da Fase 1 (`skill_*` primeiro, `editorial_*` por último). A ordem de execução **não precisa** bater com a ordem de aparição no arquivo — cada task remove seus `case`s de onde estiverem e insere o spread na posição correta, independente de quando outras famílias ainda-não-migradas ficam pelo caminho.

Helpers de módulo (funções privadas, não-exportadas de `index.ts`) que viajam com sua família:
- `soulSpecFromWire` (linha ~442-470) → só usada por `soul_create` → migra inteira pra Task 2, não-exportada do módulo novo (uso só interno).
- `extractOpenCodeText` (linha ~477-487) → usada por `soul_chat` E `action_execute` → migra inteira pra Task 4 (módulo `souls`), não-exportada do módulo novo.
- `relevanceRule` (linha ~20-23, **hoje exportada de `index.ts`**) → usada só por `memory_search` internamente; nenhum outro pacote importa `relevanceRule` de `@assistente-os/tools` (confirmado via grep no monorepo — o `daemon` tem seu próprio `relevanceRule` em `packages/daemon/src/relevance.ts`, arquivo diferente, sem relação) → migra pra Task 6 (módulo `memory`), **para de ser exportada de `index.ts`**.

`SOUL_SCOPED_TOOLS` (Set em `index.ts`, não precisa mudar — allowlist por nome de string, funciona igual não importa onde o handler more).

---

### Task 1: Extrair `skill_*` (2 tools, já com boa cobertura de teste)

**Files:**
- Create: `packages/tools/src/skill/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `packages/tools/src/test/tools.test.ts` já cobre (`skill_list`/`skill_create` testados em ~linhas 605-650, mais o teste de path-traversal ~linha 750-765) — nenhum teste novo necessário

**Interfaces:**
- Produces: `export const SKILL_TOOLS: Tool[]`, `export const SKILL_HANDLERS: Record<string, ToolHandler>` (2 entradas: `skill_list`, `skill_create`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `getSoul`, `isValidSoulId`, `scanSkillDirs`, `parseSkillFrontmatter`, `writeSkillFile`, `buildSkillMd`, `canonicalJsonStringify`, `type SkillFrontmatter` de `@assistente-os/core`

- [ ] **Step 1: Confirmar linhas atuais dos 2 `case`s e das 2 entradas em `TOOLS`**

Run: `grep -n 'case "skill_\|name: "skill_' packages/tools/src/index.ts`

- [ ] **Step 2: Criar `packages/tools/src/skill/index.ts`**

```ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getSoul, isValidSoulId, scanSkillDirs, parseSkillFrontmatter, writeSkillFile, buildSkillMd, canonicalJsonStringify, type SkillFrontmatter } from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const SKILL_TOOLS: Tool[] = [
  {
    name: "skill_list",
    description:
      "Lista as skills visíveis para uma soul (SKILL.md global ou per-soul), com escopo, tools advisórias e se está na allowlist (`agent.permissions.skills`).",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul (default: AGENT_SOUL_ID ou 'main')" } },
    },
  },
  {
    name: "skill_create",
    description:
      "Cria uma skill (SKILL.md). dry_run=true (default) valida o frontmatter e devolve plan_hash sem escrever; " +
      "dry_run=false exige o plan_hash. scope 'soul' (default) grava na pasta da soul; 'global' no diretório compartilhado. Efeito estrutural (L3).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "slug da skill (a-z, 0-9, hífen; 2-64 chars)" },
        description: { type: "string", description: "1 linha (≤280) — é o que o matcher usa" },
        body: { type: "string", description: "corpo markdown com as instruções" },
        keywords: { type: "string", description: "CSV de gatilhos léxicos explícitos (frases OK)" },
        tools: { type: "string", description: "CSV de tools MCP relevantes (advisório — não eleva a allowlist)" },
        scope: { type: "string", description: "soul | global (default: soul)" },
        soul: { type: "string", description: "id da soul quando scope=soul (default: AGENT_SOUL_ID)" },
        dry_run: { type: "boolean", description: "default true — só valida e devolve plan_hash" },
        plan_hash: { type: "string", description: "obrigatório quando dry_run=false" },
      },
      required: ["name", "description", "body"],
    },
  },
];

export const SKILL_HANDLERS: Record<string, ToolHandler> = {
  skill_list: async (ctx, args) => {
    const soulId =
      (typeof args.soul === "string" && args.soul.trim()) || process.env.AGENT_SOUL_ID || "main";
    if (!isValidSoulId(soulId)) throw new Error(`skill_list: soul inválida: ${soulId}`);
    const soul = getSoul(ctx.config.home, soulId);
    const allow = new Set(soul?.config.agent?.permissions?.skills ?? []);
    const discovered = scanSkillDirs(ctx.config.home, soulId);
    const skills = discovered.map((d) => {
      let description = "";
      let tools: string[] = [];
      try {
        const p = parseSkillFrontmatter(readFileSync(d.path, "utf8"));
        if (p.ok) {
          description = p.frontmatter.description;
          tools = p.frontmatter.tools;
        }
      } catch {
        /* arquivo ilegível — mantém description vazia */
      }
      return { name: d.name, description, scope: d.scope, tools, inAllowlist: allow.has(d.name) };
    });
    return { soul: soulId, skills };
  },

  skill_create: async (ctx, args) => {
    ctx.authorizeAgentSoul("skill_create"); // efeito estrutural: L3
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const csv = (v: unknown): string[] =>
      str(v) ? str(v).split(",").map((x) => x.trim()).filter(Boolean) : [];
    const scope = str(args.scope) === "global" ? "global" : "soul";
    const soulId = str(args.soul) || process.env.AGENT_SOUL_ID || "main";
    if (scope === "soul" && !isValidSoulId(soulId)) throw new Error(`skill_create: soul inválida: ${soulId}`);
    const fm: SkillFrontmatter = {
      name: str(args.name),
      description: str(args.description),
      keywords: csv(args.keywords),
      tools: csv(args.tools),
    };
    const body = typeof args.body === "string" ? args.body : "";
    const md = buildSkillMd(fm, body);
    const parsed = parseSkillFrontmatter(md);
    const planHash = createHash("sha256")
      .update(canonicalJsonStringify({ fm, body, scope, soulId }))
      .digest("hex");
    const dryRun = args.dry_run !== false;
    const targetPath =
      scope === "soul"
        ? `souls/${soulId}/skills/${fm.name}/SKILL.md`
        : `skills/${fm.name}/SKILL.md`;
    if (dryRun) {
      return {
        dry_run: true,
        ok: parsed.ok,
        plan_hash: planHash,
        issues: parsed.ok ? [] : parsed.issues,
        would_write: targetPath,
      };
    }
    if (!parsed.ok) throw new Error(`skill_create: frontmatter inválido — ${parsed.issues.join("; ")}`);
    if (str(args.plan_hash) !== planHash) {
      throw new Error(`skill_create: plan_hash divergente (esperado ${planHash}). Rode dry_run novamente.`);
    }
    const r = writeSkillFile(ctx.config.home, scope, scope === "soul" ? soulId : undefined, fm, body);
    if (!r.ok) throw new Error(`skill_create: ${r.code} — ${r.reason}`);
    return { dry_run: false, created: true, path: r.path, plan_hash: planHash };
  },
};
```

(reconfirme o corpo exato de cada handler contra o `case` atual antes de colar — o snippet acima é fiel ao estado do arquivo no momento em que este plano foi escrito, mas o arquivo pode ter mudado.)

- [ ] **Step 3: Em `index.ts`, remover os 2 `case`s, as 2 entradas de `TOOLS` (inserir `...SKILL_TOOLS` na posição onde `skill_list` estava), popular `FAMILY_HANDLERS`**

```ts
import { SKILL_TOOLS, SKILL_HANDLERS } from "./skill/index.js";

Object.assign(FAMILY_HANDLERS, SKILL_HANDLERS);
```

- [ ] **Step 4: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 5: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, mesma contagem de antes (33 — baseline da Fase 1).

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/skill/index.ts packages/tools/src/index.ts
git commit -m "refactor(tools): extrai skill_* pra tools/src/skill/ (Onda 3e Fase 2)

2 tools movidas verbatim — já tinham boa cobertura em tools.test.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extrair `soul_create` (1 tool, isolada, já com boa cobertura de teste)

**Files:**
- Create: `packages/tools/src/soulCreate/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `tools.test.ts` já cobre (~linhas 515-570: dry-run, plan_hash divergente, criação real) — nenhum teste novo necessário

**Interfaces:**
- Produces: `export const SOUL_CREATE_TOOLS: Tool[]`, `export const SOUL_CREATE_HANDLERS: Record<string, ToolHandler>` (1 entrada: `soul_create`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler` de `../index.js`; `listSouls`, `validateSoulSpec`, `resolveSoulSpecDefaults`, `createSoulFromSpec`, `computePlanHash`, `canonicalJsonStringify`, `SOUL_SPEC_SCHEMA_VERSION`, `CAPABILITY_CATALOG_VERSION`, `DEFAULT_GLOBAL_GUARDRAILS`, `type SoulSpec` de `@assistente-os/core`

- [ ] **Step 1: Confirmar linhas atuais do `case`, da entrada em `TOOLS`, e de `soulSpecFromWire`**

Run: `grep -n 'case "soul_create"\|name: "soul_create"\|function soulSpecFromWire' packages/tools/src/index.ts`

- [ ] **Step 2: Criar `packages/tools/src/soulCreate/index.ts`, mover `soulSpecFromWire` (não-exportada) + o schema + o handler**

```ts
import { listSouls, validateSoulSpec, resolveSoulSpecDefaults, createSoulFromSpec, computePlanHash, canonicalJsonStringify, SOUL_SPEC_SCHEMA_VERSION, CAPABILITY_CATALOG_VERSION, DEFAULT_GLOBAL_GUARDRAILS, type SoulSpec } from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

/** Mapeia o payload wire (snake_case) da tool soul_create para o SoulSpec de domínio. */
function soulSpecFromWire(a: Record<string, unknown>): SoulSpec {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const csv = (v: unknown): string[] | undefined => {
    const s = str(v);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  };
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const autonomyRaw = str(a.autonomy);
  const autonomy = autonomyRaw === "suggest" || autonomyRaw === "auto" ? autonomyRaw : "ask";
  return {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId: String(a.soul_id ?? ""),
    description: str(a.purpose),
    perfilMd: str(a.perfil_md),
    contextoMd: str(a.contexto_md),
    pessoasMd: str(a.pessoas_md),
    soulMd: str(a.soul_md),
    autonomy,
    capabilities: csv(a.capabilities) ?? [],
    connectors: csv(a.connectors),
    skills: csv(a.skills),
    provider: str(a.provider),
    model: str(a.model),
    guardrails: {
      maxTurns: num(a.max_turns),
      dailyLimitTokens: num(a.daily_limit),
    },
  };
}

export const SOUL_CREATE_TOOLS: Tool[] = [
  {
    name: "soul_create",
    description:
      "Cria uma nova soul de forma guiada. dry_run=true (default) valida e devolve plan_hash + preview sem escrever; " +
      "dry_run=false exige o plan_hash do dry-run anterior e materializa a soul atomicamente. Efeito estrutural (L3).",
    inputSchema: {
      type: "object",
      properties: {
        soul_id: { type: "string", description: "id da nova soul (slug: a-z, 0-9, hífen)" },
        purpose: { type: "string", description: "descrição curta do propósito da soul" },
        autonomy: { type: "string", description: "suggest | ask | auto (default: ask)" },
        provider: { type: "string", description: "provider do opencode (ex.: zen-sousa)" },
        model: { type: "string", description: "modelo de chat" },
        capabilities: { type: "string", description: "CSV de capabilities do catálogo L1/L2/L3 (ex.: 'memory:*,graph_list')" },
        connectors: { type: "string", description: "CSV de conectores" },
        skills: { type: "string", description: "CSV de skills" },
        daily_limit: { type: "number", description: "teto de gasto diário (unidades do provider)" },
        max_turns: { type: "number", description: "limite de turnos por sessão" },
        perfil_md: { type: "string", description: "conteúdo de perfil.md" },
        contexto_md: { type: "string", description: "conteúdo de contexto.md" },
        pessoas_md: { type: "string", description: "conteúdo de pessoas.md" },
        soul_md: { type: "string", description: "conteúdo de soul.md" },
        dry_run: { type: "boolean", description: "default true — só valida e devolve plan_hash" },
        plan_hash: { type: "string", description: "obrigatório quando dry_run=false: o hash devolvido pelo dry-run" },
      },
      required: ["soul_id", "purpose"],
    },
  },
];

export const SOUL_CREATE_HANDLERS: Record<string, ToolHandler> = {
  soul_create: async (ctx, args) => {
    ctx.authorizeAgentSoul("soul_create"); // efeito estrutural: L3 pela política da soul chamadora
    const spec = soulSpecFromWire(args);
    const existingIds = new Set(listSouls(ctx.config.home).map((s) => s.id));
    const validation = validateSoulSpec(spec, { existingIds });
    const resolved = resolveSoulSpecDefaults(spec, DEFAULT_GLOBAL_GUARDRAILS);
    const planHash = computePlanHash({
      schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
      catalogVersion: CAPABILITY_CATALOG_VERSION,
      spec: resolved,
      effectiveProvider: resolved.provider ?? "",
      effectiveModel: resolved.model ?? "",
    });
    const dryRun = args.dry_run !== false;
    if (dryRun) {
      return {
        dry_run: true,
        ok: validation.ok,
        plan_hash: planHash,
        issues: validation.issues,
        resolved_spec: resolved,
        would_create: [
          `souls/${spec.newId}/config.json`,
          `souls/${spec.newId}/{perfil,contexto,licoes,pessoas,soul}.md`,
          `souls/${spec.newId}/{sessoes,sources,decisoes}/`,
        ],
      };
    }
    if (!validation.ok) {
      throw new Error(`soul_create: spec inválida — ${validation.issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
    }
    const givenHash = typeof args.plan_hash === "string" ? args.plan_hash.trim() : "";
    if (givenHash !== planHash) {
      throw new Error(
        `soul_create: plan_hash divergente (esperado ${planHash}). Rode dry_run novamente e reenvie o hash — a spec mudou entre planejar e aplicar.`,
      );
    }
    const result = createSoulFromSpec(ctx.config.home, resolved);
    if (!result.created) {
      throw new Error(`soul_create: ${result.code} — ${result.reason}`);
    }
    return { dry_run: false, created: true, soul_id: spec.newId, plan_hash: planHash };
  },
};
```

- [ ] **Step 3: Em `index.ts`, remover o `case`, `soulSpecFromWire`, a entrada de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { SOUL_CREATE_TOOLS, SOUL_CREATE_HANDLERS } from "./soulCreate/index.js";

Object.assign(FAMILY_HANDLERS, SOUL_CREATE_HANDLERS);
```

- [ ] **Step 4: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 5: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 33 (mesma contagem).

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/soulCreate/index.ts packages/tools/src/index.ts
git commit -m "refactor(tools): extrai soul_create pra tools/src/soulCreate/ (Onda 3e Fase 2)

1 tool movida verbatim junto com o helper soulSpecFromWire (privado,
usado só por ela) — já tinha boa cobertura em tools.test.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extrair `sales_*` (2 tools, sem cobertura MCP-level hoje)

**Files:**
- Create: `packages/tools/src/sales/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: **sem cobertura hoje** — escrever smoke test de `tools/list` antes de mover (mesmo padrão da Fase 1 pra `browser_*`/`ado_*`)

**Interfaces:**
- Produces: `export const SALES_TOOLS: Tool[]`, `export const SALES_HANDLERS: Record<string, ToolHandler>` (2 entradas: `sales_ingest_meeting`, `sales_get_lead_brief`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `meetingIngestPipeline`, `generateCloserBrief` de `@assistente-os/daemon`

- [ ] **Step 1: Antes de decidir o tipo de teste, ler a implementação real de `meetingIngestPipeline`/`generateCloserBrief`**

Run: `grep -n "export.*meetingIngestPipeline\|export.*generateCloserBrief" packages/daemon/src/*.ts`

Leia essas duas funções. Se alguma delas chamar um LLM (Ollama/opencode) de forma que a chamada seja lenta/instável em CI, o teste novo deve ser só presença em `tools/list` (mesmo padrão de `browser_*` na Fase 1: não mockar Playwright/LLM). Se forem só manipulação de dados/arquivo sem chamada de rede, escreva um teste funcional real (mesmo padrão que este plano usa pras famílias `memory`/`journal`/`misc`/`editorial` abaixo).

- [ ] **Step 2: Escrever o(s) teste(s) decidido(s) no Step 1, ANTES de mover**

Smoke mínimo (adaptar se o Step 1 permitir um teste funcional real):

```ts
test("sales_*: tools/list inclui a família sales_* (smoke)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 240, method: "tools/list" });
    const names = ((res?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    for (const n of ["sales_ingest_meeting", "sales_get_lead_brief"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Build + rodar, confirmar baseline (33 pass antes de mexer em `index.ts`)**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 4: Confirmar linhas atuais dos 2 `case`s e das 2 entradas em `TOOLS`**

Run: `grep -n 'case "sales_\|name: "sales_' packages/tools/src/index.ts`

- [ ] **Step 5: Criar `packages/tools/src/sales/index.ts`**

```ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { meetingIngestPipeline, generateCloserBrief } from "@assistente-os/daemon";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const SALES_TOOLS: Tool[] = [
  {
    name: "sales_ingest_meeting",
    description: "Ingere uma transcrição de reunião/call (vtt/srt/txt), extrai decisões/ações/objeções via LLM local e persiste em souls/<soul>/sessoes/YYYY-MM-DD-meeting.md.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul dona da reunião" },
        transcriptContent: { type: "string", description: "conteúdo bruto da transcrição" },
        format: { type: "string", description: "formato da transcrição", enum: ["vtt", "srt", "txt"] },
      },
      required: ["soul", "transcriptContent", "format"],
    },
  },
  {
    name: "sales_get_lead_brief",
    description: "Gera um dossiê pré-call (objeções e decisões anteriores) para um lead a partir do histórico de reuniões já ingeridas da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        leadContact: { type: "string", description: "identificador do lead/contato (nome, telefone, e-mail)" },
      },
      required: ["soul", "leadContact"],
    },
  },
];

export const SALES_HANDLERS: Record<string, ToolHandler> = {
  sales_ingest_meeting: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    // `authorizeTool` precisa ser importado de "../index.js" (é exportada de lá desde a Fase 1)
    authorizeTool(ctx.config.home, soul.id, "sales_ingest_meeting");
    const transcriptContent = typeof args.transcriptContent === "string" && args.transcriptContent.trim() ? args.transcriptContent : null;
    const format = typeof args.format === "string" ? args.format : null;
    if (!transcriptContent || !format || !["vtt", "srt", "txt"].includes(format)) {
      throw new Error("parâmetros transcriptContent e format ('vtt'|'srt'|'txt') são obrigatórios");
    }
    const tempPath = join(tmpdir(), `sales-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`);
    await writeFile(tempPath, transcriptContent, "utf8");
    try {
      const result = await meetingIngestPipeline(tempPath, soul.id);
      return { ok: true, meetingPath: result.meetingPath, meetingPayload: result.meetingPayload };
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  },

  sales_get_lead_brief: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "sales_get_lead_brief");
    const leadContact = typeof args.leadContact === "string" && args.leadContact.trim() ? args.leadContact.trim() : null;
    if (!leadContact) throw new Error("parâmetro leadContact é obrigatório");
    const brief = await generateCloserBrief(soul.id, leadContact);
    return { ok: true, brief };
  },
};
```

Import `authorizeTool` de `../index.js` no topo do arquivo (junto com `Tool`/`ToolContext`/`ToolHandler` — só que sem `type`, já que `authorizeTool` é valor): `import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";`

- [ ] **Step 6: Em `index.ts`, remover os 2 `case`s, as 2 entradas de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { SALES_TOOLS, SALES_HANDLERS } from "./sales/index.js";

Object.assign(FAMILY_HANDLERS, SALES_HANDLERS);
```

- [ ] **Step 7: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 8: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 34 (33 baseline + 1 smoke novo — ou mais, se o Step 1 permitiu teste funcional real com mais casos).

- [ ] **Step 9: Commit**

```bash
git add packages/tools/src/sales/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai sales_* pra tools/src/sales/ (Onda 3e Fase 2)

2 tools movidas verbatim. Sem cobertura MCP-level antes desta task — soma
teste novo (smoke ou funcional, conforme dependência externa encontrada).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Extrair `souls_*` + `action_execute` (4 tools, unificadas por compartilharem `extractOpenCodeText`)

**Files:**
- Create: `packages/tools/src/souls/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `souls_list`/`soul_context` já cobertos (~linhas 55-105 de `tools.test.ts`); `soul_chat` e `action_execute` **sem cobertura de execução** (ambos chamam `runOpenCode`, que dispara o CLI `opencode` de verdade) — escrever só smoke de `tools/list` pras duas (não executar de verdade, mesmo critério de `browser_*` na Fase 1: não mockar/rodar dependência externa lenta)

**Interfaces:**
- Produces: `export const SOULS_TOOLS: Tool[]`, `export const SOULS_HANDLERS: Record<string, ToolHandler>` (4 entradas: `souls_list`, `soul_context`, `soul_chat`, `action_execute`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `listSouls`, `getSoul`, `getPool`, `addAgendaItem`, `finishAgendaItem`, `sanitizeLLMResponse` de `@assistente-os/core`; `runOpenCode` de `@assistente-os/daemon`

- [ ] **Step 1: Escrever os 2 smoke tests (soul_chat, action_execute) primeiro**

```ts
test("souls_*: tools/list inclui soul_chat e action_execute (smoke — sem execução real de opencode)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 250, method: "tools/list" });
    const names = ((res?.result as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    for (const n of ["souls_list", "soul_context", "soul_chat", "action_execute"]) {
      assert.ok(names.includes(n), `tools/list deveria incluir ${n}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Build + rodar, confirmar baseline antes de mexer**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 3: Confirmar linhas atuais dos 4 `case`s (não-contíguos — `memory_*`/`costs_summary`/`router_status`/`observation_add` ficam entre `soul_context`/`soul_chat` e `action_execute`), das 4 entradas em `TOOLS`, e de `extractOpenCodeText`**

Run: `grep -n 'case "souls_list"\|case "soul_context"\|case "soul_chat"\|case "action_execute"\|name: "souls_list"\|name: "soul_context"\|name: "soul_chat"\|name: "action_execute"\|function extractOpenCodeText' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/souls/index.ts`, mover os 4 schemas + 4 handlers + `extractOpenCodeText` (não-exportada)**

```ts
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { EOL } from "node:os";
import { listSouls, getSoul, getPool, addAgendaItem, finishAgendaItem, sanitizeLLMResponse } from "@assistente-os/core";
import { runOpenCode } from "@assistente-os/daemon";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

/** Extrai o texto das partes NDJSON emitidas pelo `opencode run` no stdout. */
function extractOpenCodeText(stdout: string): string {
  const textLines = stdout.split(EOL).map((l) => {
    try {
      const j = JSON.parse(l) as { type?: string; part?: { text?: string } };
      return j.type === "text" && j.part?.text ? j.part.text : "";
    } catch {
      return "";
    }
  });
  return textLines.filter(Boolean).join("\n");
}

export const SOULS_TOOLS: Tool[] = [
  {
    name: "souls_list",
    description: "Lista as souls disponíveis no Assistente OS.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "soul_context",
    description: "Retorna o contexto (perfil/contexto/licoes/pessoas/soul.md) de uma soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "soul_chat",
    description: "Roda opencode run headless na soul. Retorna o texto gerado.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        prompt: { type: "string", description: "instrução/consulta" },
        model: { type: "string", description: "opcional: modelo a usar" },
        timeoutSeconds: { type: "number", default: 300 },
      },
      required: ["soul", "prompt"],
    },
  },
  {
    name: "action_execute",
    description: "Executa uma ação registrada na agenda ou dispara um fluxo de trabalho.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        title: { type: "string", description: "título da ação" },
        body: { type: "string", description: "descrição da ação" },
        tier: { type: "string", description: "tier do opencode (local/zen/soul)", enum: ["local", "zen", "soul"] },
        model: { type: "string", description: "modelo a usar" },
      },
      required: ["soul", "title", "body"],
    },
  },
];

export const SOULS_HANDLERS: Record<string, ToolHandler> = {
  souls_list: async (ctx) => {
    return listSouls(ctx.config.home).map((s) => ({ id: s.id, description: s.config.description ?? null }));
  },

  soul_context: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_context");
    const files = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];
    const parts: string[] = [];
    for (const f of files) {
      const p = join(ctx.config.home, "souls", soul.id, f);
      if (existsSync(p)) parts.push(`# ${f}\n\n${readFileSync(p, "utf8")}`);
    }
    return { soul: soul.id, context: parts.join("\n\n") };
  },

  soul_chat: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_chat");
    const prompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt : null;
    if (!prompt) throw new Error("parâmetro prompt é obrigatório");
    const model = typeof args.model === "string" && args.model ? args.model : undefined;
    const timeoutSeconds = typeof args.timeoutSeconds === "number" ? args.timeoutSeconds : 300;
    const result = await runOpenCode(prompt, { cwd: join(ctx.config.home, "souls", soul.id), model, timeoutSeconds });
    const rawText = extractOpenCodeText(result.stdout);
    const sanitized = sanitizeLLMResponse(rawText);
    return { ok: result.code === 0 && !result.timedOut, code: result.code, timedOut: result.timedOut, text: sanitized.sanitized, stderr: result.stderr.slice(-1000), contentFilter: sanitized.count > 0 ? { detected: sanitized.count } : undefined };
  },

  action_execute: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "action_execute");
    const title = typeof args.title === "string" && args.title.trim() ? args.title : null;
    const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
    const model = typeof args.model === "string" && args.model ? args.model : "nemotron-3-ultra-free";
    if (!title || !body) throw new Error("title e body são obrigatórios");
    // Registra na agenda e despacha de imediato (síncrono, fora do loop de dispatch do daemon)
    const pool = getPool(ctx.config.databaseUrl);
    const item = await addAgendaItem(pool, soul.id, title, body, null);
    const prompt = `[action] Execução: ${title}\n\n${body}`;
    const result = await runOpenCode(prompt, { cwd: ctx.config.home, model, timeoutSeconds: 300 });
    // Marca concluído/falho aqui mesmo: já foi despachado, não deve ser reprocessado pelo loop do daemon.
    await finishAgendaItem(
      pool,
      item.id,
      result.code === 0 && !result.timedOut ? "completed" : "failed",
      result.timedOut ? "timeout" : result.code !== 0 ? `opencode saiu com código ${result.code}` : undefined,
    );
    const rawText = extractOpenCodeText(result.stdout);
    return {
      ok: result.code === 0 && !result.timedOut,
      code: result.code,
      timedOut: result.timedOut,
      agendaId: item.id,
      title,
      text: sanitizeLLMResponse(rawText).sanitized,
      stderr: result.stderr.slice(-1000),
    };
  },
};
```

(o `case` original de `action_execute` tinha um bloco `{ ... }` redundante em volta do corpo — remover esse aninhamento supérfluo ao colar é uma simplificação mecânica trivial, não uma mudança de lógica; se preferir manter idêntico ao original por segurança, pode deixar o bloco `{}` extra, tanto faz.)

- [ ] **Step 5: Em `index.ts`, remover os 4 `case`s (nos seus locais originais, não-contíguos), `extractOpenCodeText`, as 4 entradas de `TOOLS` (inserir `...SOULS_TOOLS` na posição onde `souls_list` estava — a primeira das 4 a aparecer), popular `FAMILY_HANDLERS`**

```ts
import { SOULS_TOOLS, SOULS_HANDLERS } from "./souls/index.js";

Object.assign(FAMILY_HANDLERS, SOULS_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 35 (34 da Task 3 + 1 smoke novo).

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/souls/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai souls_*+action_execute pra tools/src/souls/ (Onda 3e Fase 2)

4 tools movidas verbatim, unificadas num módulo só porque soul_chat e
action_execute compartilham o helper privado extractOpenCodeText. Sem
cobertura de execução real pras duas (chamam opencode de verdade via
runOpenCode) — soma smoke test de tools/list.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Extrair a família de journal da soul (6 tools, boa cobertura pra 4 delas)

**Files:**
- Create: `packages/tools/src/journal/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `soul_anotar`/`soul_licao`/`soul_decidir`/`soul_generate_aiia` já cobertos; `soul_record_lesson`/`soul_get_lessons` **sem cobertura** — ambos são operações de arquivo puras (sem rede/LLM), então escrever teste **funcional real** (não só smoke), seguindo o padrão de `soul_anotar` já existente em `tools.test.ts`

**Interfaces:**
- Produces: `export const JOURNAL_TOOLS: Tool[]`, `export const JOURNAL_HANDLERS: Record<string, ToolHandler>` (6 entradas: `soul_anotar`, `soul_licao`, `soul_decidir`, `soul_record_lesson`, `soul_get_lessons`, `soul_generate_aiia`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `anotar`, `registrarLicao`, `decidir`, `recordAgentIncident`, `getLessons`, `generateAndWriteAiia`, `buscarFamiliaPorSoulId`, `getPool` de `@assistente-os/core`

- [ ] **Step 1: Escrever os 2 testes funcionais novos primeiro (soul_record_lesson, soul_get_lessons)**

```ts
test("mcp: soul_record_lesson grava incidente e soul_get_lessons lê de volta", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const record = await server.handleMessage({
      jsonrpc: "2.0", id: 260, method: "tools/call",
      params: {
        name: "soul_record_lesson",
        arguments: {
          soul: "main", agentId: "agent-teste", topic: "teste-topico",
          mistake: "fez algo errado", rootCause: "causa raiz",
          correctiveRule: "regra corretiva",
        },
      },
    });
    const recordResult = record?.result as { content?: { text: string }[] };
    const parsed = JSON.parse(recordResult?.content?.[0]?.text ?? "{}") as { ok: boolean };
    assert.equal(parsed.ok, true);

    const lessons = await server.handleMessage({
      jsonrpc: "2.0", id: 261, method: "tools/call",
      params: { name: "soul_get_lessons", arguments: { soul: "main" } },
    });
    const lessonsResult = lessons?.result as { content?: { text: string }[] };
    const lessonsParsed = JSON.parse(lessonsResult?.content?.[0]?.text ?? "{}") as { ok: boolean; lessons: unknown[] };
    assert.equal(lessonsParsed.ok, true);
    assert.ok(Array.isArray(lessonsParsed.lessons));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Build + rodar, confirmar baseline antes de mexer**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 3: Confirmar linhas atuais dos 6 `case`s e das 6 entradas em `TOOLS`**

Run: `grep -n 'case "soul_anotar"\|case "soul_licao"\|case "soul_decidir"\|case "soul_record_lesson"\|case "soul_get_lessons"\|case "soul_generate_aiia"\|name: "soul_anotar"\|name: "soul_licao"\|name: "soul_decidir"\|name: "soul_record_lesson"\|name: "soul_get_lessons"\|name: "soul_generate_aiia"' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/journal/index.ts`**

```ts
import { join } from "node:path";
import { anotar, registrarLicao, decidir, recordAgentIncident, getLessons, generateAndWriteAiia, buscarFamiliaPorSoulId, getPool } from "@assistente-os/core";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const JOURNAL_TOOLS: Tool[] = [
  {
    name: "soul_anotar",
    description: "Anota um item cronológico na sessão do dia da soul (openclaw-style). Idempotente na data.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        texto: { type: "string", description: "nota a anotar" },
      },
      required: ["soul", "texto"],
    },
  },
  {
    name: "soul_licao",
    description: "Registra uma lição aprendida em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        texto: { type: "string", description: "lição aprendida" },
      },
      required: ["soul", "texto"],
    },
  },
  {
    name: "soul_decidir",
    description: "Grava uma decisão no formato ADR em decisoes/<data>-<slug>.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        titulo: { type: "string", description: "título da decisão" },
        contexto: { type: "string", description: "contexto/da decisão" },
        decisao: { type: "string", description: "decisão tomada" },
        alternativas: { type: "string", description: "alternativas consideradas" },
        consequencias: { type: "string", description: "consequências esperadas" },
      },
      required: ["soul", "titulo"],
    },
  },
  {
    name: "soul_record_lesson",
    description: "Registra um incidente de agente (erro + causa raiz + regra corretiva) em licoes.md da soul; após 3 reincidências do mesmo tópico, cria uma proposta de regra global aguardando aprovação humana (guardian_pending_rules/guardian_approve_rule).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        agentId: { type: "string", description: "id/nome do agente que cometeu o incidente" },
        topic: { type: "string", description: "tópico normalizado para agrupar reincidências (ex: shell-injection)" },
        mistake: { type: "string", description: "o que deu errado" },
        rootCause: { type: "string", description: "causa raiz do erro" },
        correctiveRule: { type: "string", description: "regra corretiva a seguir daqui em diante" },
      },
      required: ["soul", "agentId", "topic", "mistake", "rootCause", "correctiveRule"],
    },
  },
  {
    name: "soul_get_lessons",
    description: "Retorna as últimas lições registradas em licoes.md da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        limit: { type: "number", description: "quantidade máxima de lições (default 20)" },
      },
      required: ["soul"],
    },
  },
  {
    name: "soul_generate_aiia",
    description: "Gera/regrava AIIA.md (Avaliação de Impacto Algorítmico) da soul com base em capabilities, guardrails, dados pessoais/LGPD e regras de ouro atuais. Idempotente — sobrescreve o relatório anterior.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
      },
      required: ["soul"],
    },
  },
];

export const JOURNAL_HANDLERS: Record<string, ToolHandler> = {
  soul_anotar: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_anotar");
    const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
    if (!texto) throw new Error("parâmetro texto é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    const file = anotar(dir, texto);
    return { ok: true, arquivo: file, texto };
  },

  soul_licao: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_licao");
    const texto = typeof args.texto === "string" && args.texto.trim() ? args.texto.trim() : null;
    if (!texto) throw new Error("parâmetro texto é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    const file = registrarLicao(dir, texto);
    return { ok: true, arquivo: file, texto };
  },

  soul_decidir: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_decidir");
    const titulo = typeof args.titulo === "string" && args.titulo.trim() ? args.titulo.trim() : null;
    if (!titulo) throw new Error("parâmetro titulo é obrigatório");
    const dir = join(ctx.config.home, "souls", soul.id);
    try {
      const file = decidir(dir, {
        titulo,
        contexto: typeof args.contexto === "string" ? args.contexto : undefined,
        decisao: typeof args.decisao === "string" ? args.decisao : undefined,
        alternativas: typeof args.alternativas === "string" ? args.alternativas : undefined,
        consequencias: typeof args.consequencias === "string" ? args.consequencias : undefined,
      });
      return { ok: true, arquivo: file, titulo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  soul_record_lesson: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_record_lesson");
    const agentId = typeof args.agentId === "string" && args.agentId.trim() ? args.agentId.trim() : null;
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
    const mistake = typeof args.mistake === "string" && args.mistake.trim() ? args.mistake.trim() : null;
    const rootCause = typeof args.rootCause === "string" && args.rootCause.trim() ? args.rootCause.trim() : null;
    const correctiveRule = typeof args.correctiveRule === "string" && args.correctiveRule.trim() ? args.correctiveRule.trim() : null;
    if (!agentId || !topic || !mistake || !rootCause || !correctiveRule) {
      throw new Error("parâmetros agentId, topic, mistake, rootCause e correctiveRule são obrigatórios");
    }
    const result = recordAgentIncident(ctx.config.home, soul.id, { agentId, topic, mistake, rootCause, correctiveRule });
    return { ok: true, proposed: result.proposed };
  },

  soul_get_lessons: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_get_lessons");
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
    const dir = join(ctx.config.home, "souls", soul.id);
    return { ok: true, lessons: getLessons(dir, limit) };
  },

  soul_generate_aiia: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "soul_generate_aiia");
    const pool = getPool(ctx.config.databaseUrl);
    const familia = await buscarFamiliaPorSoulId(pool, soul.id);
    const path = generateAndWriteAiia(ctx.config.home, soul.id, {
      familia,
      globalGuardrails: ctx.config.globalGuardrails,
    });
    return { ok: true, path };
  },
};
```

- [ ] **Step 5: Em `index.ts`, remover os 6 `case`s, as 6 entradas de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { JOURNAL_TOOLS, JOURNAL_HANDLERS } from "./journal/index.js";

Object.assign(FAMILY_HANDLERS, JOURNAL_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 36 (35 da Task 4 + 1 teste funcional novo).

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/journal/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai journal da soul pra tools/src/journal/ (Onda 3e Fase 2)

6 tools movidas verbatim. soul_record_lesson/soul_get_lessons não tinham
cobertura — soma teste funcional real (grava incidente, lê de volta),
possível porque são operações de arquivo puras, sem rede/LLM.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Extrair `memory_*`/`graph_*`/`observation_*` (5 tools, `memory_search` já coberto)

**Files:**
- Create: `packages/tools/src/memory/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `memory_search` já coberto; `memory_index`/`memory_status`/`graph_list`/`observation_add` **sem cobertura de execução** — todos usam um pool Postgres real já disponível via `tempHome()`/`pointDatabaseUrlAtFreshSchema` (mesmo setup que já roda pra `memory_search`) — escrever testes **funcionais reais**, não smoke

**Interfaces:**
- Produces: `export const MEMORY_TOOLS: Tool[]`, `export const MEMORY_HANDLERS: Record<string, ToolHandler>` (5 entradas: `memory_search`, `memory_index`, `memory_status`, `graph_list`, `observation_add`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `getPool`, `sanitizeLLMResponse`, `resolveRelevanceGate` de `@assistente-os/core`; `indexDirectory`, `searchWithVerdict`, `indexStats`, `graphStats`, `listEntities`, `listRelations`, `listObservations`, `addObservation`, `getEmbedder`, `type RelevanceRule` de `@assistente-os/memory`

- [ ] **Step 1: Escrever os testes funcionais novos primeiro (memory_index, memory_status, graph_list, observation_add)**

```ts
test("mcp: memory_index indexa e memory_status/graph_list refletem o resultado", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const idx = await server.handleMessage({
      jsonrpc: "2.0", id: 270, method: "tools/call",
      params: { name: "memory_index", arguments: { soul: "main" } },
    });
    const idxParsed = JSON.parse((idx?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { indexed?: number };
    assert.ok(typeof idxParsed.indexed === "number");

    const status = await server.handleMessage({
      jsonrpc: "2.0", id: 271, method: "tools/call",
      params: { name: "memory_status", arguments: { soul: "main" } },
    });
    const statusParsed = JSON.parse((status?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { chunks?: unknown; graph?: unknown };
    assert.ok(statusParsed.chunks !== undefined && statusParsed.graph !== undefined);

    const graph = await server.handleMessage({
      jsonrpc: "2.0", id: 272, method: "tools/call",
      params: { name: "graph_list", arguments: { soul: "main" } },
    });
    const graphParsed = JSON.parse((graph?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { entities?: unknown[]; relations?: unknown[]; observations?: unknown[] };
    assert.ok(Array.isArray(graphParsed.entities) && Array.isArray(graphParsed.relations) && Array.isArray(graphParsed.observations));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("mcp: observation_add grava e graph_list lê de volta", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const add = await server.handleMessage({
      jsonrpc: "2.0", id: 273, method: "tools/call",
      params: { name: "observation_add", arguments: { soul: "main", entity_name: "entidade-teste", body: "observação de teste" } },
    });
    const addParsed = JSON.parse((add?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { ok: boolean };
    assert.equal(addParsed.ok, true);

    const graph = await server.handleMessage({
      jsonrpc: "2.0", id: 274, method: "tools/call",
      params: { name: "graph_list", arguments: { soul: "main" } },
    });
    const graphParsed = JSON.parse((graph?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { observations?: { body: string }[] };
    assert.ok(graphParsed.observations?.some((o) => o.body === "observação de teste"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

(reconfira o shape exato de retorno de cada tool contra o `case` original antes de escrever as asserções — os campos acima são fiéis ao código lido nesta sessão, mas confirme.)

- [ ] **Step 2: Build + rodar, confirmar baseline antes de mexer**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 3: Confirmar linhas atuais dos 5 `case`s (não-contíguos — `costs_summary`/`router_status` ficam entre `graph_list` e `observation_add`), das 5 entradas em `TOOLS`, e de `relevanceRule`**

Run: `grep -n 'case "memory_search"\|case "memory_index"\|case "memory_status"\|case "graph_list"\|case "observation_add"\|name: "memory_search"\|name: "memory_index"\|name: "memory_status"\|name: "graph_list"\|name: "observation_add"\|function relevanceRule\|export function relevanceRule' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/memory/index.ts`, mover os 5 schemas + 5 handlers + `relevanceRule` (não-exportada do módulo novo — só usada internamente por `memory_search`)**

```ts
import { getPool, sanitizeLLMResponse, resolveRelevanceGate } from "@assistente-os/core";
import { indexDirectory, searchWithVerdict, indexStats, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder, type RelevanceRule } from "@assistente-os/memory";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";
import { join } from "node:path";

/** Gate de relevância configurável por env (default: modo "aviso"). */
function relevanceRule(): RelevanceRule {
  const gate = resolveRelevanceGate();
  return { modo: gate.modo, min_score: gate.minScore, min_term_matches: gate.minTerms };
}

export const MEMORY_TOOLS: Tool[] = [
  {
    name: "memory_search",
    description: "Busca RAG na memória da soul (semântica com Ollama; degrada para literal).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        query: { type: "string", description: "consulta" },
        limit: { type: "number", default: 5 },
      },
      required: ["soul", "query"],
    },
  },
  {
    name: "memory_index",
    description: "Indexa (idempotente) a pasta da soul no memory.db.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "memory_status",
    description: "Contagem de chunks e grafo (entidades/relações/observações) da soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "graph_list",
    description: "Lista entidades, relações e observações do grafo da soul.",
    inputSchema: {
      type: "object",
      properties: { soul: { type: "string", description: "id da soul" } },
      required: ["soul"],
    },
  },
  {
    name: "observation_add",
    description: "Adiciona uma observação ao grafo da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        entity_name: { type: "string", description: "nome da entidade" },
        body: { type: "string", description: "corpo da observação" },
        source: { type: "string", description: "origem da observação (opcional)" },
      },
      required: ["soul", "entity_name", "body"],
    },
  },
];

export const MEMORY_HANDLERS: Record<string, ToolHandler> = {
  memory_search: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_search");
    const query = typeof args.query === "string" && args.query.trim() ? args.query : null;
    if (!query) throw new Error("parâmetro query é obrigatório");
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, args.limit)) : 5;
    const pool = getPool(ctx.config.databaseUrl);
    const embedder = getEmbedder();
    const { results, verdict } = await searchWithVerdict(pool, soul.id, query, embedder, relevanceRule(), limit);
    return {
      soul: soul.id,
      query,
      verdict,
      results: results.map((r) => ({ doc: r.docKey, path: r.path, score: r.score, method: r.method, snippet: sanitizeLLMResponse(r.body.slice(0, 300)).sanitized })),
    };
  },

  memory_index: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_index");
    const pool = getPool(ctx.config.databaseUrl);
    const r = await indexDirectory(pool, soul.id, join(ctx.config.home, "souls", soul.id), getEmbedder());
    return { indexed: r.chunks, ...r };
  },

  memory_status: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "memory_status");
    const pool = getPool(ctx.config.databaseUrl);
    return { chunks: await indexStats(pool, soul.id), graph: await graphStats(pool, soul.id) };
  },

  graph_list: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "graph_list");
    const pool = getPool(ctx.config.databaseUrl);
    return {
      entities: await listEntities(pool, soul.id),
      relations: await listRelations(pool, soul.id),
      observations: await listObservations(pool, soul.id),
    };
  },

  observation_add: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "observation_add");
    const entity_name = typeof args.entity_name === "string" && args.entity_name.trim() ? args.entity_name : null;
    const body = typeof args.body === "string" && args.body.trim() ? args.body : null;
    const source = typeof args.source === "string" ? args.source : null;
    if (!entity_name || !body) throw new Error("entity_name e body são obrigatórios");
    const pool = getPool(ctx.config.databaseUrl);
    const now = new Date().toISOString();
    await addObservation(pool, soul.id, entity_name, body, source ?? undefined);
    return { ok: true, entity_name, body, source, ts: now };
  },
};
```

**Nota:** a função `relevanceRule` original tinha um parâmetro `_configHome: string` não-usado (prefixado com `_`, convenção de "parâmetro intencionalmente ignorado") — o snippet acima já remove esse parâmetro morto já que a única chamada (`relevanceRule(ctx.config.home)` no `case` original) nunca usava o valor. Se preferir manter 100% verbatim por segurança, mantenha o parâmetro `_configHome: string` na assinatura e continue passando `ctx.config.home` na chamada — funcionalmente idêntico, só reduz uma linha de ruído. Julgue no momento, não é um requisito rígido desta task.

- [ ] **Step 5: Em `index.ts`, remover os 5 `case`s (nos seus locais originais, não-contíguos), a função `relevanceRule` (linhas ~19-23, e **parar de exportá-la** — nada mais no monorepo a importa de `@assistente-os/tools`, confirmado por grep antes de escrever este plano), as 5 entradas de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { MEMORY_TOOLS, MEMORY_HANDLERS } from "./memory/index.js";

Object.assign(FAMILY_HANDLERS, MEMORY_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 38 (36 da Task 5 + 2 testes funcionais novos).

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/memory/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai memory_*/graph_*/observation_* pra tools/src/memory/ (Onda 3e Fase 2)

5 tools movidas verbatim, junto com o helper relevanceRule (que parou de
ser exportado de index.ts — nada mais no monorepo o importava de
@assistente-os/tools). memory_index/memory_status/graph_list/
observation_add não tinham cobertura — soma testes funcionais reais
(pool Postgres já disponível no setup de teste).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Extrair `spec_grill_plan` (1 tool, já com boa cobertura)

**Files:**
- Create: `packages/tools/src/specGrill/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `tools.test.ts` já cobre extensivamente (~linhas 280-375: Fase 1 sem answers, Fase 2 com answers insuficientes, Fase 2 completa, soul inexistente) — nenhum teste novo necessário

**Interfaces:**
- Produces: `export const SPEC_GRILL_TOOLS: Tool[]`, `export const SPEC_GRILL_HANDLERS: Record<string, ToolHandler>` (1 entrada: `spec_grill_plan`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`; `getPool`, `logFullAuditEntry` de `@assistente-os/core`; `gerarPerguntasGrill`, `persistirPerguntasGrill`, `finalizarPlanoGrill`, `recordLlmCall`, `type GrillPlanResult` de `@assistente-os/daemon`

- [ ] **Step 1: Confirmar linhas atuais do `case` e da entrada em `TOOLS`**

Run: `grep -n 'case "spec_grill_plan"\|name: "spec_grill_plan"' packages/tools/src/index.ts`

- [ ] **Step 2: Criar `packages/tools/src/specGrill/index.ts`**

```ts
import { join } from "node:path";
import { getPool, logFullAuditEntry } from "@assistente-os/core";
import { gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill, recordLlmCall, type GrillPlanResult } from "@assistente-os/daemon";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const SPEC_GRILL_TOOLS: Tool[] = [
  {
    name: "spec_grill_plan",
    description: "Refina requisitos de uma feature em duas fases antes de autorizar o modo build. Sem 'answers': gera 3-5 perguntas de esclarecimento e persiste em contexto.md como pendente. Com 'answers' (mínimo 3): valida e autoriza o plano, retornando buildModeAuthorized=true.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul dona da feature" },
        featureDraft: { type: "string", description: "descrição da feature a especificar (mesmo texto nas duas fases)" },
        answers: { type: "array", items: { type: "string" }, description: "respostas às perguntas geradas na Fase 1 (mínimo 3) — presença dispara a Fase 2" },
      },
      required: ["soul", "featureDraft"],
    },
  },
];

export const SPEC_GRILL_HANDLERS: Record<string, ToolHandler> = {
  spec_grill_plan: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "spec_grill_plan");
    const featureDraft = typeof args.featureDraft === "string" && args.featureDraft.trim() ? args.featureDraft.trim() : null;
    if (!featureDraft) throw new Error("parâmetro featureDraft é obrigatório");
    const soulDir = join(ctx.config.home, "souls", soul.id);
    const answers = Array.isArray(args.answers) ? args.answers.filter((a): a is string => typeof a === "string") : undefined;

    let result: GrillPlanResult;
    if (answers) {
      const { arquivo } = finalizarPlanoGrill(soulDir, featureDraft, answers);
      result = { ok: true, soulId: soul.id, buildModeAuthorized: true, arquivo };
    } else {
      const { questions, usage } = await gerarPerguntasGrill(featureDraft);
      const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
      result = { ok: true, soulId: soul.id, questions, arquivo };
      if (usage) {
        try {
          await recordLlmCall({
            pool: getPool(ctx.config.databaseUrl),
            soul: { id: soul.id },
            route: "spec-grill",
            provider: "ollama",
            model: process.env.OLLAMA_CHAT_MODEL || "nemotron-3-ultra-free",
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            latencyMs: usage.latencyMs,
            source: usage.source,
          });
        } catch {
          /* telemetria best-effort */
        }
      }
    }

    logFullAuditEntry({
      ts: new Date().toISOString(),
      sessionId: "mcp-tool",
      soulId: soul.id,
      intention: answers ? "spec_grill_plan: plano autorizado (Fase 2)" : "spec_grill_plan: perguntas geradas (Fase 1)",
      toolsCalled: ["spec_grill_plan"],
      params: { featureDraft, phase: answers ? 2 : 1 },
    });
    return result;
  },
};
```

- [ ] **Step 3: Em `index.ts`, remover o `case`, a entrada de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { SPEC_GRILL_TOOLS, SPEC_GRILL_HANDLERS } from "./specGrill/index.js";

Object.assign(FAMILY_HANDLERS, SPEC_GRILL_HANDLERS);
```

- [ ] **Step 4: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -80`

- [ ] **Step 5: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 38 (mesma contagem da Task 6).

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/specGrill/index.ts packages/tools/src/index.ts
git commit -m "refactor(tools): extrai spec_grill_plan pra tools/src/specGrill/ (Onda 3e Fase 2)

1 tool movida verbatim — já tinha cobertura extensa em tools.test.ts
(fase 1/2 do grill, validação de answers, soul inexistente).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Extrair `costs_summary`/`router_status`/`agenda_*` (4 tools pequenas)

**Files:**
- Create: `packages/tools/src/misc/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `agenda_add`/`agenda_list` já cobertos; `costs_summary`/`router_status` **sem cobertura** — ambos são leituras simples sem side-effect (um lê o pool, outro só lê `ctx.config`) — escrever testes funcionais reais

**Interfaces:**
- Produces: `export const MISC_TOOLS: Tool[]`, `export const MISC_HANDLERS: Record<string, ToolHandler>` (4 entradas: `costs_summary`, `router_status`, `agenda_add`, `agenda_list`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler` de `../index.js`; `getPool`, `sumCostBySoul`, `recentCalls`, `listSouls`, `getSoul`, `addAgendaItem`, `getAgendaItems` de `@assistente-os/core`

- [ ] **Step 1: Escrever os 2 testes funcionais novos primeiro (costs_summary, router_status)**

```ts
test("mcp: costs_summary e router_status respondem com o shape esperado", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const costs = await server.handleMessage({
      jsonrpc: "2.0", id: 280, method: "tools/call",
      params: { name: "costs_summary", arguments: {} },
    });
    const costsParsed = JSON.parse((costs?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { bySoul?: Record<string, number>; recent?: unknown[] };
    assert.ok(costsParsed.bySoul !== undefined && Array.isArray(costsParsed.recent));

    const router = await server.handleMessage({
      jsonrpc: "2.0", id: 281, method: "tools/call",
      params: { name: "router_status", arguments: {} },
    });
    const routerParsed = JSON.parse((router?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { tiers?: unknown; ollamaUrl?: string };
    assert.ok(routerParsed.tiers !== undefined && typeof routerParsed.ollamaUrl === "string");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Build + rodar, confirmar baseline antes de mexer**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 3: Confirmar linhas atuais dos 4 `case`s (não-contíguos — `observation_add`/`action_execute`/6 tools de journal/`sales_*`/`spec_grill_plan` ficam entre `router_status` e `agenda_add`) e das 4 entradas em `TOOLS`**

Run: `grep -n 'case "costs_summary"\|case "router_status"\|case "agenda_add"\|case "agenda_list"\|name: "costs_summary"\|name: "router_status"\|name: "agenda_add"\|name: "agenda_list"' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/misc/index.ts`**

```ts
import { getPool, sumCostBySoul, recentCalls, listSouls, getSoul, addAgendaItem, getAgendaItems } from "@assistente-os/core";
import type { Tool, ToolContext, ToolHandler } from "../index.js";

export const MISC_TOOLS: Tool[] = [
  {
    name: "costs_summary",
    description: "Resumo de custos por soul e últimas chamadas do kernel.db.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "router_status",
    description: "Degraus do roteador e config do Ollama.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agenda_add",
    description: "Agenda uma tarefa para o daemon despachar (imediatamente se due_at ausente, ou quando devida).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul destino (opcional; usa a padrão do prompt se ausente)" },
        title: { type: "string", description: "título da tarefa" },
        body: { type: "string", description: "descrição/instrução da tarefa (opcional)" },
        due_at: { type: "string", description: "ISO 8601; omitido = despacho assim que o daemon rodar o loop" },
      },
      required: ["title"],
    },
  },
  {
    name: "agenda_list",
    description: "Lista itens da agenda por status (escopado à soul do agente; itens globais incluídos).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "filtro de status", enum: ["pending", "done", "all"], default: "pending" },
        soul: { type: "string", description: "id da soul (default: AGENT_SOUL_ID do processo)" },
      },
    },
  },
];

export const MISC_HANDLERS: Record<string, ToolHandler> = {
  costs_summary: async (ctx) => {
    const pool = getPool(ctx.config.databaseUrl);
    const bySoul: Record<string, number> = {};
    for (const soul of listSouls(ctx.config.home)) bySoul[soul.id] = await sumCostBySoul(pool, soul.id);
    return { bySoul, recent: await recentCalls(pool, "main", 10) };
  },

  router_status: async (ctx) => {
    return { tiers: ctx.config.routerTiers, ollamaUrl: ctx.config.ollamaUrl, ollamaChatModel: ctx.config.ollamaChatModel, ollamaEmbedModel: ctx.config.ollamaEmbedModel };
  },

  agenda_add: async (ctx, args) => {
    const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : null;
    if (!title) throw new Error("parâmetro title é obrigatório");
    const soulId = typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : null;
    if (soulId && !getSoul(ctx.config.home, soulId)) throw new Error(`soul não encontrada: ${soulId}`);
    const body = typeof args.body === "string" && args.body.trim() ? args.body.trim() : null;
    const dueAt = typeof args.due_at === "string" && args.due_at.trim() ? args.due_at.trim() : null;
    const pool = getPool(ctx.config.databaseUrl);
    const item = await addAgendaItem(pool, soulId, title, body, dueAt);
    return { ok: true, item };
  },

  agenda_list: async (ctx, args) => {
    const status = args.status === "done" || args.status === "all" ? args.status : "pending";
    const pool = getPool(ctx.config.databaseUrl);
    // Escopo: `soul` do parâmetro, senão AGENT_SOUL_ID do processo. Sem
    // nenhum dos dois, cai no modo administrativo (todas as souls).
    const scopeSoul =
      (typeof args.soul === "string" && args.soul.trim() ? args.soul.trim() : undefined) ??
      (process.env.AGENT_SOUL_ID || undefined);
    return { items: await getAgendaItems(pool, status, scopeSoul) };
  },
};
```

- [ ] **Step 5: Em `index.ts`, remover os 4 `case`s (não-contíguos), as 4 entradas de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { MISC_TOOLS, MISC_HANDLERS } from "./misc/index.js";

Object.assign(FAMILY_HANDLERS, MISC_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 39 (38 da Task 7 + 1 teste funcional novo).

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/misc/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai costs_summary/router_status/agenda_* pra tools/src/misc/ (Onda 3e Fase 2)

4 tools movidas verbatim. costs_summary/router_status não tinham
cobertura — soma teste funcional (leituras simples, sem side-effect).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Extrair `editorial_*` (3 tools, zero cobertura em qualquer nível — maior risco, por último)

**Files:**
- Create: `packages/tools/src/editorial/index.ts`
- Modify: `packages/tools/src/index.ts`
- Test: **zero cobertura hoje** — as 3 tools são operações de arquivo puras (sem LLM, sem rede — `editorial_generate_drafts` "gera" rascunhos com templates estáticos, não chama nenhum modelo), então escrever um teste funcional real cobrindo o fluxo completo (adicionar ideia → ver status do pipeline → gerar rascunhos → confirmar arquivo escrito)

**Interfaces:**
- Produces: `export const EDITORIAL_TOOLS: Tool[]`, `export const EDITORIAL_HANDLERS: Record<string, ToolHandler>` (3 entradas: `editorial_add_idea`, `editorial_get_pipeline_status`, `editorial_generate_drafts`)
- Consumes: `Tool`/`ToolContext`/`ToolHandler`/`authorizeTool` de `../index.js`

- [ ] **Step 1: Escrever o teste funcional novo primeiro (fluxo completo)**

```ts
test("mcp: editorial_add_idea → editorial_get_pipeline_status → editorial_generate_drafts (fluxo completo)", async () => {
  const home = await tempHome();
  const server = new McpServer({ home });
  try {
    const add = await server.handleMessage({
      jsonrpc: "2.0", id: 290, method: "tools/call",
      params: {
        name: "editorial_add_idea",
        arguments: { soul: "main", topic: "IA generativa em vendas", vertical: "sales-tech", source: "call", priority: "high", tags: ["ia", "vendas"] },
      },
    });
    const addParsed = JSON.parse((add?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { ok: boolean; ideaId?: string };
    assert.equal(addParsed.ok, true);
    assert.ok(addParsed.ideaId);

    const status = await server.handleMessage({
      jsonrpc: "2.0", id: 291, method: "tools/call",
      params: { name: "editorial_get_pipeline_status", arguments: { soul: "main" } },
    });
    const statusParsed = JSON.parse((status?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { ok: boolean; pipeline: { backlog: { id: string }[] }; metrics: { total: number } };
    assert.equal(statusParsed.ok, true);
    assert.equal(statusParsed.metrics.total, 1);
    assert.ok(statusParsed.pipeline.backlog.some((i) => i.id === addParsed.ideaId));

    const drafts = await server.handleMessage({
      jsonrpc: "2.0", id: 292, method: "tools/call",
      params: {
        name: "editorial_generate_drafts",
        arguments: { soul: "main", ideaIds: [addParsed.ideaId], platforms: ["linkedin"], tone: "professional" },
      },
    });
    const draftsParsed = JSON.parse((drafts?.result as { content?: { text: string }[] })?.content?.[0]?.text ?? "{}") as { ok: boolean; count: number; drafts: { platform: string }[] };
    assert.equal(draftsParsed.ok, true);
    assert.equal(draftsParsed.count, 1);
    assert.equal(draftsParsed.drafts[0]?.platform, "linkedin");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Build + rodar, confirmar baseline antes de mexer**

Run: `npm run build --workspace=packages/tools && npm test --workspace=packages/tools`

- [ ] **Step 3: Confirmar linhas atuais dos 3 `case`s e das 3 entradas em `TOOLS`**

Run: `grep -n 'case "editorial_\|name: "editorial_' packages/tools/src/index.ts`

- [ ] **Step 4: Criar `packages/tools/src/editorial/index.ts`**

Mover os 3 `case`s verbatim, **incluindo os `import("node:fs/promises")` dinâmicos repetidos dentro dos handlers** (não refatorar pra import estático — comportamento existente, fora de escopo mudar). Reconfira o corpo exato de `editorial_generate_drafts` contra o arquivo atual antes de colar — é o `case` mais longo do arquivo inteiro (~90 linhas) e tem uma indentação levemente irregular no original que não precisa ser "corrigida" durante o move.

```ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import { authorizeTool, type Tool, type ToolContext, type ToolHandler } from "../index.js";

export const EDITORIAL_TOOLS: Tool[] = [
  {
    name: "editorial_add_idea",
    description: "Adiciona uma ideia ao pipeline editorial (tópico, vertical, fonte, prioridade, tags).",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        topic: { type: "string", description: "tópico da ideia" },
        vertical: { type: "string", description: "vertical/cliente alvo" },
        source: { type: "string", description: "origem: call, meeting, doc, release, insight" },
        priority: { type: "string", description: "prioridade: high, medium, low", enum: ["high", "medium", "low"] },
        tags: { type: "array", items: { type: "string" }, description: "tags para categorização" },
      },
      required: ["soul", "topic", "vertical", "source"],
    },
  },
  {
    name: "editorial_get_pipeline_status",
    description: "Retorna status do pipeline editorial: ideias, em produção, publicadas, métricas por vertical.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        vertical: { type: "string", description: "filtrar por vertical (opcional)" },
        status: { type: "string", description: "filtrar por status: backlog, in_production, review, published", enum: ["backlog", "in_production", "review", "published"] },
      },
      required: ["soul"],
    },
  },
  {
    name: "editorial_generate_drafts",
    description: "Gera rascunhos multi-plataforma (Substack/DEV/Medium/LinkedIn) a partir de ideias aprovadas + conhecimento da soul.",
    inputSchema: {
      type: "object",
      properties: {
        soul: { type: "string", description: "id da soul" },
        ideaIds: { type: "array", items: { type: "string" }, description: "IDs das ideias aprovadas" },
        platforms: { type: "array", items: { type: "string", enum: ["substack", "dev", "medium", "linkedin"] }, description: "plataformas alvo" },
        tone: { type: "string", description: "tom: professional, casual, technical, executive", enum: ["professional", "casual", "technical", "executive"] },
      },
      required: ["soul", "ideaIds", "platforms"],
    },
  },
];

export const EDITORIAL_HANDLERS: Record<string, ToolHandler> = {
  editorial_add_idea: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_add_idea");
    const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
    const vertical = typeof args.vertical === "string" && args.vertical.trim() ? args.vertical.trim() : null;
    const source = typeof args.source === "string" && args.source.trim() ? args.source.trim() : null;
    const priority = typeof args.priority === "string" ? args.priority : "medium";
    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
    if (!topic || !vertical || !source) {
      throw new Error("parâmetros topic, vertical e source são obrigatórios");
    }
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    if (!existsSync(ideiaDir)) {
      await import("node:fs/promises").then((fs) => fs.mkdir(ideiaDir, { recursive: true }));
    }
    const ideiaId = `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ideiaPath = join(ideiaDir, `${ideiaId}.md`);
    const conteudo = `# Ideia Editorial: ${topic}\n\n**Vertical:** ${vertical}\n**Fonte:** ${source}\n**Prioridade:** ${priority}\n**Tags:** ${tags.join(", ") || "—"}\n**Status:** backlog\n**Criado em:** ${new Date().toISOString()}\n\n---\n\n${topic}\n`;
    await import("node:fs/promises").then((fs) => fs.writeFile(ideiaPath, conteudo, "utf8"));
    return { ok: true, ideaId: ideiaId, path: ideiaPath, topic, vertical, status: "backlog" };
  },

  editorial_get_pipeline_status: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_get_pipeline_status");
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    if (!existsSync(ideiaDir)) {
      return { ok: true, soul: soul.id, pipeline: { backlog: [], in_production: [], review: [], published: [] }, metrics: { total: 0, byVertical: {}, byStatus: {} } };
    }
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(ideiaDir);
    type PipelineStatus = "backlog" | "in_production" | "review" | "published";
    const pipeline: Record<PipelineStatus, Array<{ id: string; topic: string; vertical: string; status: PipelineStatus }>> = {
      backlog: [],
      in_production: [],
      review: [],
      published: [],
    };
    const metrics = { total: 0, byVertical: {} as Record<string, number>, byStatus: {} as Record<string, number> };
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(ideiaDir, file), "utf8");
      const verticalMatch = content.match(/\*\*Vertical:\*\*\s*(.+)/);
      const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/);
      const vertical = verticalMatch?.[1]?.trim() || "unknown";
      const status = (statusMatch?.[1]?.trim() as PipelineStatus) || "backlog";
      const topicLine = content.split("\n")[0] ?? "";
      const idea = { id: file.replace(".md", ""), topic: topicLine.replace("# Ideia Editorial: ", ""), vertical, status };
      pipeline[status].push(idea);
      metrics.total++;
      metrics.byVertical[vertical] = (metrics.byVertical[vertical] || 0) + 1;
      metrics.byStatus[status] = (metrics.byStatus[status] || 0) + 1;
    }
    const verticalFilter = typeof args.vertical === "string" ? args.vertical : null;
    const statusFilter = typeof args.status === "string" ? args.status : null;
    let filtered: Record<PipelineStatus, Array<{ id: string; topic: string; vertical: string; status: PipelineStatus }>> = { ...pipeline };
    if (verticalFilter) {
      for (const k of (Object.keys(filtered) as PipelineStatus[])) {
        filtered[k] = filtered[k].filter((i) => i.vertical === verticalFilter);
      }
    }
    if (statusFilter && filtered[statusFilter as PipelineStatus]) {
      filtered = { [statusFilter]: filtered[statusFilter as PipelineStatus] } as typeof filtered;
    }
    return { ok: true, soul: soul.id, pipeline: filtered, metrics };
  },

  editorial_generate_drafts: async (ctx, args) => {
    const soul = ctx.requireSoul(args.soul);
    if ("error" in soul) throw new Error(soul.error);
    authorizeTool(ctx.config.home, soul.id, "editorial_generate_drafts");
    const ideaIds = Array.isArray(args.ideaIds) ? args.ideaIds.filter((i): i is string => typeof i === "string") : [];
    const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p): p is string => typeof p === "string") : [];
    const tone = typeof args.tone === "string" ? args.tone : "professional";
    if (ideaIds.length === 0 || platforms.length === 0) {
      throw new Error("parâmetros ideaIds e platforms são obrigatórios");
    }
    const dir = join(ctx.config.home, "souls", soul.id);
    const ideiaDir = join(dir, "editorial", "ideias");
    const draftsDir = join(dir, "editorial", "drafts");
    if (!existsSync(draftsDir)) {
      await import("node:fs/promises").then((fs) => fs.mkdir(draftsDir, { recursive: true }));
    }
    const drafts = [];
    for (const ideaId of ideaIds) {
      const ideiaPath = join(ideiaDir, `${ideaId}.md`);
      if (!existsSync(ideiaPath)) continue;
      const content = await import("node:fs/promises").then((fs) => fs.readFile(ideiaPath, "utf8"));
      const topic = (content.split("\n")[0] ?? "").replace("# Ideia Editorial: ", "");
      const verticalMatch = content.match(/\*\*Vertical:\*\*\s*(.+)/);
      const vertical = (verticalMatch?.[1]?.trim() ?? "general");
      for (const platform of platforms) {
        const draftId = `draft-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const draftPath = join(draftsDir, `${draftId}.md`);
        const platformGuidance: Record<"substack" | "dev" | "medium" | "linkedin", string> = {
          substack: "Artigo longo, narrativo, com gancho forte no início, seções claras, call-to-action no final para newsletter.",
          dev: "Tutorial técnico prático, com código, passos reproduzíveis, foco em 'como fazer', tom developer-to-developer.",
          medium: "Storytelling reflexivo, estrutura ensaio, insights pessoais, formatação visual (subheads, bullets, quotes).",
          linkedin: "Post profissional, 1300 chars máx, gancho na 1ª linha, 3-5 bullets de valor, hashtags relevantes, CTA sutil.",
        };
        const guidance = platformGuidance[platform as "substack" | "dev" | "medium" | "linkedin"];
        const draftContent = `# Rascunho ${platform.toUpperCase()}: ${topic}\n\n**Vertical:** ${vertical}\n**Tom:** ${tone}\n**Ideia original:** ${ideaId}\n**Criado em:** ${new Date().toISOString()}\n\n---\n\n> **Guidance ${platform}:** ${guidance}\n\n## Estrutura sugerida\n\n1. **Gancho** — problema/dor da vertical ${vertical}\n2. **Contexto** — por que isso importa agora (dados do RAG/grafo da soul)\n3. **Solução/Insight** — o que o Assistente OS entrega (diferencial vs. Hermes, ROI, segurança)\n4. **Evidência** — case/métrica real (buscar no memory_search)\n5. **CTA** — próximo passo (demo, call, trial)\n\n---\n\n*Rascunho gerado automaticamente — revisar antes de publicar.*\n`;
        await import("node:fs/promises").then((fs) => fs.writeFile(draftPath, draftContent, "utf8"));
        drafts.push({ id: draftId, platform, topic, vertical, tone, path: draftPath });
        // Atualiza status da ideia para "in_production"
        const updatedContent = content.replace(/\*\*Status:\*\*\s*backlog/, "**Status:** in_production");
        await import("node:fs/promises").then((fs) => fs.writeFile(ideiaPath, updatedContent, "utf8"));
      }
    }
    return { ok: true, soul: soul.id, drafts, count: drafts.length };
  },
};
```

(o `for` de `platforms` acima já corrige a indentação irregular do original — puramente cosmético, sem mudar nenhuma linha de lógica; se preferir 100% byte-idêntico incluindo a indentação estranha, tanto faz, TypeScript não liga pra indentação.)

- [ ] **Step 5: Em `index.ts`, remover os 3 `case`s, as 3 entradas de `TOOLS`, popular `FAMILY_HANDLERS`**

```ts
import { EDITORIAL_TOOLS, EDITORIAL_HANDLERS } from "./editorial/index.js";

Object.assign(FAMILY_HANDLERS, EDITORIAL_HANDLERS);
```

- [ ] **Step 6: Build, iterar até limpo**

Run: `npm run build --workspace=packages/tools 2>&1 | head -100`

- [ ] **Step 7: Rodar `tools.test.ts` inteiro**

Run: `npm test --workspace=packages/tools`
Expected: PASS, 40 (39 da Task 8 + 1 teste funcional novo cobrindo o fluxo completo).

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/editorial/index.ts packages/tools/src/index.ts packages/tools/src/test/tools.test.ts
git commit -m "refactor(tools): extrai editorial_* pra tools/src/editorial/ (Onda 3e Fase 2)

3 tools movidas verbatim — zero cobertura em qualquer nível antes desta
task, apesar de editorial_generate_drafts ser o maior case do arquivo
(~90 linhas). Soma teste funcional real cobrindo o fluxo completo
(add_idea → pipeline_status → generate_drafts), possível porque as 3
tools são operações de arquivo puras (sem LLM, sem rede).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Verificação final

**Files:** nenhum arquivo novo (exceto a limpeza dos imports órfãos pré-existentes, se ainda confirmados órfãos) — só verificação + ROADMAP

- [ ] **Step 1: Confirmar que `index.ts` não tem mais nenhum `case` de tool**

Run: `grep -n 'case "' packages/tools/src/index.ts`
Expected: só `"initialize"`, `"ping"`, `"tools/list"`, `"tools/call"` (o protocolo MCP em si) e `default:` — zero `case` de nome de tool de negócio.

- [ ] **Step 2: Confirmar tamanho final de `index.ts`**

Run: `wc -l packages/tools/src/index.ts`
Expected: bem menor que os 1262 originais — a maior parte do arquivo agora é a casca de orquestração (`McpServer`, gates, `SOUL_SCOPED_TOOLS`) + imports dos 9 módulos de família novos + os 4 da Fase 1.

- [ ] **Step 3: Limpar os imports órfãos pré-existentes confirmados no Contexto deste plano — mas reconfirmar cada um via grep antes de remover, já que a migração de 9 famílias pode ter mudado o que está de fato em uso**

Run: `grep -n '\bsetupEnvironment\b\|\bsearch,\|\bLiteralEmbedder\b\|\brelevancia\b\|\blistSkills\b' packages/tools/src/index.ts`

Pra cada símbolo com zero ocorrências fora da linha de import, remover. Se algum aparecer usado (mudança de plano durante a execução), não remover — reportar como falso positivo do Contexto deste plano.

- [ ] **Step 4: Build completo do monorepo**

Run: `npm run build`
Expected: limpo em todos os workspaces.

- [ ] **Step 5: Suíte completa de `tools`**

Run: `npm test --workspace=packages/tools`
Expected: 40 (baseline acumulado das Tasks 1-9) — reconfirme a contagem exata batendo com o que cada task reportou.

- [ ] **Step 6: Confirmar ordem de `tools/list` — critério ajustado (ruling do controller durante a Task 6)**

**Ruling registrado no ledger:** ordem idêntica byte-a-byte ao original (`d72470c`) para todos os ~68 tools **não é alcançável** por este plano — várias famílias novas (`SOULS_TOOLS`/`MEMORY_TOOLS`/`MISC_TOOLS`) consolidam `case`s que estavam **intercalados** no arquivo original (ex.: `memory_*`/`graph_list` e `costs_summary`/`router_status`/`observation_add` se alternavam nas linhas 114-178 do commit-base). Consolidar um grupo não-contíguo num módulo só necessariamente "engole" o espaço que outra família (ainda não migrada, ou migrada depois) ocupava entre seus membros — isso já era verdade desde a Task 4 (`action_execute` pulou pra perto de `souls_list`) e foi aprovado então. Não é o mesmo tipo de defeito do achado real da Fase 1 (lá foi um erro de posicionamento sem nenhuma justificativa arquitetural; aqui é consequência determinística e intencional de agrupar código relacionado).

**O que de fato verificar (critério realista):** para cada família migrada (13 no total: 4 da Fase 1 + 9 desta Fase 2), confirme que (a) os membros da família aparecem **juntos e na mesma ordem relativa entre si** que tinham no arquivo original, e (b) o spread da família está posicionado onde estava o **primeiro** membro dela na ordem original. Não é esperado — e não é bloqueante — que a ordem *entre famílias diferentes* que se intercalavam no original seja preservada; documente qualquer reordenamento inter-família observado (ex.: `observation_add` antes de `costs_summary`/`router_status` no resultado final) como efeito esperado, não como bug.

Se alguma família individual não estiver na ordem interna correta, ou se um spread estiver posicionado fora do critério (a)/(b) acima, aí sim é bloqueante — corrija antes de prosseguir.

- [ ] **Step 7: Atualizar `docs/ROADMAP.md`**

Encontre a entrada "Onda 3e" (grep por "Onda 3e"). A entrada hoje (depois da Fase 1 do chat.ts e da Fase 1 do tools/index.ts) já diz algo como "`tools/src/index.ts`: 4 famílias migradas... arquivo reduzido de 2075 para 1262 linhas". Atualize essa parte pra registrar que a Fase 2 do tools/index.ts também terminou: as 9 famílias restantes (skill_*, soul_create, sales_*, souls_*+action_execute, journal da soul, memory_*/graph_*/observation_*, spec_grill_plan, costs_summary/router_status/agenda_*, editorial_*) migradas, com a contagem final de linhas confirmada no Step 2. Link pro plano: [`2026-09-04-onda-3e-split-tools-dispatcher-fase2.md`](superpowers/plans/2026-09-04-onda-3e-split-tools-dispatcher-fase2.md). Com isso, `tools/index.ts` fica só com a casca de orquestração — não sobra Fase 3 planejada pra este arquivo (a única frente restante documentada no plano de Fase 1, decompor `handlePostChat`'s 17 variáveis, é sobre `chat.ts`, arquivo diferente).

Antes de escrever qualquer nome de função/arquivo no ROADMAP, confirme cada um via grep no código real — a Fase 1 já teve um incidente de nomes inventados corrigido no commit `8f0890a`, não repita.

- [ ] **Step 8: Commit**

```bash
git add docs/ROADMAP.md
# se o Step 3 removeu imports, incluir packages/tools/src/index.ts também
git commit -m "docs(roadmap): marca Onda 3e (tools/index.ts) Fase 2 concluída

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
