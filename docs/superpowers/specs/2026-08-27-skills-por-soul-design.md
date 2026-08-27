# Skills por soul — design

**Data:** 2026-08-27 · **Status:** aprovado (aguarda review do texto) · **Fase F5** (última pendência de código do roadmap E1–E10)

## Contexto

Hoje `AgentConfig.permissions.skills: string[]` (`packages/core/src/types/agent.ts:31`)
e `SoulSpec.skills` (`soul-spec.ts:56`) existem só como **allowlist de nomes,
inerte** — nada carrega nem usa. O comentário no código aponta para
`.opencode/skills/`, mas esses são consumidos pelo opencode, não por este
codebase. O README (F5) e o roadmap listam "skills por soul" como não iniciado.

O objetivo é dar a cada soul **instruções declarativas versionadas** — blocos de
conhecimento/procedimento reutilizáveis (estilo skills do opencode/Claude Code)
que entram no prompt **só quando relevantes**, mantendo o buffer enxuto
(lembrar: `ctx` default do Ollama é 2048 tokens).

## Decisões (do brainstorming)

1. **Uma skill = instruções markdown + `tools` declaradas** (frontmatter YAML +
   corpo). As `tools` são **advisórias** — não elevam a allowlist da soul; o
   Zero Trust (`isToolAllowed`/`authorizeTool`) continua sendo a autoridade.
2. **Ativação por relevância**: cada skill tem um `description` curto; o loader
   injeta o corpo só quando o prompt casa, via **híbrido léxico + embedding**
   (score de embedding reaproveita o `cache` de embeddings existente; auto-skip
   para só-léxico se o embedder falhar). O índice de skills disponíveis (nome +
   description) é **sempre** injetado, para o modelo saber o que existe.
3. **Storage global + por-soul**: `~/.assistant-os/skills/<name>/SKILL.md`
   (compartilhadas) + `~/.assistant-os/souls/<id>/skills/<name>/SKILL.md`
   (específicas). `SoulSpec.skills` vira a allowlist; resolução per-soul → global.
4. **Entrega completa**: formato + loader + integração no `buildPrompt` (chat,
   events, agenda) e no agente LangGraph + tools MCP (`skill_list`, `skill_create`)
   + CLI (`os skill …`).

## 1. Formato — `SKILL.md`

Frontmatter YAML **flat** delimitado por `---`, seguido do corpo markdown:

```markdown
---
name: sales-followup
description: Redigir follow-up de reunião comercial — recap, próximos passos, e-mail pós-call
keywords: [follow-up, follow up, recap, pós-call, próximos passos, ata]
tools: [sales_get_lead_brief, soul_anotar]
---
Ao redigir um follow-up de reunião:

1. Comece pelos itens de decisão, não pelo relato cronológico.
2. ...
```

- **`name`** (obrigatório): slug `^[a-z0-9][a-z0-9-]{1,63}$`. Deve bater com o nome do diretório.
- **`description`** (obrigatório): 1 linha, ≤ 280 chars. É o que o matcher usa e o que aparece no índice.
- **`keywords`** (opcional): lista de gatilhos léxicos explícitos (frases OK).
- **`tools`** (opcional): lista de nomes de tools MCP — **advisório**.
- **Corpo**: markdown livre. Limite: `maxFileBytes` do `SoulSpec` (32 KB) para o arquivo inteiro.

**Parser:** um mini-parser de frontmatter flat (`parseSkillFrontmatter`) em
`packages/core/src/skills.ts` — suporta `key: string`, `key: [a, b]` e
`key:\n  - a\n  - b`. Sem dependência de YAML (schema é minúsculo e plano; se um
dia precisar de YAML aninhado, aí sim adiciona `yaml`).

## 2. Storage, descoberta e allowlist

| Local | Path |
|---|---|
| Global | `~/.assistant-os/skills/<name>/SKILL.md` |
| Por-soul | `~/.assistant-os/souls/<id>/skills/<name>/SKILL.md` |

- `SOUL_SUBDIRS` (`souls.ts:41`) ganha `"skills"`; `createSoulFull` passa a criar o diretório.
- **Allowlist**: `SoulSpec.skills: string[]` / `AgentConfig.permissions.skills`.
  Uma skill só é carregada se o nome estiver na allowlist **e** resolver para um
  arquivo. Resolução: per-soul primeiro, senão global.
- `validateSoulSpec`: cada nome em `skills` deve resolver para um `SKILL.md`
  existente e parseável (novo issue `skill não encontrada / inválida`). Requer
  passar `home` ou um resolver — assinatura de `validateSoulSpec` ganha
  `opts.skillResolver?: (name: string) => boolean` (default: sempre true, para
  não quebrar os testes puros existentes; a tool `soul_create` passa o resolver real).

## 3. Loader + matcher — `packages/core/src/skills.ts` (novo)

```ts
export interface SkillFrontmatter {
  name: string;
  description: string;
  keywords: string[];       // [] se ausente
  tools: string[];          // [] se ausente
}
export interface LoadedSkill extends SkillFrontmatter {
  scope: "soul" | "global";
  path: string;             // caminho do SKILL.md
  body: string;             // markdown sem o frontmatter
  bytes: number;
}
export interface SkillMatch {
  skill: LoadedSkill;
  score: number;
  lexicalHits: string[];    // termos/keywords que casaram (debug)
  usedEmbedding: boolean;
}

/** Erros de parse acumulados, nunca lança (dry-run precisa reportar todos). */
export function parseSkillFrontmatter(raw: string):
  | { ok: true; frontmatter: SkillFrontmatter; body: string }
  | { ok: false; issues: string[] };

/** Skills da allowlist da soul, resolvidas (per-soul → global), com cache por mtime. */
export function listSkills(home: string, soul: Soul): LoadedSkill[];

/** Só os metadados (name/description/scope) — para o índice sempre-injetado. */
export function listSkillMeta(home: string, soul: Soul): Array<Pick<LoadedSkill, "name" | "description" | "scope">>;

export interface SkillMatchOptions {
  threshold?: number;   // env SKILL_MATCH_THRESHOLD, default 0.35
  max?: number;         // env SKILL_MAX_ACTIVE, default 3
  /** Injetável para teste / auto-skip. Recebe textos, devolve vetores. undefined = só-léxico. */
  embed?: (texts: string[]) => Promise<number[][]>;
}

export async function matchSkills(
  prompt: string,
  skills: LoadedSkill[],
  opts?: SkillMatchOptions,
): Promise<SkillMatch[]>;
```

### Algoritmo do matcher (híbrido)

Para cada skill:

1. **Léxico** (`0..1`): normaliza `prompt` e `description + keywords` (lowercase,
   sem acento, tokeniza, remove stopwords PT curtas). `lex = |tokens(prompt) ∩ tokens(skill)| / |tokens(skill)|`,
   com **boost** se alguma `keyword` (frase inteira) for substring do prompt normalizado (`lex = max(lex, 0.6)` nesse caso).
2. **Embedding** (`0..1`, opcional): se `opts.embed` disponível —
   `emb = cosine(embed(prompt), embed(skill.description))`. O vetor da description
   vem do cache: `cache.getEmbedding(sha1(description))` → se miss, `opts.embed([description])` + `cache.setEmbedding(...)`.
   Qualquer falha (`embed` lança / cache lança) → `usedEmbedding = false`, segue só com `lex`.
3. **Score final**: `score = usedEmbedding ? 0.5*lex + 0.5*emb : lex`.
   (Espelha a proporção da busca híbrida do RAG; ajustável por env `SKILL_LEX_WEIGHT` se preciso — fora do MVP.)
4. Ordena desc, filtra `score >= threshold`, corta em `max`.

Puro e determinístico no caminho léxico → testável no CI sem rede.

## 4. Integração no prompt

### `packages/daemon/src/context.ts` (`buildPrompt`)

Nova seção `skillsCtx`, inserida em `prefixParts` **entre `almaCtx` e `ragCtx`**:

```
## Skills disponíveis (ative mentalmente a que se aplica)
- sales-followup — Redigir follow-up de reunião comercial (recap, próximos passos)
- code-review — Revisar diff em busca de bugs e simplificações
...

## Skill ativa: sales-followup
<corpo completo da skill>
Ferramentas relevantes: `sales_get_lead_brief`, `soul_anotar`
  (`nome-de-tool-x` — indisponível para esta soul)
```

- O **índice** lista todas as skills da allowlist (nome + description).
- O **corpo** só das que `matchSkills` devolveu.
- "Ferramentas relevantes": as `skill.tools` — cruzadas com `resolveAllowedTools(soul.config.agent)`;
  as fora da allowlist recebem o sufixo `(indisponível para esta soul)`.
- `BuiltPrompt` ganha `skills: { available: string[]; active: SkillMatch[] }` para o
  buffer inspector e para o chat.ts logar no audit trail (novo `intention: "skills: ativadas"`).
- `buildPrompt` chama `matchSkills(prompt, listSkills(home, soul), { embed: makeEmbedFn() })`
  onde `makeEmbedFn` embrulha `getEmbedder()` de `@assistente-os/memory`.
  → cria dependência daemon→memory (já existe) e core→(nada novo: `skills.ts` não importa memory; o `embed` é injetado pelo daemon).

### Agente LangGraph (`packages/memory/src/agent-workflow.ts`)

`buildGenerateNode` monta o `ChatPromptTemplate`. Adicionar as skills ao system
message: o `runRagChain`/`runAgent` recebe `soul` (string) — precisa de `home` e do
`Soul`. Opção mínima: `runLangGraphAgentStream` (daemon, tem `home`) resolve as
skills e passa `skillsPreamble: string` para `runAgentStream` → injetado no
`initialState.messages[0]` (system). Mantém o matcher no daemon, o agente só recebe texto.

### Cobertura

`events.ts` e `agenda.ts` já chamam `buildPrompt` → cobertos automaticamente.

## 5. Zero Trust

- `skill.tools` **nunca** altera `resolveAllowedTools` / `isToolAllowed`.
- Renderizado como texto informativo; tools fora da allowlist da soul são marcadas.
- Sem gate novo na "ativação" (a ativação é só injeção de texto — risco = o de
  qualquer instrução no prompt, já coberto pelo detector de prompt injection que
  **também roda** sobre o corpo? → **não** no MVP: o corpo da skill é conteúdo
  curado pelo dono da soul, mesmo status do `perfil.md`. Anotar como decisão.)

## 6. MCP + CLI

### Tools (`packages/tools/src/index.ts`)

| Tool | Nível | Params | Retorno |
|---|---|---|---|
| `skill_list` | **L1** | `{ soul? }` | `{ skills: [{ name, description, scope, tools, inAllowlist }] }` — todas as skills visíveis (allowlist + as que existem mas não estão na allowlist, marcadas) |
| `skill_create` | **L3** | `{ name, description, body, keywords?(csv), tools?(csv), scope?("soul"\|"global", default "soul"), soul?, dry_run?(bool, default true), plan_hash? }` | dry-run: `{ dry_run:true, plan_hash, issues, would_write }` · commit: `{ created:true, path }` — padrão idêntico ao `soul_create` (guarda de `plan_hash`, `authorizeAgentSoul`) |

- `soul_create_wire.ts` já mapeia CSV; reusar o helper.
- `SOUL_SCOPED_TOOLS` += `skill_create`. `policy.ts` catálogo += `skill_list` (L1), `skill_create` (L3).
- Escrita atômica: mesmo padrão de `createSoulFull` (temp dir + `rename`).

### CLI (`packages/cli/src/index.ts`)

```
os skill list [--soul <id>]        lista skills (escopo, allowlist, tools)
os skill show <name> [--soul <id>] frontmatter + corpo de uma skill
os skill create <name> --desc "..." [--scope soul|global] [--soul <id>] [--tools a,b] [--keywords x,y] [--body-file path]
```

## 7. Config (env)

| Var | Default | Efeito |
|---|---|---|
| `SKILL_MATCH_THRESHOLD` | `0.35` | score mínimo para injetar o corpo |
| `SKILL_MAX_ACTIVE` | `3` | teto de skills ativadas por turno |
| `SKILLS_ENABLED` | `1` | `0` desliga tudo (só o índice deixa de aparecer também) |

## Contratos novos — resumo

- `core/src/skills.ts` (novo): `parseSkillFrontmatter`, `listSkills`, `listSkillMeta`, `matchSkills`, tipos acima, `skillMatchThreshold()`, `skillMaxActive()`.
- `core/src/souls.ts`: `SOUL_SUBDIRS` += `"skills"`; helper `resolveSkillPath(home, soulId, name): string | null`.
- `core/src/soul-spec.ts`: `validateSoulSpec` aceita `opts.skillResolver?`.
- `core/src/policy.ts`: catálogo += `skill_list` L1, `skill_create` L3.
- `daemon/src/context.ts`: `BuiltPrompt.skills`; `skillsCtx` no prompt.
- `daemon/src/langgraph-runner.ts`: resolve skills → `skillsPreamble` para o agente.
- `daemon/src/routes/chat.ts`: audit trail `skills: ativadas` (nomes + score).
- `tools/src/index.ts`: `skill_list`, `skill_create` + wire.
- `cli/src/index.ts`: comando `skill`.

## Testes

| Arquivo | Cobre |
|---|---|
| `core/src/test/skills.test.ts` (novo) | parse frontmatter (válido / faltando `name` / `description` longa demais / `tools` não-lista); `listSkills` resolução per-soul → global + allowlist; `matchSkills` léxico determinístico (keyword substring → boost; overlap; threshold; `max`); auto-skip quando `embed` lança; limites de tamanho |
| `daemon/src/test/skills-prompt.test.ts` (novo) | `buildPrompt` injeta o índice sempre; injeta o corpo só da skill que casa; skill fora da allowlist não entra; `BuiltPrompt.skills` populado; `SKILLS_ENABLED=0` remove a seção |
| `tools/src/test/tools.test.ts` (+) | `skill_list` em `tools/list` + responde; `skill_create` dry-run não escreve, commit exige `plan_hash`, exige `AGENT_SOUL_ID` (L3); Zero Trust (fora da allowlist → não aparece) |
| `cli/src/test/*` | smoke `os skill list` / `os skill create` |
| `core` regressão | `soul-spec.test.ts` — `skillResolver` default não quebra os testes puros; `souls.test.ts` — `createSoulFull` cria `skills/` |

## Fora de escopo (fase 2)

- Rerank/matcher por LLM.
- Skill que carrega/executa código (só instruções por ora).
- Detector de prompt injection sobre o corpo da skill (curado pelo dono; revisitar se skills vierem de fonte não confiável).
- Versionamento/semver de skills; `skill_delete`/`skill_update` (por ora edita-se o `.md` na mão + reindex implícito por mtime/hash).
- UI web para skills.

## Verificação end-to-end

1. `npm run build && npm run typecheck` limpos.
2. `node --test packages/core/dist/test/skills.test.js` + suítes core/daemon/tools/cli verdes.
3. Manual:
   - `mkdir -p ~/.assistant-os/skills/teste-skill && printf -- '---\nname: teste-skill\ndescription: responde sempre começando com PREFIXO-SKILL\nkeywords: [gatilho-x]\n---\nComece toda resposta com "PREFIXO-SKILL:".\n' > ~/.assistant-os/skills/teste-skill/SKILL.md`
   - adicionar `teste-skill` ao `agent.permissions.skills` de uma soul.
   - `os skill list --soul <id>` → mostra `teste-skill (global, allowlist ✓)`.
   - `os daemon`; `GET /souls/<id>/buffer?prompt=isso%20tem%20gatilho-x` → o `systemPrompt` contém `## Skill ativa: teste-skill` e o corpo.
   - `GET /souls/<id>/buffer?prompt=pergunta%20qualquer` → só o índice `## Skills disponíveis`, sem o corpo.
   - `POST /souls/<id>/chat {"prompt":"... gatilho-x ..."}` → audit trail (`sessoes/<hoje>.md`) tem `### Auditoria — skills: ativadas` com `teste-skill`.

## Critério de conclusão

- Skill em `SKILL.md` (global ou por-soul) na allowlist da soul é descoberta,
  validada e — quando o prompt casa — tem o corpo injetado no prompt de chat,
  eventos, agenda e do agente LangGraph.
- O índice nome+description das skills da allowlist aparece sempre.
- `skill.tools` é advisório; não eleva a allowlist (teste).
- `skill_list`/`skill_create` (MCP) + `os skill` (CLI) funcionam, com o mesmo
  padrão de dry-run/commit/`plan_hash`/L3 do `soul_create`.
- `SoulSpec` valida nomes de skills contra arquivos existentes.
- README (F5 / seção Soul System) e `docs/ROADMAP.md` atualizados.
