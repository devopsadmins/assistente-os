# Skills por soul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada soul skills declarativas (`SKILL.md`) que entram no prompt só quando relevantes, com allowlist, tools MCP e CLI.

**Architecture:** Lógica pura de skills em `packages/core/src/skills.ts` (parse de frontmatter flat sem dep de YAML, descoberta per-soul→global, matcher híbrido léxico+embedding com auto-skip). O daemon (`context.ts`) resolve as skills da allowlist da soul, casa contra o prompt e injeta uma seção no `buildPrompt` (índice sempre + corpo das matched); o agente LangGraph recebe o mesmo texto via preamble. Tools `skill_list`/`skill_create` seguem o padrão dry-run/`plan_hash`/L3 do `soul_create`.

**Tech Stack:** Node/TS, npm workspaces, `node --test`, Postgres (via pgTestHelper), `@assistente-os/{core,memory,daemon,tools,cli}`.

**Spec:** `docs/superpowers/specs/2026-08-27-skills-por-soul-design.md`

## Global Constraints

- **Sem nova dependência npm.** Frontmatter é flat — mini-parser próprio.
- **Zero Trust é a autoridade:** `skill.tools` é advisório, NUNCA altera `resolveAllowedTools`/`isToolAllowed`.
- **CI-safe:** o caminho léxico do matcher é puro e determinístico; o embedding é opcional e auto-skip (`opts.embed` injetável).
- **`node:test` + `node:assert/strict`**, flat `test(...)`, sem describe (padrão do repo).
- **Testes com Postgres:** `createTestSchema()` de `packages/<pkg>/src/test/pgTestHelper.ts`; `DATABASE_URL` do `.env`.
- **`packages/daemon/tsconfig.json` inclui `src/test/**`** (corrigido em sessão anterior — não reintroduzir `exclude`).
- Slugs de skill: `^[a-z0-9][a-z0-9-]{1,63}$`. `description` ≤ 280 chars. Arquivo ≤ 32 KB (`DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes`).
- Env: `SKILL_MATCH_THRESHOLD` (default `0.35`), `SKILL_MAX_ACTIVE` (default `3`), `SKILLS_ENABLED` (default `1`).
- Commits: mensagem termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Trabalhar em branch `feat/skills-por-soul` (não commitar direto na `main`).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `packages/core/src/skills.ts` **(novo)** | tipos; `parseSkillFrontmatter`; `resolveSkillPath`; `scanSkillDirs`; `listSkills`; `matchSkills`; `renderSkillsPrompt`; `skillMatchThreshold/skillMaxActive/skillsEnabled` |
| `packages/core/src/test/skills.test.ts` **(novo)** | unit puro: parse, resolução, allowlist, matcher léxico + auto-skip, limites |
| `packages/core/src/index.ts` | `export * from "./skills.js"` |
| `packages/core/src/souls.ts` | `SOUL_SUBDIRS` += `"skills"` |
| `packages/core/src/soul-spec.ts` | `validateSoulSpec` aceita `opts.skillResolver?` |
| `packages/core/src/policy.ts` | catálogo += `skill_list` (L1), `skill_create` (L3) |
| `packages/daemon/src/context.ts` | `BuiltPrompt.skills`; `skillsCtx` no `prefixParts`; `makeEmbedFn` |
| `packages/daemon/src/langgraph-runner.ts` | resolve skills → `skillsPreamble` → `runAgentStream` |
| `packages/memory/src/agent-workflow.ts` | `runAgent`/`runAgentStream` aceitam `systemExtra?` |
| `packages/daemon/src/routes/chat.ts` | audit trail `skills: ativadas` |
| `packages/daemon/src/test/skills-prompt.test.ts` **(novo)** | `buildPrompt` + skills |
| `packages/tools/src/index.ts` | tools `skill_list`, `skill_create` + wire; `SOUL_SCOPED_TOOLS` |
| `packages/tools/src/test/tools.test.ts` | +testes skill tools |
| `packages/cli/src/index.ts` | comando `skill` |
| `README.md`, `docs/ROADMAP.md` | F5 / status |

---

## Task 1: Parser de frontmatter (`parseSkillFrontmatter`)

**Files:**
- Create: `packages/core/src/skills.ts`
- Create: `packages/core/src/test/skills.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./skills.js";` após `./soul-spec.js`)

**Interfaces:**
- Produces:
  ```ts
  export interface SkillFrontmatter { name: string; description: string; keywords: string[]; tools: string[]; }
  export type ParseResult =
    | { ok: true; frontmatter: SkillFrontmatter; body: string }
    | { ok: false; issues: string[] };
  export function parseSkillFrontmatter(raw: string): ParseResult;
  ```
  Regras: `raw` deve começar com `---\n`, ter um segundo `---` numa linha própria. Frontmatter é flat: linhas `key: value`. `value` pode ser:
  - string simples (`description: texto`) — trim;
  - lista inline (`keywords: [a, b, c]`) — split por vírgula, trim, remove vazios;
  - lista em bloco (`keywords:` seguido de linhas `  - item`).
  `name` obrigatório e `^[a-z0-9][a-z0-9-]{1,63}$`; `description` obrigatória e ≤ 280; `keywords`/`tools` default `[]`, e se presentes precisam ser lista (string simples → issue). Chaves desconhecidas: ignoradas (não é issue). `body` = tudo depois do 2º `---`, trim.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkillFrontmatter } from "../skills.js";

const OK = `---
name: sales-followup
description: Redigir follow-up de reunião
keywords: [recap, pós-call]
tools:
  - sales_get_lead_brief
  - soul_anotar
---
Corpo da skill.
Segunda linha.`;

test("parseSkillFrontmatter: frontmatter válido", () => {
  const r = parseSkillFrontmatter(OK);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.frontmatter.name, "sales-followup");
  assert.equal(r.frontmatter.description, "Redigir follow-up de reunião");
  assert.deepEqual(r.frontmatter.keywords, ["recap", "pós-call"]);
  assert.deepEqual(r.frontmatter.tools, ["sales_get_lead_brief", "soul_anotar"]);
  assert.match(r.body, /^Corpo da skill\.\nSegunda linha\.$/);
});

test("parseSkillFrontmatter: sem name → issue", () => {
  const r = parseSkillFrontmatter("---\ndescription: x\n---\ncorpo");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.issues.some((i) => /name/.test(i)));
});

test("parseSkillFrontmatter: name inválido / description longa / keywords não-lista", () => {
  const r = parseSkillFrontmatter(`---\nname: Bad Name\ndescription: ${"x".repeat(300)}\nkeywords: nao-e-lista\n---\nc`);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.issues.some((i) => /name/.test(i)));
  assert.ok(r.issues.some((i) => /description/.test(i)));
  assert.ok(r.issues.some((i) => /keywords/.test(i)));
});

test("parseSkillFrontmatter: sem delimitador → issue", () => {
  assert.equal(parseSkillFrontmatter("só corpo, sem frontmatter").ok, false);
});

test("parseSkillFrontmatter: keywords/tools ausentes viram []", () => {
  const r = parseSkillFrontmatter("---\nname: a\ndescription: d\n---\nc");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.frontmatter.keywords, []);
  assert.deepEqual(r.frontmatter.tools, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build --workspace=@assistente-os/core && node --test packages/core/dist/test/skills.test.js`
Expected: FAIL — `Cannot find module '../skills.js'`.

- [ ] **Step 3: Write minimal implementation**

Criar `packages/core/src/skills.ts` com os tipos e `parseSkillFrontmatter`. Implementação: regex `^---\n([\s\S]*?)\n---\n?([\s\S]*)$`. Parse do bloco de frontmatter linha a linha acumulando `key`/`value` (com suporte a lista em bloco via lookahead de linhas `  - `). Validar `name` (`/^[a-z0-9][a-z0-9-]{1,63}$/`), `description` (`.length <= 280`), `keywords`/`tools` (Array). Acumular `issues`, nunca lançar. Adicionar `export * from "./skills.js";` em `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build --workspace=@assistente-os/core && node --test packages/core/dist/test/skills.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills.ts packages/core/src/test/skills.test.ts packages/core/src/index.ts
git commit -m "feat(skills): parser de frontmatter flat de SKILL.md"
```

---

## Task 2: Descoberta + loader (`resolveSkillPath`, `scanSkillDirs`, `listSkills`)

**Files:**
- Modify: `packages/core/src/skills.ts`
- Modify: `packages/core/src/souls.ts` (`SOUL_SUBDIRS`)
- Modify: `packages/core/src/test/skills.test.ts`

**Interfaces:**
- Consumes: `parseSkillFrontmatter` (Task 1); `Soul` de `./souls.js`.
- Produces:
  ```ts
  export interface LoadedSkill extends SkillFrontmatter {
    scope: "soul" | "global";
    path: string;   // .../SKILL.md
    body: string;
    bytes: number;  // tamanho do arquivo
  }
  export interface DiscoveredSkill { name: string; scope: "soul" | "global"; path: string; }
  /** per-soul primeiro, senão global; null se não existe em nenhum. */
  export function resolveSkillPath(home: string, soulId: string, name: string): { path: string; scope: "soul" | "global" } | null;
  /** Todas as skills EXISTENTES nos diretórios (soul + global), sem allowlist. Para skill_list. */
  export function scanSkillDirs(home: string, soulId: string): DiscoveredSkill[];
  /** Skills da allowlist da soul, resolvidas e parseadas. Ignora nomes que não resolvem ou não parseiam. Cache por (path,mtime). */
  export function listSkills(home: string, soul: Soul): LoadedSkill[];
  ```
  `home` = raiz de `.assistant-os`. Global: `<home>/skills/<name>/SKILL.md`. Soul: `<home>/souls/<soulId>/skills/<name>/SKILL.md`. Allowlist = `soul.config.agent?.permissions?.skills ?? []`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkillPath, scanSkillDirs, listSkills } from "../skills.js";
import { createSoulFull } from "../souls.js";

function skillHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aos-skills-"));
  const g = join(home, "skills", "compartilhada");
  mkdirSync(g, { recursive: true });
  writeFileSync(join(g, "SKILL.md"), "---\nname: compartilhada\ndescription: skill global\nkeywords: [global-x]\n---\nCorpo global.");
  createSoulFull(home, "main", { name: "main" });
  const s = join(home, "souls", "main", "skills", "local");
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, "SKILL.md"), "---\nname: local\ndescription: skill da soul\n---\nCorpo local.");
  // override: mesma 'compartilhada' na soul deve vencer a global
  const ov = join(home, "souls", "main", "skills", "compartilhada");
  mkdirSync(ov, { recursive: true });
  writeFileSync(join(ov, "SKILL.md"), "---\nname: compartilhada\ndescription: override da soul\n---\nCorpo override.");
  return home;
}

test("resolveSkillPath: per-soul vence global; null se ausente", () => {
  const home = skillHome();
  try {
    assert.equal(resolveSkillPath(home, "main", "compartilhada")!.scope, "soul");
    assert.equal(resolveSkillPath(home, "main", "local")!.scope, "soul");
    assert.equal(resolveSkillPath(home, "main", "inexistente"), null);
    // outra soul sem skills locais → global
    createSoulFull(home, "outra", { name: "outra" });
    assert.equal(resolveSkillPath(home, "outra", "compartilhada")!.scope, "global");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("scanSkillDirs: lista tudo que existe, sem allowlist", () => {
  const home = skillHome();
  try {
    const names = scanSkillDirs(home, "main").map((s) => `${s.name}:${s.scope}`).sort();
    assert.deepEqual(names, ["compartilhada:soul", "local:soul"]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("listSkills: só as da allowlist, resolvidas; ignora nome não resolvível", () => {
  const home = skillHome();
  try {
    const soul = { id: "main", dir: join(home, "souls", "main"),
      config: { name: "main", agent: { permissions: { tools: [], skills: ["local", "fantasma"] }, guardrails: {} } } } as any;
    const loaded = listSkills(home, soul);
    assert.deepEqual(loaded.map((s) => s.name), ["local"]);
    assert.equal(loaded[0]!.scope, "soul");
    assert.match(loaded[0]!.body, /Corpo local\./);
    assert.ok(loaded[0]!.bytes > 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("listSkills: allowlist vazia → []", () => {
  const home = skillHome();
  try {
    const soul = { id: "main", dir: join(home, "souls", "main"), config: { name: "main" } } as any;
    assert.deepEqual(listSkills(home, soul), []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace=@assistente-os/core && node --test packages/core/dist/test/skills.test.js`
Expected: FAIL — `resolveSkillPath is not a function`.

- [ ] **Step 3: Implement**

Em `skills.ts`: `resolveSkillPath` (checa `existsSync` do soul path, senão global). `scanSkillDirs` (`readdirSync` dos dois diretórios `skills/`, filtra os que têm `SKILL.md`, soul sobrescreve global por nome). `listSkills` (allowlist → `resolveSkillPath` → `readFileSync` → `parseSkillFrontmatter`; descarta os que `!ok`; monta `LoadedSkill` com `statSync().size`). Cache module-level `Map<path, { mtimeMs; skill: LoadedSkill }>`. Em `souls.ts`: `const SOUL_SUBDIRS = ["sessoes", "sources", "decisoes", "skills"] as const;`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build --workspace=@assistente-os/core && node --test packages/core/dist/test/skills.test.js`
Expected: PASS (9 testes no total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills.ts packages/core/src/souls.ts packages/core/src/test/skills.test.ts
git commit -m "feat(skills): descoberta per-soul>global + loader com allowlist"
```

---

## Task 3: Matcher híbrido (`matchSkills`) + config

**Files:**
- Modify: `packages/core/src/skills.ts`
- Modify: `packages/core/src/test/skills.test.ts`

**Interfaces:**
- Consumes: `LoadedSkill` (Task 2).
- Produces:
  ```ts
  export interface SkillMatch { skill: LoadedSkill; score: number; lexicalHits: string[]; usedEmbedding: boolean; }
  export interface SkillMatchOptions {
    threshold?: number;   // default skillMatchThreshold()
    max?: number;         // default skillMaxActive()
    embed?: (texts: string[]) => Promise<number[][]>;  // undefined = só-léxico
  }
  export async function matchSkills(prompt: string, skills: LoadedSkill[], opts?: SkillMatchOptions): Promise<SkillMatch[]>;
  export function skillMatchThreshold(): number;  // env SKILL_MATCH_THRESHOLD | 0.35
  export function skillMaxActive(): number;       // env SKILL_MAX_ACTIVE | 3
  export function skillsEnabled(): boolean;       // env SKILLS_ENABLED !== "0"
  ```
  Algoritmo por skill:
  1. `norm(s)` = lowercase + remove acento + tokeniza `/[^a-z0-9]+/` + descarta tokens ≤ 2 chars.
  2. `lex` = `|norm(prompt) ∩ norm(description + " " + keywords.join(" "))| / max(1, |norm(desc+kw)|)`.
     Se alguma `keyword` (normalizada, frase inteira) for substring de `norm(prompt)` → `lex = max(lex, 0.6)` e adiciona a keyword a `lexicalHits`.
  3. Se `opts.embed`: tenta `emb = cosine(vecPrompt, vecDesc)` onde `vecDesc` vem de `cache.getEmbedding(sha1(description))` (miss → `opts.embed([description])` + `cache.setEmbedding`). `vecPrompt` = `opts.embed([prompt])` (uma vez, fora do loop). Qualquer throw → `usedEmbedding=false` para essa skill, segue com `lex`.
  4. `score = usedEmbedding ? 0.5*lex + 0.5*emb : lex`.
  5. Ordena desc, filtra `>= threshold`, corta em `max`.
  `cache` importado de `./cache.js`.

- [ ] **Step 1: Write the failing test**

```ts
import { matchSkills, skillMatchThreshold } from "../skills.js";

const mk = (name: string, description: string, keywords: string[] = []): any => ({
  name, description, keywords, tools: [], scope: "global", path: `/x/${name}`, body: `corpo ${name}`, bytes: 10,
});

test("matchSkills léxico: keyword frase inteira dá boost e entra acima do threshold", async () => {
  const skills = [
    mk("followup", "redigir follow-up de reunião comercial", ["próximos passos", "recap"]),
    mk("outra", "assunto totalmente diferente sobre jardinagem"),
  ];
  const res = await matchSkills("me faz um recap da call com próximos passos", skills, { max: 3 });
  assert.equal(res[0]!.skill.name, "followup");
  assert.ok(res[0]!.score >= skillMatchThreshold());
  assert.ok(res.every((m) => m.skill.name !== "outra"));
  assert.ok(res[0]!.lexicalHits.includes("recap") || res[0]!.lexicalHits.includes("próximos passos"));
});

test("matchSkills: nada casa → []", async () => {
  const res = await matchSkills("xyz abc def", [mk("a", "sobre contabilidade e impostos")], { max: 3 });
  assert.deepEqual(res, []);
});

test("matchSkills: respeita max", async () => {
  const skills = [mk("a", "deploy pm2"), mk("b", "deploy docker"), mk("c", "deploy vps"), mk("d", "deploy tunnel")];
  const res = await matchSkills("como fazer deploy", skills, { threshold: 0.01, max: 2 });
  assert.equal(res.length, 2);
});

test("matchSkills: embed que lança → auto-skip para só-léxico (não quebra)", async () => {
  const skills = [mk("a", "deploy pm2 na vps")];
  const res = await matchSkills("deploy pm2", skills, {
    threshold: 0.01, max: 3,
    embed: async () => { throw new Error("embedder off"); },
  });
  assert.equal(res.length, 1);
  assert.equal(res[0]!.usedEmbedding, false);
});

test("matchSkills: embed ok → usedEmbedding true e score combina léxico+embedding", async () => {
  const skills = [mk("a", "deploy pm2 na vps")];
  const fakeEmbed = async (texts: string[]) => texts.map(() => [1, 0, 0]); // cosine 1
  const res = await matchSkills("qualquer coisa", skills, { threshold: 0.01, max: 3, embed: fakeEmbed });
  assert.equal(res[0]!.usedEmbedding, true);
  assert.ok(res[0]!.score >= 0.5); // 0.5*lex(0) + 0.5*emb(1)
});
```

- [ ] **Step 2: Run to verify it fails** — `matchSkills is not a function`.

- [ ] **Step 3: Implement** o matcher + helpers de env + `normalize`/`cosine` locais (ou reusar `cosine` de memory? não — evitar dep core→memory; implementar local, 4 linhas). `sha1` de `node:crypto`.

- [ ] **Step 4: Run to verify it passes** — PASS (14 no total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills.ts packages/core/src/test/skills.test.ts
git commit -m "feat(skills): matcher híbrido léxico+embedding com auto-skip"
```

---

## Task 4: Renderer do bloco de prompt (`renderSkillsPrompt`) + validação no SoulSpec

**Files:**
- Modify: `packages/core/src/skills.ts`
- Modify: `packages/core/src/soul-spec.ts`
- Modify: `packages/core/src/test/skills.test.ts`
- Modify: `packages/core/src/test/soul-spec.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Bloco pronto para o prompt: índice (todas as da allowlist) + corpo das ativas. "" se enabled=false ou sem skills. */
  export function renderSkillsPrompt(
    available: LoadedSkill[],
    active: SkillMatch[],
    isToolAllowed: (tool: string) => boolean,
  ): string;
  ```
  Formato exato: ver spec §4. Índice: `## Skills disponíveis (ative mentalmente a que se aplica)` + linhas `- <name> — <description>`. Para cada `active`: `\n## Skill ativa: <name>\n<body>` e, se `skill.tools.length`, `\nFerramentas relevantes: <lista>` onde cada tool fora de `isToolAllowed` recebe ` (indisponível para esta soul)`.
- `validateSoulSpec`: `opts` ganha `skillResolver?: (name: string) => boolean` (default `() => true`). Para cada `spec.skills`, se `!skillResolver(name)` → issue `skills: skill '<name>' não encontrada`.

- [ ] **Step 1: failing tests**

```ts
// skills.test.ts
import { renderSkillsPrompt } from "../skills.js";
test("renderSkillsPrompt: índice sempre; corpo só das ativas; tool indisponível marcada", () => {
  const a = mk("x", "faz X"); const b = mk("y", "faz Y"); b.tools = ["tool_ok", "tool_no"];
  const out = renderSkillsPrompt([a, b], [{ skill: b, score: 0.9, lexicalHits: [], usedEmbedding: false }], (t) => t === "tool_ok");
  assert.match(out, /## Skills disponíveis/);
  assert.match(out, /- x — faz X/);
  assert.match(out, /- y — faz Y/);
  assert.match(out, /## Skill ativa: y/);
  assert.match(out, /corpo y/);
  assert.doesNotMatch(out, /## Skill ativa: x/);
  assert.match(out, /`tool_ok`/);
  assert.match(out, /`tool_no` \(indisponível para esta soul\)/);
});
test("renderSkillsPrompt: sem skills → string vazia", () => {
  assert.equal(renderSkillsPrompt([], [], () => true), "");
});
```
```ts
// soul-spec.test.ts — adicionar
test("validateSoulSpec: skillResolver rejeita nome desconhecido", () => {
  const spec = { schemaVersion: 1, newId: "nova", autonomy: "ask", capabilities: [], skills: ["existe", "nao-existe"] } as any;
  const r = validateSoulSpec(spec, { existingIds: new Set(), skillResolver: (n: string) => n === "existe" });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /nao-existe/.test(i.message)));
});
test("validateSoulSpec: sem skillResolver, skills não são checadas (compat)", () => {
  const spec = { schemaVersion: 1, newId: "nova", autonomy: "ask", capabilities: [], skills: ["qualquer"] } as any;
  assert.equal(validateSoulSpec(spec, { existingIds: new Set() }).ok, true);
});
```

- [ ] **Step 2: fails** — `renderSkillsPrompt is not a function`; soul-spec test falha.
- [ ] **Step 3: implement** ambos.
- [ ] **Step 4: passes** — `node --test packages/core/dist/test/skills.test.js packages/core/dist/test/soul-spec.test.js`.
- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills.ts packages/core/src/soul-spec.ts packages/core/src/test/skills.test.ts packages/core/src/test/soul-spec.test.ts
git commit -m "feat(skills): renderSkillsPrompt + validação de skills no SoulSpec"
```

---

## Task 5: Integração no `buildPrompt`

**Files:**
- Modify: `packages/daemon/src/context.ts`
- Create: `packages/daemon/src/test/skills-prompt.test.ts`

**Interfaces:**
- Consumes: `listSkills`, `matchSkills`, `renderSkillsPrompt`, `skillsEnabled` (`@assistente-os/core`); `getEmbedder` (`@assistente-os/memory`); `resolveAllowedTools`, `isToolAllowed` (`@assistente-os/core`).
- Produces: `BuiltPrompt.skills?: { available: string[]; active: Array<{ name: string; score: number; usedEmbedding: boolean }> }`.
  `skillsCtx` entra em `prefixParts` **entre `almaCtx` e `ragCtx`**. `makeEmbedFn(): (texts) => Promise<number[][]>` = `const e = getEmbedder(); return async (texts) => Promise.all(texts.map((t) => e.embed(t)));`. Se `!skillsEnabled()` → pula tudo, `skills` undefined.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, loadConfig, getSoul } from "@assistente-os/core";
import { buildPrompt } from "../context.js";
import { tempDaemonHome } from "./pgTestHelper.js";

async function homeWithSkill(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-skp-"));
  createSoul(home, "main", { name: "main", agent: { permissions: { tools: ["soul_anotar"], skills: ["gatilho"] }, guardrails: {} } });
  writeFileSync(join(home, "souls", "main", "perfil.md"), "# main\n");
  const sk = join(home, "souls", "main", "skills", "gatilho");
  mkdirSync(sk, { recursive: true });
  writeFileSync(join(sk, "SKILL.md"), "---\nname: gatilho\ndescription: skill de teste\nkeywords: [palavra-magica]\ntools: [soul_anotar, tool_ausente]\n---\nCONTEUDO-DA-SKILL-ATIVA");
  const db = await tempDaemonHome(home);
  return { home, async cleanup() { await db.cleanup(); rmSync(home, { recursive: true, force: true }); } };
}

test("buildPrompt: índice sempre; corpo só quando o prompt casa a keyword", async () => {
  const { home, cleanup } = await homeWithSkill();
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const hit = await buildPrompt({ home, soul, prompt: "isso tem palavra-magica aqui", config, withRag: false });
    assert.match(hit.fullPrompt, /## Skills disponíveis/);
    assert.match(hit.fullPrompt, /- gatilho — skill de teste/);
    assert.match(hit.fullPrompt, /## Skill ativa: gatilho/);
    assert.match(hit.fullPrompt, /CONTEUDO-DA-SKILL-ATIVA/);
    assert.match(hit.fullPrompt, /`tool_ausente` \(indisponível para esta soul\)/);
    assert.equal(hit.skills?.active[0]?.name, "gatilho");

    const miss = await buildPrompt({ home, soul, prompt: "pergunta sem relação nenhuma", config, withRag: false });
    assert.match(miss.fullPrompt, /## Skills disponíveis/);
    assert.doesNotMatch(miss.fullPrompt, /CONTEUDO-DA-SKILL-ATIVA/);
    assert.equal(miss.skills?.active.length, 0);
  } finally { await cleanup(); }
});

test("buildPrompt: SKILLS_ENABLED=0 remove a seção", async () => {
  const { home, cleanup } = await homeWithSkill();
  const prev = process.env.SKILLS_ENABLED;
  process.env.SKILLS_ENABLED = "0";
  try {
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const out = await buildPrompt({ home, soul, prompt: "palavra-magica", config, withRag: false });
    assert.doesNotMatch(out.fullPrompt, /## Skills disponíveis/);
    assert.equal(out.skills, undefined);
  } finally {
    if (prev === undefined) delete process.env.SKILLS_ENABLED; else process.env.SKILLS_ENABLED = prev;
    await cleanup();
  }
});

test("buildPrompt: skill fora da allowlist não é injetada", async () => {
  const { home, cleanup } = await homeWithSkill();
  try {
    // cria uma skill que existe mas NÃO está na allowlist
    const sk = join(home, "souls", "main", "skills", "nao-listada");
    mkdirSync(sk, { recursive: true });
    writeFileSync(join(sk, "SKILL.md"), "---\nname: nao-listada\ndescription: fora da allowlist\nkeywords: [palavra-magica]\n---\nNAO-DEVE-APARECER");
    const config = await loadConfig({ home });
    const soul = getSoul(home, "main")!;
    const out = await buildPrompt({ home, soul, prompt: "palavra-magica", config, withRag: false });
    assert.doesNotMatch(out.fullPrompt, /NAO-DEVE-APARECER/);
    assert.doesNotMatch(out.fullPrompt, /- nao-listada —/);
  } finally { await cleanup(); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace=@assistente-os/daemon && DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-) node --test packages/daemon/dist/test/skills-prompt.test.js`
Expected: FAIL — `## Skills disponíveis` ausente.

- [ ] **Step 3: Implement**

Em `context.ts`: importar os helpers. Depois de montar `almaCtx`, antes de `ragCtx`:
```ts
let skillsCtx = "";
let skillsMeta: BuiltPrompt["skills"];
if (skillsEnabled()) {
  const all = listSkills(home, soul);
  if (all.length > 0) {
    const active = await matchSkills(prompt, all, { embed: makeEmbedFn() }).catch(() => []);
    const allowed = resolveAllowedTools(soul.config.agent);
    skillsCtx = renderSkillsPrompt(all, active, (t) => isToolAllowed(allowed, t));
    skillsMeta = { available: all.map((s) => s.name), active: active.map((m) => ({ name: m.skill.name, score: m.score, usedEmbedding: m.usedEmbedding })) };
  }
}
```
Inserir `skillsCtx` em `prefixParts` entre `almaCtx` e `ragCtx`. Adicionar `skills: skillsMeta` ao retorno. `BuiltPrompt` ganha o campo opcional.

- [ ] **Step 4: Run to verify it passes** — PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/context.ts packages/daemon/src/test/skills-prompt.test.ts
git commit -m "feat(skills): injeta índice + corpo das skills relevantes no buildPrompt"
```

---

## Task 6: Caminho do agente LangGraph + audit trail no chat

**Files:**
- Modify: `packages/memory/src/agent-workflow.ts` (`runAgent`, `runAgentStream` aceitam `systemExtra?: string`)
- Modify: `packages/daemon/src/langgraph-runner.ts` (resolve skills, passa `systemExtra`)
- Modify: `packages/daemon/src/routes/chat.ts` (audit trail `skills: ativadas`)
- Modify: `packages/daemon/src/test/skills-prompt.test.ts` (+1) OU `mission-runner`/`daemon.test.ts` — teste do audit trail

**Interfaces:**
- Consumes: `BuiltPrompt.skills` (Task 5); `listSkills`/`matchSkills`/`renderSkillsPrompt` no runner.
- `runAgentStream(pool, soul, userMessage, threadId?, tools?, seedMessages?, systemExtra?)` — `systemExtra`, se presente, é concatenado ao `content` da mensagem `system` inicial (`createInitialState` / os literais inline).
- `langgraph-runner.ts`: em `runLangGraphAgentStream`, se `skillsEnabled()`, resolve `listSkills(config.home, getSoul(config.home, soul)!)`, `matchSkills(prompt, ...)`, `renderSkillsPrompt(...)` e passa como `systemExtra`.
- `chat.ts`: no bloco de audit RAG (perto de `intention: "RAG: retrieval debug"`), se `built.skills?.active.length` → `logFullAuditEntry({ ..., intention: "skills: ativadas", params: { skills: built.skills.active } })` + `emitStep("skills", ...)`.

- [ ] **Step 1: failing test** (audit trail): estender `skills-prompt.test.ts` ou um teste em `daemon.test.ts` estilo `rag-injection-chat.test.ts` (setar `ASSISTENTE_OS_HOME=home`, `OLLAMA_URL` morto, `run` mock, POST `/chat` com o gatilho, ler `souls/main/sessoes/<hoje>.md`, `assert.match(audit, /skills: ativadas/)` e `/gatilho/`).
- [ ] **Step 2: fails** — sem a entrada no audit.
- [ ] **Step 3: implement** os 3 arquivos.
- [ ] **Step 4: passes** — `node --test packages/daemon/dist/test/skills-prompt.test.js` + memory suite (`agent-workflow` não deve regredir).
- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/agent-workflow.ts packages/daemon/src/langgraph-runner.ts packages/daemon/src/routes/chat.ts packages/daemon/src/test/skills-prompt.test.ts
git commit -m "feat(skills): skills no agente LangGraph + audit trail 'skills: ativadas'"
```

---

## Task 7: Tools MCP `skill_list` / `skill_create`

**Files:**
- Modify: `packages/tools/src/index.ts` (defs + dispatcher + `SOUL_SCOPED_TOOLS`)
- Modify: `packages/core/src/policy.ts` (catálogo)
- Modify: `packages/tools/src/test/tools.test.ts` (+testes)

**Interfaces:**
- Consumes: `scanSkillDirs`, `resolveSkillPath`, `parseSkillFrontmatter`, `listSkills` (core); helper de escrita atômica (novo, `writeSkillFile` em `core/skills.ts` — temp dir + `rename`, retorna `{ created:true; path } | { ok:false; code; reason }`); `computePlanHash`/`canonicalJsonStringify` (padrão do `soul_create`).
- `skill_list` (**L1**, não soul-scoped — leitura): params `{ soul? }`. Retorno `{ skills: [{ name, description, scope, tools, inAllowlist }] }` — junta `scanSkillDirs` (parseando cada) com a allowlist da soul (`inAllowlist`).
- `skill_create` (**L3**, soul-scoped via `authorizeAgentSoul`): params `{ name, description, body, keywords?, tools?, scope?, soul?, dry_run?, plan_hash? }`. `dry_run` default `true`. Monta o conteúdo `SKILL.md`, roda `parseSkillFrontmatter` para validar, calcula `plan_hash` sobre `{ name, description, keywords, tools, scope, bodyHash }`. dry-run → `{ dry_run:true, plan_hash, issues, would_write: path }`. commit → exige `plan_hash` igual → `writeSkillFile` → `{ created:true, path }`.
- `policy.ts`: `{ pattern: "skill_list", level: "L1" }`, `{ pattern: "skill_create", level: "L3" }`. `SOUL_SCOPED_TOOLS` += `"skill_create"`.

- [ ] **Step 1: failing tests** (em `tools.test.ts`, estilo dos testes de `soul_create`):
  - `tools/list` inclui `skill_list` e `skill_create`.
  - `skill_list` responde `{ skills: [...] }` com `inAllowlist` correto (criar 1 skill na allowlist + 1 fora).
  - `skill_create` `dry_run:true` → `plan_hash` + não escreve; `dry_run:false` + hash errado → erro; hash certo → cria `SKILL.md` no path esperado; sem `AGENT_SOUL_ID` → negado.
- [ ] **Step 2: fails**.
- [ ] **Step 3: implement** (`writeSkillFile` em core primeiro; depois as tools + catálogo).
- [ ] **Step 4: passes** — `DATABASE_URL=... node --test packages/tools/dist/test/tools.test.js` + `packages/core/dist/test/skills.test.js`.
- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/index.ts packages/core/src/policy.ts packages/core/src/skills.ts packages/tools/src/test/tools.test.ts
git commit -m "feat(skills): tools MCP skill_list (L1) e skill_create (L3, dry-run/plan_hash)"
```

---

## Task 8: CLI `os skill` + docs

**Files:**
- Modify: `packages/cli/src/index.ts` (`case "skill"`)
- Modify: `packages/cli/src/test/*` (smoke) — ou `cli.test.ts` se existir
- Modify: `README.md` (seção Soul System + CLI + F5), `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `scanSkillDirs`, `listSkills`, `resolveSkillPath`, `parseSkillFrontmatter`, `writeSkillFile` (core).
- `os skill list [--soul <id>]` → tabela nome/escopo/allowlist/tools.
- `os skill show <name> [--soul <id>]` → frontmatter + corpo.
- `os skill create <name> --desc "<...>" [--scope soul|global] [--soul <id>] [--tools a,b] [--keywords x,y] [--body-file <path>]` → escreve direto (CLI é operador confiável; sem dry-run).

- [ ] **Step 1: failing test** — smoke: `os skill list` num home temp com 1 skill imprime o nome; `os skill create` cria o arquivo. (Se `packages/cli` não tem infra de teste com home temp, usar `child_process` como os testes existentes de cli, ou testar as funções extraídas.)
- [ ] **Step 2: fails**.
- [ ] **Step 3: implement** o comando + atualizar `README.md` (bullet em Soul System: "Skills por soul: `SKILL.md` global ou por-soul, injetadas no prompt por relevância; allowlist em `agent.permissions.skills`"; adicionar `os skill` na lista da CLI; F5 → skills implementadas) e `docs/ROADMAP.md` (marcar "Skills por soul" concluído + referência à spec).
- [ ] **Step 4: passes** + suíte cli verde.
- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/test README.md docs/ROADMAP.md
git commit -m "feat(skills): CLI os skill + docs"
```

---

## Task 9: Regressão + verificação end-to-end

- [ ] **Step 1:** `npm run build && npm run typecheck` — limpos.
- [ ] **Step 2:** Suítes completas com `DATABASE_URL` do `.env`, `unset OLLAMA_URL REDIS_URL RAG_RERANK RAG_INJECTION_MODO PROMPT_INJECTION_MODO SKILLS_ENABLED SKILL_MATCH_THRESHOLD ASSISTENTE_OS_HOME`:
  `node --test "packages/{core,memory,daemon,tools,cli}/dist/test/**/*.test.js"` — tudo verde. Contagem esperada: core +~16, daemon +~4, tools +~3.
- [ ] **Step 3:** Verificação manual do spec §"Verificação end-to-end" (criar `~/.assistant-os/skills/teste-skill/SKILL.md`, allowlist numa soul, `os skill list`, `GET /souls/<id>/buffer?prompt=...` com e sem gatilho, checar audit trail).
- [ ] **Step 4:** `superpowers:finishing-a-development-branch` — fast-forward `feat/skills-por-soul` → `main` (padrão da sessão; sem push).

---

## Self-Review

**Spec coverage:** §1 formato→T1; §2 storage/allowlist→T2,T4; §3 loader/matcher→T2,T3; §4 prompt→T5,T6; §5 Zero Trust→T4 (renderer marca tool indisponível) + T5 (não altera allowlist); §6 MCP/CLI→T7,T8; §7 env→T3; testes→cada task; docs→T8. ✅

**Placeholder scan:** nenhum "TBD"/"TODO"; todos os steps de código têm bloco ou instrução concreta. T6/T8 descrevem o teste em prosa (não bloco) por dependerem de infra de teste existente do pacote — aceitável, o executor adapta ao padrão local.

**Type consistency:** `LoadedSkill`/`SkillMatch`/`SkillMatchOptions`/`ParseResult` definidos em T1–T3 e usados coerentes em T4–T8. `renderSkillsPrompt(available, active, isToolAllowed)` idem. `BuiltPrompt.skills` shape `{ available: string[]; active: {name,score,usedEmbedding}[] }` consistente entre T5 e T6.
