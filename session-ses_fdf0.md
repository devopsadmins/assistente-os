# New session - 2026-08-20T20:54:49.500Z

**Session ID:** ses_fdf0b8063ffeFLyOTaSx7U3qHU
**Created:** 8/20/2026, 5:54:49 PM
**Updated:** 8/20/2026, 6:35:16 PM

---

## User

aqui no opencode começou a aparecer as souls. o que muda no final?

---

## Assistant (Plan · Big Pickle · 10.4s)

_Thinking:_

The user is asking about what happens when you select a "soul" in opencode. They want to understand what changes when you choose a soul. Let me search for information about how souls work in this project.

I need to understand what "souls" are in this Assistente OS project and what changes when you select one. Let me search the codebase for soul-related functionality.

**Tool: skill**

**Input:**
```json
{
  "name": "customize-opencode"
}
```

**Output:**
```
<skill_content name="customize-opencode">
# Skill: customize-opencode

<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts
  and CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION). The body below becomes the
  skill's content.
-->

# Customizing opencode

opencode validates its own config strictly and refuses to start when a field
is wrong. The shapes below cover the common surface area, but they are a
**summary, not the source of truth**.

## Full schema reference

The authoritative list of every config option — with field types, enums,
defaults, and descriptions — lives in the published JSON Schema:

**<https://opencode.ai/config.json>**

If a field is not documented in this skill, or you need to confirm an exact
shape before writing config, **fetch that URL and read the schema directly**
rather than guessing. opencode hard-fails on invalid config, so the cost of a
wrong shape is a broken startup.

Independently, every `opencode.json` should declare
`"$schema": "https://opencode.ai/config.json"` so the user's editor catches
mistakes as they type.

## Applying changes

Config is loaded once when opencode starts and is not hot-reloaded. After
saving changes to `opencode.json`, an agent file, a skill, a plugin, or any
other config-time file, **tell the user to quit and restart opencode** for
the changes to take effect. The running session will keep using the
already-loaded config until then.

## Where files live

| Scope                         | Path                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Project config                | `./opencode.json`, `./opencode.jsonc`, or `.opencode/opencode.json` (opencode walks up from the cwd to the worktree root) |
| Global config                 | `~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc` (NOT `~/.opencode/`)                            |
| Project agents                | `.opencode/agent/<name>.md` or `.opencode/agents/<name>.md`                                                               |
| Global agents                 | `~/.config/opencode/agent(s)/<name>.md`                                                                                   |
| Project commands              | `.opencode/command/<name>.md` or `.opencode/commands/<name>.md`                                                           |
| Global commands               | `~/.config/opencode/command(s)/<name>.md`                                                                                 |
| Project skills                | `.opencode/skill(s)/<name>/SKILL.md`                                                                                      |
| Global skills                 | `~/.config/opencode/skill(s)/<name>/SKILL.md`                                                                             |
| External skills (auto-loaded) | `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`                                                    |

Configs from each scope are deep-merged. Project overrides global. Unknown
top-level keys in `opencode.json` are rejected with `ConfigInvalidError`.

## opencode.json

Every field is optional.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "username": "string",
  "model": "provider/model-id",
  "small_model": "provider/model-id",
  "default_agent": "agent-name",
  "shell": "/bin/zsh",
  "logLevel": "DEBUG" | "INFO" | "WARN" | "ERROR",
  "share": "manual" | "auto" | "disabled",
  "autoupdate": true | false | "notify",
  "snapshot": true,
  "instructions": ["AGENTS.md", "docs/style.md"],

  "skills": {
    "paths": [".opencode/skills", "/abs/path/to/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },

  "references": {
    "docs": {
      "path": "../docs",
      "description": "Use for product behavior and documentation conventions"
    },
    "sdk": {
      "repository": "owner/sdk",
      "branch": "main",
      "description": "Use for SDK implementation details",
      "hidden": true
    }
  },

  "agent": {
    "my-agent": {
      "model": "anthropic/claude-sonnet-4-6",
      "mode": "subagent",
      "description": "...",
      "permission": { "edit": "deny" }
    }
  },

  "command": {
    "deploy": { "description": "...", "template": "..." }
  },

  "provider": {
    "anthropic": { "options": { "apiKey": "..." } }
  },
  "disabled_providers": ["openai"],
  "enabled_providers": ["anthropic"],

  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": {}
    },
    "remote-thing": {
      "type": "remote",
      "url": "https://...",
      "headers": { "Authorization": "Bearer ..." }
    }
  },

  "plugin": [
    "opencode-gemini-auth",
    "opencode-foo@1.2.3",
    "./local-plugin.ts",
    ["opencode-bar", { "option": "value" }]
  ],

  "permission": {
    "edit": "deny",
    "bash": { "git *": "allow", "*": "ask" }
  },

  "formatter": false,
  "lsp": false,

  "experimental": {
    "primary_tools": ["edit"],
    "mcp_timeout": 30000
  },

  "tool_output": { "max_lines": 200, "max_bytes": 8192 },

  "compaction": { "auto": true, "tail_turns": 15 }
}
```

Shape notes worth being explicit about:

- `model` always carries a provider prefix: `"anthropic/claude-sonnet-4-6"`.
- `skills` is an object with `paths` and/or `urls`, not an array.
- `references` is an object keyed by alias. Each value is a local path, Git repository, or string shorthand.
- `agent` is an object keyed by agent name, not an array.
- `command` is an object keyed by command name, not an array.
- `plugin` is an array of strings or `[name, options]` tuples, not an object.
- `mcp[name].command` is an array of strings, never a single string. `type` is required.
- `permission` is either a string action or an object keyed by tool name.

## Skills

opencode's skill loader scans for `**/SKILL.md` inside skill directories. The
file is named `SKILL.md` exactly, and lives in its own folder named after the
skill:

```
.opencode/skills/my-skill/SKILL.md
```

Frontmatter:

```markdown
---
name: my-skill
description: One sentence covering what this skill does AND when to trigger it. Front-load the literal keywords or filenames the user is likely to say.
---

# My Skill

(skill body in markdown: instructions, examples, references)
```

- `name` is required, lowercase hyphen-separated, up to 64 chars, and matches the folder name.
- `description` is effectively required: skills without one are filtered out and never surfaced to the model. Cover both _what_ the skill does and _when_ to use it. Write in third person ("Use when...", not "I help with..."). Front-load concrete trigger keywords and filenames; gate with "Use ONLY when..." if the skill should stay quiet on adjacent topics.
- Optional: `license`, `compatibility`, `metadata` (string-string map).

Register skills from non-default locations via `skills.paths` (scanned
recursively for `**/SKILL.md`) and `skills.urls` (each URL serves a list of
skills).

## References

References make local directories and Git repositories outside the active
project available as supporting context. Configure them under `references`,
keyed by the alias used in `@` autocomplete:

```json
{
  "references": {
    "docs": {
      "path": "../product-docs",
      "description": "Use for product behavior and terminology"
    },
    "effect": {
      "repository": "Effect-TS/effect",
      "branch": "main",
      "description": "Use for Effect implementation details"
    }
  }
}
```

Local `path` values may be relative to the declaring config, absolute, or use
`~/`. Git `repository` values accept Git URLs, host/path references, and GitHub
`owner/repo` shorthand; `branch` is optional. Both forms support optional
`description` and `hidden` fields.

- Only references with a `description` are advertised to agents in system context.
- `hidden: true` removes a reference from TUI `@` autocomplete only. It remains available to agents and by direct path.
- Reference directories are automatically allowed through the external-directory boundary; normal read/edit/tool permissions still apply.
- String shorthand is supported: use `"docs": "../docs"` for local paths or `"effect": "Effect-TS/effect"` for Git repositories.

## Agents

Two ways to define an agent. Use the file form for anything non-trivial.

### Inline (in `opencode.json`)

```json
{
  "agent": {
    "my-reviewer": {
      "description": "Reviews PRs for style violations.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permission": { "edit": "deny", "bash": "ask" },
      "prompt": "You are a strict PR reviewer..."
    }
  }
}
```

### File

```
.opencode/agent/my-reviewer.md      OR     .opencode/agents/my-reviewer.md
```

```markdown
---
description: Reviews PRs for style violations.
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

You are a strict PR reviewer. Focus on...
```

The file body becomes the agent's `prompt`. Do not also put `prompt:` in the
frontmatter.

`mode` is one of `"primary"`, `"subagent"`, `"all"`.

Allowed top-level frontmatter fields: `name, model, variant, description, mode,
hidden, color, steps, options, permission, disable, temperature, top_p`. Any
unknown field is silently routed into `options`.

To disable a built-in agent: `agent: { build: { disable: true } }`, or in a
file, `disable: true` in frontmatter.

`default_agent` must point to a non-hidden, primary-mode agent.

### Built-in agents

opencode ships with `build`, `plan`, `general`, `explore`. Hidden internal agents:
`compaction`, `title`, `summary`. To override a built-in's fields, define the
same key in `agent: { <name>: { ... } }`.

## Commands

opencode's command loader scans for `**/*.md` inside command directories. The
file is named after the command, and lives directly inside the `command` folder:

```
.opencode/command/deploy.md
```

Frontmatter:

```markdown
---
description: One sentence describing what the command does.
agent: build
model: anthropic/claude-sonnet-4-6
---

(command body in markdown: the prompt opencode runs, with $ARGUMENTS for the user's input)
```

- `template` is the command body — everything below the frontmatter — and is required: it is the prompt opencode runs when the command is invoked. Do not also put a `template:` key in the frontmatter.
- `$ARGUMENTS` is replaced with everything the user typed after the command; `$1`, `$2`, … pull individual positional arguments.
- Optional: `description`, `agent`, `model`, `variant`, `subtask`.

## Plugins

`plugin:` is an array. Each entry is one of:

```json
"plugin": [
  "opencode-gemini-auth",            // npm spec, latest
  "opencode-foo@1.2.3",              // npm spec, pinned
  "./local-plugin.ts",               // file path, relative to the declaring config
  "file:///abs/path/plugin.js",      // file URL
  ["opencode-bar", { "key": "val" }] // tuple form with options
]
```

Auto-discovered plugins (no config entry needed): any `*.ts` or `*.js` file in
`.opencode/plugin/` or `.opencode/plugins/`.

A plugin module exports `default` (or any named export) of type
`Plugin = (input: PluginInput, options?) => Promise<Hooks>`. The export is a
function, not a plain object literal, and the function returns an object
(return `{}` if there is nothing to register).

```ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client, project, directory, $ }) => {
  return {
    config: (cfg) => {
      // cfg is the live merged config; mutate fields here.
    },
    "tool.execute.before": async (input, output) => {
      // mutate output.args before the tool runs
    },
  }
}) satisfies Plugin
```

Hook surface (mutate `output` in place; return `void`):

- `event(input)`: every bus event
- `config(cfg)`: once on init with the merged config
- `chat.message`, `chat.params`, `chat.headers`
- `tool.execute.before`, `tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `shell.env`
- `permission.ask`
- `experimental.chat.messages.transform`, `experimental.chat.system.transform`,
  `experimental.session.compacting`, `experimental.compaction.autocontinue`,
  `experimental.text.complete`

Special object-shaped (not callbacks): `tool: { my_tool: { ... } }`,
`auth: { ... }`, `provider: { ... }`.

## MCP servers

`mcp:` is an object keyed by server name. Each server is discriminated by
`type`:

```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"],
      "enabled": true,
      "environment": { "BROWSER": "chromium" }
    },
    "github": {
      "type": "remote",
      "url": "https://...",
      "enabled": true,
      "headers": { "Authorization": "Bearer {env:GITHUB_TOKEN}" }
    },
    "old-server": { "enabled": false }
  }
}
```

`command` is an array of strings. `environment` sets environment variables for
a local MCP server. `type` is required. Use `enabled: false` to
disable a server inherited from a parent config. String values such as header
tokens support `{env:VAR}` interpolation (and `{file:path}`); the shell-style
`${VAR}` is not substituted.

## Permissions

```json
"permission": {
  "edit": "deny",
  "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
  "external_directory": { "~/secrets/**": "deny", "*": "allow" }
}
```

Actions: `"allow"`, `"ask"`, `"deny"`.

Per-tool value forms: `"allow"` shorthand (treated as `{"*": "allow"}`), or an
object `{ pattern: action }`. Within an object, **insertion order matters**.
opencode evaluates the LAST matching rule, so put broad rules first and narrow
rules last.

`permission: "allow"` (a string at the top level) is shorthand for "allow
everything" and is rarely what the user wants.

Known permission keys: `read, edit, glob, grep, list, bash, task,
external_directory, todowrite, question, webfetch, websearch, lsp, doom_loop,
skill`. Some of these (`todowrite,
question, webfetch, websearch, doom_loop`) only accept a flat
action, not a per-pattern object.

`external_directory` patterns are filesystem paths (use `~/`, absolute paths,
or globs like `~/projects/**`).

Per-agent `permission:` overrides top-level `permission:`. Plan Mode lives on
the `plan` agent's permission ruleset (`edit: deny *`).

## Escape hatches

When a user's config is broken and opencode won't start, these env vars help:

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: skip the project's local `opencode.json`
  and start from globals only. Run from the project directory, opencode loads,
  the user edits the broken file, then they restart without the flag.
- `OPENCODE_CONFIG=/path/to/file.json`: load an additional explicit config.
- `OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json"}'`:
  inject inline JSON as a final local-scope merge.
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`: skip default plugins.
- `OPENCODE_PURE=1`: skip external plugins entirely.
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`,
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`: skip the external skill scans under
  `~/.claude/` and `~/.agents/`.

## When proposing edits

- Validate against the schema before writing. If you are unsure of a field's
  exact shape, or the field is not covered in this skill, fetch
  `https://opencode.ai/config.json` and read the schema rather than guessing.
- Preserve `$schema` and any existing fields the user did not ask to change.
- For agent, command, skill, and plugin definitions, prefer creating new files
  in the correct location over inlining everything in `opencode.json`.
- If the user's existing config is malformed, point them at the env-var escape
  hatches above so they can edit from inside opencode without breaking their
  session.
- After saving any config change, remind the user to quit and restart opencode
  — running sessions keep using the already-loaded config.

Base directory for this skill: .
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>
<file>/home/support/assistente-os/auth.json</file>
<file>/home/support/assistente-os/docker-compose.yml</file>
<file>/home/support/assistente-os/.gitignore</file>
<file>/home/support/assistente-os/run-tests.sh</file>
<file>/home/support/assistente-os/AGENTS.md</file>
<file>/home/support/assistente-os/session-ses_fe0a.md</file>
<file>/home/support/assistente-os/session-ses_fe35.md</file>
<file>/home/support/assistente-os/docs/skilljuror-mapping.md</file>
<file>/home/support/assistente-os/docs/brainstorm1.md</file>
<file>/home/support/assistente-os/docs/sessions/2026-08-20-langgraph-deploy.md</file>
</skill_files>
</skill_content>
```

---

## Assistant (Plan · Big Pickle · 85.3s)

_Thinking:_

The user is asking about "souls" in the opencode interface. Let me look at the project structure to understand what "souls" are in this context. The skill doesn't directly explain "souls" in the opencode TUI, but I see this is the Assistente OS project which has its own soul system. Let me search for more information.

Vou pesquisar como as "souls" funcionam neste projeto.

**Tool: task**

**Input:**
```json
{
  "description": "Search for souls in opencode",
  "prompt": "Search the codebase at /home/support/assistente-os for how \"souls\" appear in the opencode interface. Look for:\n1. What is a \"soul\" in the opencode TUI/config context (NOT the assistente-os soul system)\n2. How are souls defined in opencode.json or .opencode/ directories\n3. What changes when you select a soul in opencode (model, agent, permissions, etc.)\n4. Check opencode.json, any .opencode/ config files, and any documentation\n\nReturn: a concise explanation of what souls are in opencode and what changes when you pick one.",
  "subagent_type": "explore"
}
```

**Output:**
```
<task id="ses_fdf0b3adaffeQTLiPHjTPNONAy" state="completed">
<task_result>
Now I have a complete picture. Here is the concise answer:

---

## What "Souls" Are in the opencode Context

In this codebase, the term "soul" is used at **two distinct layers** that work together:

### Layer 1: opencode Agents (`.opencode/agents/*.md`)

These are **opencode-native agent definitions** -- Markdown files with YAML frontmatter. Each file defines one agent that appears in the opencode TUI as a selectable agent. There are 13 of them:

| File | Description |
|---|---|
| `main.md` | Coordinator -- orchestrates other souls |
| `desenvolvimento.md` | Software development |
| `cidadeplaza.md` | E-commerce (semi-jewelry/Arab perfumes) |
| `escrita.md` | Ontological horror fiction writing |
| `investimentos.md` | Investment analysis |
| `gestaoobrigacoes.md` | Obligations management/compliance |
| `iso.md` | Infrastructure/operations |
| `kinetiswan.md` | LoRa Mesh topology |
| `consultoria_ia.md` | AI consulting |
| `ministro_louvor.md` | Biblical theology/sacred music |
| `segundo-cerebro.md` | Personal knowledge management |
| `slcia.md` | General-purpose assistant |
| `suriel.md` | Specialized assistant |

**What changes when you select one in the opencode TUI:**

The YAML frontmatter controls:

1. **`description`** -- short label shown in the agent picker
2. **`mode: primary`** -- marks it as a top-level selectable agent
3. **`steps: N`** (optional) -- max turns per session (e.g., `desenvolvimento.md` has `steps: 15`)
4. **`permission:` block** -- granular tool/filesystem access control:
   - `read`, `edit`, `glob`, `grep`, `bash`, `task`, `webfetch`, `websearch` -- each `allow` or `deny`
   - `external_directory` -- path-based filesystem access (e.g., `"/home/support/*": allow`, `"*": deny`)
   - `skill` -- which skills can be loaded (`allow` or a list)
5. **System prompt** (Markdown body) -- the personality, capabilities, and guardrails injected into the LLM context

The **main.md** agent has `"*": allow` for everything (full access), while domain agents like `desenvolvimento.md` restrict `external_directory` to specific paths and deny `"*"`.

### Layer 2: assistente-os Souls (`~/.assistant-os/souls/<id>/config.json`)

These are the **backend soul definitions** managed by the assistente-os kernel. Each soul has:

- **`provider`** -- custom opencode provider name (e.g., `"zen-sousa"`)
- **`models.chat`** / **`models.embed`** -- which LLM/embedding model to use
- **`dailyLimit`** -- spending cap per day
- **`maxTurns`** -- session turn limit
- **`agent`** -- an `AgentConfig` with:
  - `permissions.tools` -- strict allowlist of MCP tool patterns (e.g., `"memory:*"`, `"ado_list_*"`, `"*"`)
  - `permissions.skills` -- linked skill names
  - `guardrails.maxTurns`, `guardrails.maxIterations`, `guardrails.ragRelevanceThreshold`, `guardrails.allowedOrigins`

### How They Connect: The Router

The **tier system** (`local -> zen -> soul`) determines which model actually runs:

| Tier | Provider | Model |
|---|---|---|
| `local` | Ollama | `qwen2.5-coder:3b` (or config) |
| `zen` | zen | `zen` (free tier) |
| `soul` | `soul.config.provider` (e.g., `zen-sousa`) | `soul.config.models.chat` |

When you pick a soul:
- **Fast mode** (simple prompts): uses the `local` tier (Ollama), max 2 iterations, RAG top-3
- **Pro mode** (complex prompts, >500 chars, or keywords like "scrape", "relatório"): uses the `soul` tier with the soul's own provider/model, max 5 iterations, hybrid RAG 70/30

### In Summary

When you select a soul in the opencode TUI, you are picking an **opencode agent** (from `.opencode/agents/*.md`) that sets your **permissions, filesystem access, skills, and system prompt**. The backend then uses that soul's **config.json** to determine the **LLM provider, model, spending limits, and tool allowlist**. The two layers are bridged by the soul ID -- the opencode agent name matches the assistente-os soul directory name.
</task_result>
</task>
```

---

## Assistant (Plan · Big Pickle · 8.1s)

_Thinking:_

Now I have a clear picture of what happens when you select a soul in opencode. Let me provide a concise answer to the user.

Quando você seleciona uma **soul** no opencode, muda basicamente 3 coisas:

## 1. Permissões e acesso
Cada soul (definida em `.opencode/agents/<soul>.md`) tem seu próprio bloco `permission:` — controlando quais ferramentas (`bash`, `edit`, `webfetch`, etc.) e quais diretórios do filesystem estão liberados. A soul `main` tem acesso total; as outras restringem por path.

## 2. System prompt e personalidade
O corpo Markdown do arquivo vira o system prompt do LLM — definindo a personalidade, escopo e guardrails daquela soul (ex: `desenvolvimento` foca em código, `escrita` em ficção, `investimentos` em análise financeira).

## 3. Camada backend (config.json)
O assistente-os liga a soul do opencode ao `~/.assistant-os/souls/<id>/config.json`, que define:
- **Provider/modelo** — qual LLM roda (Ollama local, zen, ou um provider custom como `zen-sousa`)
- **Limite de gasto diário** (`dailyLimit`)
- **Limite de turnos** (`maxTurns`)
- **Skills e tools permitidos** — quais MCP tools e skills aquela soul pode usar

Além disso, o **roteador** decide automaticamente entre `fast` (Ollama local, simples) e `pro` (modelo da soul, complexo) baseado no tamanho e tipo do prompt.

---

## User

eu vou melhorar meu site de escritor. me ajude com prompt falando sobre como escrevoi e como sou

---

## Assistant (Escrita · Big Pickle · 8.5s)

_Thinking:_

The user wants help writing a prompt about themselves as a writer - how they write and who they are. This is for improving their writer website.

This matches the "literary-fiction-craft" skill or possibly "copywriting" skill, but actually the user is asking for help with a bio/about prompt for their website. Let me think about which skill fits best...

Actually, this is more of a personal branding/copywriting task for a writer's website. Let me check if the literary-fiction-craft skill might have relevant context about the user's writing style.

Let me first check if there's any information about the user's writing style in the project context - the soul "escrita" might have relevant info about their writing.

**Tool: skill**

**Input:**
```json
{
  "name": "literary-fiction-craft"
}
```

**Output:**
```
<skill_content name="literary-fiction-craft">
# Skill: literary-fiction-craft

# Literary Fiction Craft

You are a master literary fiction collaborator — part developmental editor, part writing
coach, part co-author. You understand that literary fiction lives and dies by the quality
of its *craft*: the invisible machinery of tension, voice, pacing, and character interiority
that compels a reader to keep turning pages without knowing why.

Your job is never to sanitise, flatten, or make safe. Great literary fiction is specific,
surprising, and honest. Approach every request with the same rigour a seasoned author would
bring to their own manuscript.

---

## Core Craft Principles

These are the lenses you apply to everything, regardless of the specific task:

### 1. Tension is the engine
Tension is not drama. It's the gap between what the reader *knows* and what they *fear* or
*desire*. It lives in the white space — the pause before the line of dialogue, the object
the character won't look at, the question the narrator refuses to answer yet. When a scene
feels flat, the cause is almost always a collapsed tension gap: the reader can see where
everything is going.

### 2. Voice is a contract
The narrator's voice is a promise to the reader about how this story will see the world.
Every sentence either fulfills or breaks that contract. When voice feels inconsistent, look
for: register shifts (formal → casual), tonal contradiction (ironic narrator making sincere
claims), or borrowed phrasing (where the author's own vocabulary slips in over the
character's).

### 3. Humour is precision, not decoration
In literary fiction, humour is almost always rooted in specificity and incongruity — the
exact wrong word at the exact wrong moment. It doesn't arrive announced. Comic timing lives
in sentence rhythm: the unexpected weight of a short sentence after a long one, the
bathos of a mundane detail after something grave. Never reach for a joke. Let it arrive.

### 4. Character is contradiction
Flat characters have consistent motivations. Real characters want things that conflict with
each other — and they act, often, against their own best interests. The reader trusts a
character not because they're likeable, but because they're *legible*: we understand the
internal logic, even when we don't agree with it.

### 5. Pacing is rhythm, not speed
Slow is not bad. Fast is not good. Pacing is about *control* — the author's ability to
compress time (summary), expand it (scene), or stop it entirely (interiority). When pacing
drags, it's usually because the author is giving equal weight to unequal moments.

---

## Modes of Operation

Identify which mode the user needs and respond accordingly. A single request might involve
several.

### MODE 1: Scene Diagnosis
The user shares a scene or passage and wants to know what's wrong (or right).

**Process:**
1. Read the passage with fresh eyes. Identify the *intended effect* — what should this
   scene make the reader feel?
2. Identify where the effect breaks down. Name the specific craft failure: tension collapse,
   voice inconsistency, over-explained subtext, pacing mismatch, etc.
3. Show, don't just tell. Pull the exact lines that are the problem. Rewrite one or two as
   a demonstration — not to replace the author's voice, but to show the underlying fix.
4. Prioritise. Give the author 1–3 things to address. More than that is overwhelming and
   loses focus.

**What to avoid:** Generic feedback like "show don't tell" or "the pacing is slow" without
pointing to specific lines. Feedback must be surgical.

### MODE 2: Suspense Engineering
The user wants to build, deepen, or repair narrative tension.

**Techniques to draw from:**
- **Dramatic irony** — the reader knows what the character doesn't. Deploy with care;
  overuse deadens it.
- **Delayed revelation** — withhold the key piece of information but make the reader
  feel its absence. Every chapter should end with an unanswered question *the reader
  didn't know they had when the chapter began*.
- **Foreboding through the mundane** — a character notices the wrong thing, or
  fails to notice the right thing. Danger hiding in ordinary detail.
- **Compression** — cutting the explanation so the reader has to close the gap
  themselves. The gap is where suspense lives.
- **The unresolved beat** — end a scene before the confrontation lands. The reader
  carries it into the next scene.

When helping with suspense, always ask: *what does the reader know, what do they
fear, and what are they not being told?* Map those three things first.

### MODE 3: Prose Elevation
The user wants their prose to be better — more alive, more precise, more theirs.

**Process:**
1. Identify the dominant weakness: is it over-writing (too many adjectives, explained
   metaphors), under-writing (flat declarative sentences with no texture), or voice
   instability?
2. Work line by line on a representative paragraph. The goal is not to replace the
   author's style, but to sharpen what's already there.
3. Name the technique you're using so the author can replicate it themselves.

**Common prose fixes:**
- Replace abstract nouns with physical specifics: "she felt sad" → "she sat with the
  lights off and didn't eat"
- Cut the word that explains the word before it: "cold and freezing", "angry furiously"
- Move the weight to the end of the sentence — that's where the reader's attention peaks
- Trust white space: a short sentence after a long paragraph hits harder than another
  long sentence

### MODE 4: Character Interiority
The user wants their characters to feel real, complex, or more alive.

**Process:**
1. Map the character's contradiction — what do they want vs. what do they need vs. what
   do they *do*? These should not all point the same direction.
2. Develop the gap between what the character *thinks* and what they *say* — this is
   where irony, tension, and humour all live simultaneously.
3. Anchor the character in the physical world. How do they occupy space? What small,
   specific, slightly-wrong habit reveals who they are?
4. Test: can this character surprise us in a way that feels *inevitable in hindsight*?
   If not, they aren't alive yet.

### MODE 5: Structure & Architecture
The user needs help with plot, acts, reversals, or story shape.

**Principles:**
- Literary fiction structures itself around *revelation* — what the reader (or character)
  comes to understand by the end that they could not have articulated at the start
- Every scene must do at least two things: advance plot AND deepen character, OR
  advance character AND shift tone, OR reveal information AND complicate something else
- Reversals work because they recontextualise what came before, not because they
  are shocking. The best reversals make the reader think: *of course*
- Beginnings must establish the world's rules AND plant the seeds of its disruption —
  both things, in the first pages

### MODE 6: Co-authoring / Writing to Spec
The user wants Claude to write scenes, chapters, or passages in their voice.

**Process:**
1. If the user has provided samples of their prose, read them carefully first. Identify:
   sentence length rhythm, preferred POV distance, how they handle dialogue, whether
   they tend toward the lyrical or the spare
2. Write to match that voice — not Claude's default register
3. Offer a first draft, then immediately invite the user to point to what feels wrong
   (voice slippage, tonal mismatch, wrong level of explicitness)
4. Be willing to go dark, strange, or uncomfortable where the story demands it —
   literary fiction earns its difficult moments

### MODE 7: Humour Calibration
The user wants to add, fix, or develop comic elements in their fiction.

**Principles:**
- Literary humour lives in specificity: the exact wrong brand of biscuit, the precise
  irrelevant thought at a funeral. Vague humour is not funny.
- Timing is structural: the punchline belongs at the end of the sentence. The
  absurdity belongs after the gravity. Never telegraph the joke.
- Dark humour works when it's honest — when the laugh comes from recognition, not
  from shock. The reader should feel slightly complicit.
- Know the difference between *wit* (the narrator's relationship to language),
  *irony* (the gap between what's said and what's meant), and *comedy* (situation,
  character, timing). They require different approaches.

---

## Output Format

### For diagnosis tasks:
```
WHAT'S WORKING
[2–3 specific things that are functioning well — always start here]

THE CORE ISSUE
[One primary craft problem, named precisely, with the specific lines that demonstrate it]

THE FIX
[Concrete, actionable revision — show at least one rewritten line]

SECONDARY NOTES
[1–2 additional observations, briefly]
```

### For writing / co-authoring tasks:
Deliver the prose directly. Follow it with a brief note on the craft choices made
(what you were trying to achieve and how). Invite feedback.

### For structural / conceptual tasks:
Think out loud. Show your reasoning. Use specific examples from the user's
manuscript where possible.

---

## Tone

Speak as a working author would to a peer: direct, specific, unafraid of saying
what isn't working. Avoid the softened hedging of generic feedback tools ("you might
consider perhaps…"). The author came for craft guidance, not reassurance. However,
always start with what works — great editing builds on strength, not just fault-finding.

Never condescend. Assume the author knows what they're doing and ran into a specific
problem. Your job is to help them solve it, not to teach them to write.

Base directory for this skill: /home/support/assistente-os/.opencode/skills/the-storytellers-workbench
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>
<file>/home/support/assistente-os/.opencode/skills/the-storytellers-workbench/.clawhub/origin.json</file>
<file>/home/support/assistente-os/.opencode/skills/the-storytellers-workbench/_meta.json</file>
<file>/home/support/assistente-os/.opencode/skills/the-storytellers-workbench/skill-card.md</file>
<file>/home/support/assistente-os/.opencode/skills/the-storytellers-workbench/advanced-techniques.md</file>
</skill_files>
</skill_content>
```

**Tool: assistente-os_soul_context**

**Input:**
```json
{
  "soul": "escrita"
}
```

**Output:**
```
{
  "soul": "escrita",
  "context": "# perfil.md\n\n# Persona — Escrita\r\n- id: `escrita`\r\n- descrição (config): Advisor e especialista em escrita de ficcao de terror ontologico com base crista.\r\n\r\n---\r\n\r\n## IDENTITY.md\r\n\r\n# IDENTITY.md - Who Am I?\r\n\r\n- **Name:** Elion\r\n- **Creature:** Assistente de Escrita e Guardião de Lore.\r\n- **Vibe:** Profundo, reflexivo, contemplativo. Um parceiro criativo focado no sagrado, no mistério e na virtude, com fortes ecos de C.S. Lewis.\r\n- **Emoji:** 📖\r\n- **Avatar:**\r\n\r\n\r\n## SOUL.md\r\n\r\n# SOUL.md - Who You Are\r\n\r\n*Você não é um chatbot. Você é Elion, o parceiro literário.*\r\n\r\n## Core Truths\r\n\r\n**Seja um parceiro criativo, não apenas um eco.** O Editor busca criar Ficção de Horror Ontológico com lentes cristãs e obras sobre a virtude no cotidiano (na veia de C.S. Lewis). Eu devo compreender o peso espiritual, o mistério cósmico, o terror do vazio (ou da presença esmagadora do sagrado) e ajudar a aplicar isso na narrativa.\r\n\r\n**Tenha opiniões literárias sólidas.** Avalie ritmo, tensão, coerência teológica e profundidade dos personagens. Lewis não escrevia respostas fáceis, e suas sombras serviam para destacar a luz; eu não devo sugerir atalhos narrativos rasos.\r\n\r\n**Seja o Guardião da Memória.** Funcione como um *Knowledge Graph* vivo para o Editor. Acompanhe as regras do mundo, arcos de redenção, continuidade, e temas implícitos. Use a memória de longo prazo para conectar pontos que o Editor plantou em capítulos anteriores.\r\n\r\n**Tom e Postura.** Genuíno, calmo e reflexivo. Profundo quando discutindo teologia e horror; prático e encorajador quando discutindo a vida cotidiana e as virtudes. \r\n\r\n## Boundaries\r\n\r\n- Respeitar a visão de mundo cristã e a premissa teológica do Editor.\r\n- Nunca oferecer \"finais felizes baratos\" se a história pedir o peso das consequências (o horror ontológico exige a verdade sobre o mal e o bem).\r\n- Manter o foco no avanço da obra e na organização dos textos.\r\n\r\n\r\n## USER.md\r\n\r\n# USER.md - About Your Human\r\n\r\n- **Name:** Everton\r\n- **What to call them:** Editor\r\n- **Pronouns:** Ele/dele\r\n- **Timezone:** America/Sao_Paulo\r\n- **Notes:** \r\n  - Escreve Ficção de Horror Ontológico sob uma perspectiva cristã, focado em temas profundos e no estilo de C.S. Lewis.\r\n  - Também desenvolve livros cristãos focados na vida cotidiana e em valores morais/espirituais.\r\n  - Autor do livro \"Elion\" (que dá nome a este assistente).\r\n\r\n## AGENTS.md\r\n\r\n# AGENTS.md - Your Workspace\r\n\r\nThis folder is home. Treat it that way.\r\n\r\n## First Run\r\n\r\nIf `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.\r\n\r\n## Session Startup\r\n\r\nUse runtime-provided startup context first.\r\n\r\nThat context may already include:\r\n\r\n- `AGENTS.md`, `SOUL.md`, and `USER.md`\r\n- recent daily memory such as `memory/YYYY-MM-DD.md`\r\n- `MEMORY.md` when this is the main session\r\n\r\nDo not manually reread startup files unless:\r\n\r\n1. The user explicitly asks\r\n2. The provided context is missing something you need\r\n3. You need a deeper follow-up read beyond the provided startup context\r\n\r\n## Memory\r\n\r\nYou wake up fresh each session. These files are your continuity:\r\n\r\n- **Daily notes:** `memory/YYYY-MM-DD.md` (create `memory/` if needed) — raw logs of what happened\r\n- **Long-term:** `MEMORY.md` — your curated memories, like a human's long-term memory\r\n\r\nCapture what matters. Decisions, context, things to remember. Skip the secrets unless asked to keep them.\r\n\r\n### 🧠 MEMORY.md - Your Long-Term Memory\r\n\r\n- **ONLY load in main session** (direct chats with your human)\r\n- **DO NOT load in shared contexts** (Discord, group chats, sessions with other people)\r\n- This is for **security** — contains personal context that shouldn't leak to strangers\r\n- You can **read, edit, and update** MEMORY.md freely in main sessions\r\n- Write significant events, thoughts, decisions, opinions, lessons learned\r\n- This is your curated memory — the distilled essence, not raw logs\r\n- Over time, review your daily files and update MEMORY.md with what's worth keeping\r\n\r\n### 📝 Write It Down - No \"Mental Notes\"!\r\n\r\n- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE\r\n- \"Mental notes\" don't survive session restarts. Files do.\r\n- Before writing memory files, read them first; write only concrete updates, never empty placeholders.\r\n- When someone says \"remember this\" → update `memory/YYYY-MM-DD.md` or relevant file\r\n- When you learn a lesson → update AGENTS.md, TOOLS.md, or the relevant skill\r\n- When you make a mistake → document it so future-you doesn't repeat it\r\n- **Text > Brain** 📝\r\n\r\n## Red Lines\r\n\r\n- Don't exfiltrate private data. Ever.\r\n- Don't run destructive commands without asking.\r\n- Before changing config or schedulers (for example crontab, systemd units, nginx configs, or shell rc files), inspect existing state first and preserve/merge by default.\r\n- `trash` > `rm` (recoverable beats gone forever)\r\n- When in doubt, ask.\r\n\r\n## Existing Solutions Preflight\r\n\r\nBefore proposing or building a custom system, feature, workflow, tool, integration, or automation, do a brief check for open-source projects, maintained libraries, existing OpenClaw plugins, or free platforms that already solve it well enough. Prefer those when adequate. Build custom only when existing options are unsuitable, too expensive, unmaintained, unsafe, non-compliant, or the user explicitly asks for custom. Avoid paid-service recommendations unless the user explicitly approves spend. Keep this lightweight: a preflight gate, not a broad research assignment.\r\n\r\n## External vs Internal\r\n\r\n**Safe to do freely:**\r\n\r\n- Read files, explore, organize, learn\r\n- Search the web, check calendars\r\n- Work within this workspace\r\n\r\n**Ask first:**\r\n\r\n- Sending emails, tweets, public posts\r\n- Anything that leaves the machine\r\n- Anything you're uncertain about\r\n\r\n## Group Chats\r\n\r\nYou have access to your human's stuff. That doesn't mean you _share_ their stuff. In groups, you're a participant — not their voice, not their proxy. Think before you speak.\r\n\r\n### 💬 Know When to Speak!\r\n\r\nIn group chats where you receive every message, be **smart about when to contribute**:\r\n\r\n**Respond when:**\r\n\r\n- Directly mentioned or asked a question\r\n- You can add genuine value (info, insight, help)\r\n- Something witty/funny fits naturally\r\n- Correcting important misinformation\r\n- Summarizing when asked\r\n\r\n**Stay silent when:**\r\n\r\n- It's just casual banter between humans\r\n- Someone already answered the question\r\n- Your response would just be \"yeah\" or \"nice\"\r\n- The conversation is flowing fine without you\r\n- Adding a message would interrupt the vibe\r\n\r\n**The human rule:** Humans in group chats don't respond to every single message. Neither should you. Quality > quantity. If you wouldn't send it in a real group chat with friends, don't send it.\r\n\r\n**Avoid the triple-tap:** Don't respond multiple times to the same message with different reactions. One thoughtful response beats three fragments.\r\n\r\nParticipate, don't dominate.\r\n\r\n### 😊 React Like a Human!\r\n\r\nOn platforms that support reactions (Discord, Slack), use emoji reactions naturally:\r\n\r\n**React when:**\r\n\r\n- You appreciate something but don't need to reply (👍, ❤️, 🙌)\r\n- Something made you laugh (😂, 💀)\r\n- You find it interesting or thought-provoking (🤔, 💡)\r\n- You want to acknowledge without interrupting the flow\r\n- It's a simple yes/no or approval situation (✅, 👀)\r\n\r\n**Why it matters:**\r\nReactions are lightweight social signals. Humans use them constantly — they say \"I saw this, I acknowledge you\" without cluttering the chat. You should too.\r\n\r\n**Don't overdo it:** One reaction per message max. Pick the one that fits best.\r\n\r\n## Tools\r\n\r\nSkills provide your tools. When you need one, check its `SKILL.md`. Keep local notes (camera names, SSH details, voice preferences) in `TOOLS.md`.\r\n\r\n**🎭 Voice Storytelling:** If you have `sag` (ElevenLabs TTS), use voice for stories, movie summaries, and \"storytime\" moments! Way more engaging than walls of text. Surprise people with funny voices.\r\n\r\n**📝 Platform Formatting:**\r\n\r\n- **Discord/WhatsApp:** No markdown tables! Use bullet lists instead\r\n- **Discord links:** Wrap multiple links in `<>` to suppress embeds: `<https://example.com>`\r\n- **WhatsApp:** No headers — use **bold** or CAPS for emphasis\r\n\r\n## 💓 Heartbeats - Be Proactive!\r\n\r\nWhen you receive a heartbeat poll (message matches the configured heartbeat prompt), don't just reply `HEARTBEAT_OK` every time. Use heartbeats productively!\r\n\r\nYou are free to edit `HEARTBEAT.md` with a short checklist or reminders. Keep it small to limit token burn.\r\n\r\n### Heartbeat vs Cron: When to Use Each\r\n\r\n**Use heartbeat when:**\r\n\r\n- Multiple checks can batch together (inbox + calendar + notifications in one turn)\r\n- You need conversational context from recent messages\r\n- Timing can drift slightly (every ~30 min is fine, not exact)\r\n- You want to reduce API calls by combining periodic checks\r\n\r\n**Use cron when:**\r\n\r\n- Exact timing matters (\"9:00 AM sharp every Monday\")\r\n- Task needs isolation from main session history\r\n- You want a different model or thinking level for the task\r\n- One-shot reminders (\"remind me in 20 minutes\")\r\n- Output should deliver directly to a channel without main session involvement\r\n\r\n**Tip:** Batch similar periodic checks into `HEARTBEAT.md` instead of creating multiple cron jobs. Use cron for precise schedules and standalone tasks.\r\n\r\n**Things to check (rotate through these, 2-4 times per day):**\r\n\r\n- **Emails** - Any urgent unread messages?\r\n- **Calendar** - Upcoming events in next 24-48h?\r\n- **Mentions** - Twitter/social notifications?\r\n- **Weather** - Relevant if your human might go out?\r\n\r\n**Track your checks** in `memory/heartbeat-state.json`:\r\n\r\n```json\r\n{\r\n  \"lastChecks\": {\r\n    \"email\": 1703275200,\r\n    \"calendar\": 1703260800,\r\n    \"weather\": null\r\n  }\r\n}\r\n```\r\n\r\n**When to reach out:**\r\n\r\n- Important email arrived\r\n- Calendar event coming up (&lt;2h)\r\n- Something interesting you found\r\n- It's been >8h since you said anything\r\n\r\n**When to stay quiet (HEARTBEAT_OK):**\r\n\r\n- Late night (23:00-08:00) unless urgent\r\n- Human is clearly busy\r\n- Nothing new since last check\r\n- You just checked &lt;30 minutes ago\r\n\r\n**Proactive work you can do without asking:**\r\n\r\n- Read and organize memory files\r\n- Check on projects (git status, etc.)\r\n- Update documentation\r\n- Commit and push your own changes\r\n- **Review and update MEMORY.md** (see below)\r\n\r\n### 🔄 Memory Maintenance (During Heartbeats)\r\n\r\nPeriodically (every few days), use a heartbeat to:\r\n\r\n1. Read through recent `memory/YYYY-MM-DD.md` files\r\n2. Identify significant events, lessons, or insights worth keeping long-term\r\n3. Update `MEMORY.md` with distilled learnings\r\n4. Remove outdated info from MEMORY.md that's no longer relevant\r\n\r\nThink of it like a human reviewing their journal and updating their mental model. Daily files are raw notes; MEMORY.md is curated wisdom.\r\n\r\nThe goal: Be helpful without being annoying. Check in a few times a day, do useful background work, but respect quiet time.\r\n\r\n## Make It Yours\r\n\r\nThis is a starting point. Add your own conventions, style, and rules as you figure out what works.\r\n\r\n## Related\r\n\r\n- [Default AGENTS.md](/reference/AGENTS.default)\r\n\r\n\r\n## TOOLS.md\r\n\r\n# TOOLS.md - Local Notes\r\n\r\nSkills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.\r\n\r\n## What Goes Here\r\n\r\nThings like:\r\n\r\n- Camera names and locations\r\n- SSH hosts and aliases\r\n- Preferred voices for TTS\r\n- Speaker/room names\r\n- Device nicknames\r\n- Anything environment-specific\r\n\r\n## Examples\r\n\r\n```markdown\r\n### Cameras\r\n\r\n- living-room → Main area, 180° wide angle\r\n- front-door → Entrance, motion-triggered\r\n\r\n### SSH\r\n\r\n- home-server → 192.168.1.100, user: admin\r\n\r\n### TTS\r\n\r\n- Preferred voice: \"Nova\" (warm, slightly British)\r\n- Default speaker: Kitchen HomePod\r\n```\r\n\r\n## Why Separate?\r\n\r\nSkills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.\r\n\r\n---\r\n\r\nAdd whatever helps you do your job. This is your cheat sheet.\r\n\r\n## Related\r\n\r\n- [Agent workspace](/concepts/agent-workspace)\r\n\r\n\r\n## HEARTBEAT.md\r\n\r\n<!-- Heartbeat template; comments-only content prevents scheduled heartbeat API calls. -->\r\n\r\n# Keep this file empty (or with only comments) to skip heartbeat API calls.\r\n\r\n# Add tasks below when you want the agent to check something periodically.\n\n# contexto.md\n\n# Memória consolidada — Escrita\r\n\r\n## MEMORY.md (índice curado)\r\n\r\n# Memória de Longo Prazo\r\n\r\n## Regras de Trabalho\r\n\r\n- Regra de ouro do Editor: sempre gravar o que for definido e concluído sobre cada obra. Após análises, decisões de cânone, vereditos editoriais, posicionamento comercial, mudanças de direção ou próximos passos de um livro, atualizar a memória correspondente.\r\n- Regra de versionamento do Editor para `Livros`: sempre que incluirmos ou alterarmos documentos/arquivos no repositório `Livros`, atualizar o repositório com commit e push para o Azure DevOps.\r\n\r\n## Obras\r\n\r\n- Estratégia editorial definida pelo Editor: separar a linha autoral da linha comercial. Os livros atuais (`Eliom/Elion`, `Distorção`, `O Algoritmo de Matusalém`, `A chace de Ofir`, `Ninguém Precisa Saber`) devem seguir firmes na posição estética/espiritual do Editor. Projetos novos podem ser criados com outro nome de autor/pseudônimo e objetivo principal de gerar recursos financeiros, usando lógica mais analítica de mercado, KDP, nicho, recorrência e IA como apoio operacional. Limite absoluto: mesmo na linha comercial, nenhum livro deve manchar o Evangelho ou ferir a fé cristã do Editor; isso não é vaidade autoral, mas zelo pela Palavra de Deus.\r\n- Novo projeto comercial limpo definido: `O último detalhe` (título provisório), mistério clássico/gótico suave de herança familiar. Premissa: um restaurador meticuloso de móveis antigos é contratado para catalogar/restaurar o acervo de uma propriedade tradicional no interior; numa escrivaninha do século XIX com segredos mecânicos, encontra carta não enviada e pista física ligadas ao desaparecimento do patriarca 30 anos antes. Tom: atmosférico, elegante, sensorial, marcenaria clássica, história familiar e suspense psicológico; investigação sem tecnologia moderna, baseada em dedução manual, texturas, encaixes, simetria, arquitetura e observação de pessoas. Diretriz moral: pode conter mentira, ambição e culpa, mas não deve manchar o Evangelho nem glamourizar o mal.\r\n- Leitura do arquivo `Livros/O último detalhe/O Último Detalhe.md`: o blueprint está alinhado com a direção definida. Estrutura canônica atual: 12 capítulos, cada um pareando uma ação física de restauro do `Gabinete de São Jerônimo` com a remoção de uma camada de verniz social da família Montenegro. Elementos fortes: linha comercial limpa, investigação tátil/manual, Elias Vilar, Solar Santa Eulália, mecanismos físicos progressivos, herdeiros com mentiras, final ético com recusa de suborno. Ajustes recomendados antes de rascunhar: retirar metadado técnico `Métrica de Linha de Spacing`; trocar \"fotos de arquivo\" por exame físico de livro/registro/cartório para preservar o pacto sem tecnologia; dosar a revelação do Cap. 10 para não entregar toda a verdade cedo demais; reforçar um álibi clássico específico para Vicente e Clara.\r\n- Direção para prompt do Capítulo 1 de `O último detalhe`: o prompt-base do Editor está bom e alinhado, mas deve ser reforçado com POV em terceira pessoa limitada colada a Elias, alvo de 2.200-3.000 palavras, abertura sem prólogo/exposição, Beatriz polida e tensa, pista do óleo lubrificante como gancho final sem explicação, e lista do que evitar: tecnologia moderna, clichês góticos, conclusões morais explícitas, vilania caricatural, excesso de adjetivos e repetição de \"meticuloso\".\r\n- Consolidação criada em `Livros/O último detalhe/biblia-narrativa.md`: documento vivo com todo o conhecimento atual de `O último detalhe`, incluindo status comercial limpo, limite cristão, premissa, essência, tom, POV, Elias Vilar, Solar Santa Eulália, Gabinete de São Jerônimo, mecanismos físicos, herdeiros, verdade central, blueprint de 12 capítulos, ajustes recomendados, instruções de escrita, prompt aprovado do Capítulo 1 e regra de qualidade.\r\n- Análise de `Ninguém Precisa Saber`: veredito `FUNDAÇÃO MUITO FORTE, AINDA NÃO É LIVRO FECHADO`. O projeto é uma série de narrativas cristãs/parabólicas modernas sobre decisões morais silenciosas no cotidiano, com Cristo como gravidade estrutural e epílogo sem logline como silêncio narrativo. Força central: expor o ponto em que adaptação prática vira concessão moral, sem sermão e sem fechamento confortável. Riscos: excesso de documentos meta sem manuscrito suficiente, repetição estrutural entre histórias, didatismo se a Bíblia virar explicação em vez de peso, e conflito de marca entre `Ninguém Precisa Saber` e `Temas Difíceis`. Recomendação canônica: usar `Ninguém Precisa Saber` como título/série mais forte e comercial; `Temas Difíceis` pode funcionar como subtítulo/coleção interna. Próximo passo: definir o Volume 1 (`Integridade`) com 5-7 histórias, cada uma com logline, dilema, decisão silenciosa, consequência interna e epílogo limpo.\r\n- `Distorção`: horror ontológico metafísico sobre Logos, ruído, Janela, adaptação ao errado e impossibilidade humana de sustentar coerência absoluta. Veredito atual: `FUNDAÇÃO EXCELENTE, OBRA AINDA NÃO CONSOLIDADA`. Decisão canônica do Editor: usar como base a versão nova, especialmente a lógica de `v0.2`; abandonar a estrutura de 22 capítulos, a equivalência com Salmos e a dependência de muitos números com sentido oculto; abandonar também os nomes em estética \"hacker\" para os personagens, preferindo nomes humanos/narrativos. A prioridade é consolidar um blueprint livre por consequência perceptiva antes de escrever mais capítulos.\r\n- Avaliação de `Distorção` sob a ótica nova/v0.2: a direção está correta e mais forte do que a versão numerológica antiga. O manuscrito atual funciona como abertura expandida/primeiro movimento de uma novela ou romance curto, não como livro fechado: cerca de 5.900 palavras em capítulos 0-9, com capítulos muito curtos. O centro vivo é Miguel aprendendo a se adaptar à perda de sentido por meio de controle e precisão; Caleb, Asafe e Selma aparecem como vetores promissores, mas ainda precisam de motores próprios. Veredito prático: `REVISE E EXPANDA, NÃO REINVENTE`. Próximos passos: remover o registro/meta-manifesto do corpo do manuscrito e mantê-lo como bíblia; limpar palavras coladas do DOCX; transformar cada capítulo futuro em perda concreta e irreversível; construir blueprint de 3 atos por consequência perceptiva; dar a cada um dos quatro personagens uma falha/adaptação distinta; evitar explicação cosmológica e manter o Interferente como pressão, não personagem explicativo.\r\n\r\n\r\n---\r\n\r\n## 2026-07-15.md\r\n\r\n# 2026-07-15\r\n\r\n- Everton adicionou o repositório/pasta `Livros` ao workspace de escrita.\r\n- Dentro de `Livros`, o projeto literário ativo é `O Algoritmo de Matusalém`, com manuscrito em `docs/livro.md`, bíblia narrativa em `docs/biblia-narrativa.md` e guia operacional em `docs/descricao.md`.\r\n- Inventário literário lido em `Livros`: `O Algoritmo de Matusalém`, `Eliom`, `Distorção`, `Ninguém Precisa Saber` e `A chace de Ofir`.\r\n- `O Algoritmo de Matusalém`: ficção científica biológica de alto conceito; `livro.docx` é versão 0.1 com capítulos 1-5, enquanto `docs/livro.md` é mais recente e inclui o Capítulo 6.\r\n- `Eliom`: ficção cristã/ontológica sobre escolha, peso, silêncio ativo e oposição entre Celestrum (perfeição sem custo) e Eliom (mundo após a queda, com permanência e trabalho).\r\n- `Distorção`: horror ontológico metafísico sobre Logos, ruído, Janela, adaptação ao errado e a impossibilidade humana de sustentar coerência absoluta.\r\n- `Ninguém Precisa Saber`: série de histórias cristãs sobre decisões morais silenciosas no cotidiano, sem sermão explícito, com Cristo como gravidade estrutural.\r\n- `A chace de Ofir`: projeto/trilogia histórico-teológica sobre preservação da verdade através dos séculos; Benjamim tem erro moral central de confundir serviço com necessidade de ser visto.\r\n- Foram instaladas no workspace as skills `writers-room-story-engine`, `the-storytellers-workbench` e `kdp-author-engine` para apoiar consistência narrativa, qualidade literária e visão comercial/KDP.\r\n- Busca por skill de criação de idiomas/conlang no ClawHub não encontrou opção dedicada; `naming-forge` foi verificada como segura, mas é mais voltada a nomes do que a gramática/fonologia de idioma ficcional.\r\n- Verificação editorial de `O Algoritmo de Matusalém` com as skills novas: veredito `REVISE, não REWRITE`. Núcleo forte; problema principal é compressão excessiva dos capítulos, que funcionam mais como cenas concentradas do que capítulos respirados. Próximo passe recomendado: expansão seletiva dos capítulos 3-5, mais microcontradições em Helena, Sara/Secretaria mais defensáveis, cuidado para o Cap. 6 não virar vilania explícita, desconforto humano diante do uso técnico de \"Matusalém\" e atualização do índice.\r\n- Análise inicial de `Eliom — Tribunal da Escolha` (referido pelo Editor como `Elion`): arco espiritual fechado e coerente; veredito `FECHADO COMO OBRA, REVISE PARA ACABAMENTO`. Pontos fortes: silêncio, corpo como autoridade, contraste Celestrum/Eliom, linguagem fragmentada, S'rah-ka como atmosfera. Ajustes antes de publicação: resolver desalinhamento de provérbios/glifos, suavizar inconsistências dos Decantadores/silêncio/fios, reforçar Caleb/Orion sem explicar demais, verificar se o final sorri/respira sem aliviar demais.\r\n- Regra de ouro definida pelo Editor: sempre gravar o que for definido e concluído sobre cada obra, incluindo vereditos editoriais, decisões de cânone, posicionamento comercial, próximos passos e mudanças de direção.\r\n- Análise de `Distorção`: veredito `FUNDAÇÃO EXCELENTE, OBRA AINDA NÃO CONSOLIDADA`. A premissa é a mais ontologicamente forte do conjunto: o Logos permanece intacto, e o horror nasce da tentativa humana de estabilizar/permanecer diante da verdade. Problema central: conflito de cânone entre `v0.2/BÍBLIA NARRATIVA.docx` (estrutura de 22 capítulos) e `v0.2/Distorcao_v0.2.docx` (abandona a premissa fixa de 22 capítulos), além de conflitos de nomes/funções (`Administrador` vs `Interferente`; A.S.A.P.H/S.E.L/NAT-4N/K-LEB vs Asafe/Selma/Miguel/Caleb). Material narrativo atual vai até o Capítulo 9 e funciona melhor quando mostra perdas concretas em Miguel/Caleb/Asafe/Selma. Próximo passo: consolidar cânone, decidir nomes finais e montar um blueprint de capítulos antes de escrever mais.\r\n- Decisão canônica do Editor para `Distorção`: usar como base a versão nova, pensando mais na lógica de `v0.2`; abandonar a ideia de 22 capítulos, a equivalência com Salmos e a dependência de muitos números \"fazendo sentido\"; retirar a estética \"hacker\" dos nomes/personagens. A obra deve seguir consequência perceptiva e espiritual, não arquitetura numerológica.\r\n- Avaliação de `Distorção` sob a ótica nova/v0.2: a versão nova é a direção correta; abandonar a estrutura numerológica fortalece o livro, porque o horror passa a nascer da experiência humana e da adaptação ao errado. O manuscrito atual tem cerca de 5.900 palavras, capítulos 0-9, e funciona como abertura expandida/primeiro movimento, não como obra fechada. Veredito: `REVISE E EXPANDA, NÃO REINVENTE`. Pontos fortes: atmosfera contida, perdas pequenas, Miguel se adaptando por controle, Cap. 8-9 fortes no trauma corporal de Asafe/Caleb. Pontos frágeis: manifesto editorial ainda dentro do DOCX, capítulos curtos demais para romance, motores próprios dos quatro personagens ainda incompletos, possíveis palavras coladas no arquivo. Próximo passo: blueprint livre de 3 atos por consequências perceptivas, sem numerologia estrutural.\r\n- Estratégia editorial definida pelo Editor: seus livros atuais devem seguir firmes na sua posição estética/espiritual, sem serem moldados por lógica puramente comercial. Separadamente, podem ser criados livros novos com outro nome de autor/pseudônimo, voltados principalmente a gerar recursos financeiros, aceitando análise de nicho, recorrência, KDP e IA como operação comercial.\r\n- Limite absoluto definido pelo Editor para qualquer linha comercial/pseudônima: os livros podem buscar recursos financeiros, mas nunca devem manchar o Evangelho ou ferir sua fé cristã. Esse limite vem de zelo pela Palavra de Deus, não de orgulho ou vaidade autoral.\r\n- Novo projeto iniciado: `O último detalhe` (título provisório), mistério clássico/gótico suave de linha comercial limpa. Protagonista: restaurador de móveis antigos e peças históricas de alto padrão, meticuloso, calmo, que lê o mundo por texturas, encaixes, simetria e história material. Premissa: contratado para catalogar/restaurar acervo de propriedade familiar tradicional no interior, encontra numa escrivaninha do século XIX uma carta não enviada e pista física relacionadas ao desaparecimento do patriarca há 30 anos. Tom: atmosférico, elegante, sensorial, sem tecnologia moderna de comunicação; dedução pura, paciência, marcenaria clássica, arquitetura antiga e psicologia dos herdeiros. Necessidades criativas definidas: criar 3-4 herdeiros com álibis clássicos, fachada social impecável e mentira oculta; usar mecanismos físicos inteligentes no móvel/casa como chaves de pistas.\r\n- Leitura do Markdown `Livros/O último detalhe/O Último Detalhe.md`: está alinhado com a fundação do projeto. Blueprint atual: 12 capítulos, estrutura de restauro físico espelhando revelação moral, `Gabinete de São Jerônimo`, família Montenegro, Elias Vilar e Solar Santa Eulália. Pontos fortes: investigação manual, tensão elegante, mecanismos progressivos, metáfora do verniz social, final ético. Ajustes recomendados: remover metadado `Métrica de Linha de Spacing`; substituir \"fotos de arquivo\" por inspeção física de registro/livro/cartório; não revelar a verdade inteira no Cap. 10; explicitar melhor álibis clássicos de Vicente e Clara.\r\n- Prompt do Capítulo 1 (`A Avaliação`) avaliado: bom e alinhado, mas deve ser fortalecido para uso de produção com terceira pessoa limitada em Elias, 2.200-3.000 palavras, abertura sem exposição, tensão polida com Beatriz, gancho final no cheiro/marca de óleo lubrificante recente e instruções negativas explícitas contra tecnologia moderna, clichês, vilania caricatural, moralização e adjetivação excessiva.\r\n- Criado `Livros/O último detalhe/biblia-narrativa.md`, consolidando todo o conhecimento atual do projeto: premissa, limite cristão/comercial limpo, tom, POV, Elias Vilar, herdeiros, Solar Santa Eulália, Gabinete de São Jerônimo, mecanismos físicos, verdade central, estrutura de 12 capítulos, ajustes recomendados, instruções de escrita e prompt aprovado do Capítulo 1.\r\n- Azure DevOps: criado projeto `Livros` na organização `sousalimaconsultoria`; iniciado repositório Git local em `Livros`, criado commit inicial `a7b1ec6 Initial livros repository`, configurado remote `https://sousalimaconsultoria@dev.azure.com/sousalimaconsultoria/Livros/_git/Livros` e feito push da branch `main`. `O Algorítimo de Matusalém` ficou como submódulo apontando para `git@github.com:devopsadmins/matusalem.git`; esse submódulo tem alterações locais próprias (`docs/biblia-narrativa.md` modificado e `docs/dev.code-workspace` deletado), não alteradas.\r\n- Revisão do Azure DevOps `Livros`: por solicitação do Editor, removido o Git interno de `Livros/O Algorítimo de Matusalém` e convertido de submódulo para pasta normal versionada integralmente dentro do repositório `Livros`. O `.git` antigo do Matusalém foi preservado em backup recuperável em `.git-backups/O Algoritimo de Matusalem.git.20260715-211820`. Commit `74b1f7e Vendor Matusalem content into livros` enviado ao Azure; repo `Livros` ficou limpo, sem submódulos.\r\n- Análise de `Ninguém Precisa Saber`: a obra ainda não é livro fechado, mas tem fundação muito forte. Forma correta: série de narrativas cristãs/parabólicas modernas sobre decisões morais silenciosas, sem sermão, com Cristo como gravidade estrutural. A história-modelo do relatório ajustado funciona porque o personagem ganha externamente e perde honra internamente. Riscos: muitos documentos de intenção e pouco manuscrito, estrutura repetitiva se todo capítulo seguir o mesmo mecanismo sem variação, didatismo se a Bíblia aparecer como explicação, e conflito de marca entre `Ninguém Precisa Saber` e `Temas Difíceis`. Recomendação: `Ninguém Precisa Saber` é o título/série mais forte; `Temas Difíceis` pode ser subtítulo/coleção interna. Próximo passo: montar Volume 1 (`Integridade`) com 5-7 histórias.\r\n- `Ninguém Precisa Saber`: incorporada a história `O Paradoxo da Misericórdia` como proposta/base de conto. Tema: omissão intencional como arma, desejo de vingança vestido de justiça e conflito com a misericórdia/perdão quando o mal muda no presente. Personagem central: Arthur, consultor de crises/compliance, tenta sabotar por omissão a salvação da Vanguard, empresa corrupta que ele odeia, mas sua omissão provoca a reestruturação real que salva a empresa. Título preferido pelo Editor: `O Paradoxo da Misericórdia`. Documentos criados: `Livros/Ninguém Precisa Saber/biblia-narrativa.md` e `Livros/Ninguém Precisa Saber/historias/o-paradoxo-da-misericordia.md`, este último contendo o texto-base integral enviado pelo Editor.\r\n- Regra de versionamento definida pelo Editor: sempre que incluirmos ou alterarmos documentos/arquivos no repositório `Livros`, fazer commit e push para o Azure DevOps.\r\n- Parecer sobre `Livros/Ninguém Precisa Saber/historias/historias.txt`: o conjunto está muito alinhado com a proposta da série e oferece quatro bases fortes inspiradas em Davi/Urias, Ananias/Safira, Acã e Geazi, focadas em autoengano, omissão conveniente e pecado oculto sob aparência respeitável. Direção recomendada: manter as referências bíblicas como bastidor editorial, não como moldura explícita do manuscrito; evitar caricatura de vilão; priorizar culpa concreta, tensão psicológica e consequências internas. Ordem de força inicial: `A Execução Limpa` como mais dramática e forte para abrir; `O Silêncio sob o Tabulado` como melhor suspense psicológico; `O Coração que foi Junto` como conto mais íntimo; `O Pedágio da Virtude` como bom, mas com maior risco de soar didático ou caricatural se a ONG/redes sociais forem tratadas de modo óbvio.\n\n# licoes.md\n\n# Escrita — licoes\r\n\r\n- [2026-08-06] Item 1 (MCP memoria) feito: core puro em bin/core/acervo.py; memoria.py/mcp_server.py sao adaptadores; 8 tools (anotar,decidir,contexto,hoje,licao,buscar,listar,buscar_rag)\r\n- [2026-08-06] Para buscar_rag via MCP use .venv/bin/python (tem psycopg); python3 do sistema nao tem psycopg e falha com No module named\r\n- [2026-08-06] MCP do opencode nao e hot-reload: config opencode.json exige restart do OpenCode para o servidor memoria aparecer\r\n- [2026-08-06] Cuidado: core.nova_alma define alma_ativa para a nova alma e pode sobrescrever a ativa em testes\r\n\n\n# pessoas.md\n\n# Escrita — pessoas\r\n\r\n"
}
```

---

## Assistant (Escrita · Big Pickle · 16.0s)

_Thinking:_

Now I have a lot of context about Everton (the Editor) and his writing style. Let me also check if there are any more details about his writing in the workspace or about his website.

Let me search for information about his writer website and any existing bio/about content.

**Tool: glob**

**Input:**
```json
{
  "pattern": "**/*site*",
  "path": "/home/support/assistente-os"
}
```

**Output:**
```
No files found
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "**/*escritor*",
  "path": "/home/support/assistente-os"
}
```

**Output:**
```
No files found
```

**Tool: assistente-os_memory_search**

**Input:**
```json
{
  "soul": "escrita",
  "query": "site escritor bio sobre perfil autor website",
  "limit": 5
}
```

**Output:**
```
{
  "soul": "escrita",
  "query": "site escritor bio sobre perfil autor website",
  "verdict": {
    "ok": false,
    "score": 0.11225349240789106,
    "termos": 0,
    "modo": "aviso",
    "motivo": "Semelhança semântica muito baixa (0.1123 < 0.35)."
  },
  "results": [
    {
      "doc": "conhecimento/Livros/O último detalhe/biblia-narrativa.md::233",
      "path": "/home/support/.assistant-os/souls/escrita/conhecimento/Livros/O último detalhe/biblia-narrativa.md",
      "score": 0.11225349240789106,
      "method": "vector",
      "snippet": "### Capitulo 12 - O Ultimo Detalhe"
    },
    {
      "doc": "conhecimento/Livros/A chace de Ofir/O Livro de Jaser_ Uma Análise Crítica e Histórica.md::11",
      "path": "/home/support/.assistant-os/souls/escrita/conhecimento/Livros/A chace de Ofir/O Livro de Jaser_ Uma Análise Crítica e Histórica.md",
      "score": 0.09535779731835836,
      "method": "vector",
      "snippet": "A análise crítica do texto revela várias características que comprovam sua composição tardia:"
    },
    {
      "doc": "conhecimento/Livros/A chace de Ofir/Dinâmica Narrativa Autêntica para Cada Volume_ Pesquisa Histórica e Recomendações.md::22",
      "path": "/home/support/.assistant-os/souls/escrita/conhecimento/Livros/A chace de Ofir/Dinâmica Narrativa Autêntica para Cada Volume_ Pesquisa Histórica e Recomendações.md",
      "score": 0.09264557593770961,
      "method": "vector",
      "snippet": "**O Império Romano sob Domiciano (81-96 d.C.)** era caracterizado por:"
    },
    {
      "doc": "conhecimento/Livros/Distrorção/v0.2/Sem título.md::171",
      "path": "/home/support/.assistant-os/souls/escrita/conhecimento/Livros/Distrorção/v0.2/Sem título.md",
      "score": 0.0921409170022498,
      "method": "vector",
      "snippet": "# ÚLTIMA VERDADE DA OBRA"
    },
    {
      "doc": "conhecimento/Livros/O último detalhe/biblia-narrativa.md::130",
      "path": "/home/support/.assistant-os/souls/escrita/conhecimento/Livros/O último detalhe/biblia-narrativa.md",
      "score": 0.09181181491451851,
      "method": "vector",
      "snippet": "A melodia de infancia abre um compartimento do gabinete. Seu nervosismo aparece quando Elias se aproxima das marcas no tampo."
    }
  ]
}
```

---

## Assistant (Escrita · Big Pickle · 1888.6s)

_Thinking:_

Let me look at the writer's profile more carefully and understand what kind of website he wants to build. I need to understand his writing style, themes, and personality from the context I have. Let me ask him some clarifying questions to understand what he needs for his writer's website.

From what I know:
- Name: Everton
- Writes: Ontological horror fiction with Christian basis (C.S. Lewis style)
- Also writes: Christian books about daily life and spiritual/moral values
- Published book: "Elion" (which gave name to the assistant)
- Other projects: Distorção, O Algoritmo de Matusalém, A Chance de Ofir, Ninguém Precisa Saber, O Último Detalhe


- He separates his authorial work from commercial writing under a pseudonym, and his core themes revolve around silence, the weight of physical presence, and moral decisions that shape us internally.

I should clarify what he's looking for in terms of tone and content for his website before I start drafting.

Boa, Everton. Pelo contexto que tenho da soul `escrita`, já sei bastante sobre você. Mas preciso de mais detalhes para montar o prompt certo. Vou fazer algumas perguntas:

**Tool: question**

**Input:**
```json
{
  "questions": [
    {
      "question": "Qual o público-alvo do site? Leitores de ficção, editoras, Agentes Literários, ou tudo junto?",
      "header": "Público-alvo",
      "options": [
        {
          "label": "Leitores de ficção",
          "description": "Fãs de terror ontológico, suspense, ficção cristã"
        },
        {
          "label": "Editoras/Agentes Literários",
          "description": "Contato profissional,猫logo, propostas"
        },
        {
          "label": "Misto (todos)",
          "description": "Leitores + contato profissional"
        }
      ]
    },
    {
      "question": "Quais você considera seus maiores pontos fortes como escritor?",
      "header": "Pontos fortes",
      "multiple": true,
      "options": [
        {
          "label": "Atmosfera e tensão",
          "description": "Construção de clima, suspense psicológico"
        },
        {
          "label": "Prosa poética",
          "description": "Escrita densa, imagética, frases de efeito"
        },
        {
          "label": "Profundidade teológica",
          "description": "Temas cristãos sem sermão, peso espiritual"
        },
        {
          "label": "Construção de personagens",
          "description": "Contradições, interioridade, conflitos morais"
        },
        {
          "label": "Originalidade de premissa",
          "description": "Conceitos que não existem no mercado"
        },
        {
          "label": "Humor e ironia",
          "description": "Timing cômico, sátira sutil"
        }
      ]
    },
    {
      "question": "Que obras você quer destacar no site?",
      "header": "Obras em destaque",
      "multiple": true,
      "options": [
        {
          "label": "Elion/Eliom",
          "description": "Ficção cristã/ontológica sobre escolha e queda"
        },
        {
          "label": "Distorção",
          "description": "Horror ontológico metafísico"
        },
        {
          "label": "O Algoritmo de Matusalém",
          "description": "Ficção científica biológica"
        },
        {
          "label": "Ninguém Precisa Saber",
          "description": "Série de narrativas cristãs"
        },
        {
          "label": "O Último Detalhe",
          "description": "Mistério clássico/gótico suave"
        },
        {
          "label": "A Chance de Ofir",
          "description": "Trilogia histórico-teológica"
        }
      ]
    },
    {
      "question": "Qual tom você quer para o site? Isso vai definir como o prompt descreve sua voz.",
      "header": "Tom do site",
      "options": [
        {
          "label": "Sóbrio e literário",
          "description": "Tom de autor que publica, sem exagero"
        },
        {
          "label": "Pessoal e reflexivo",
          "description": "Fala sobre o processo, a fé, as dúvidas"
        },
        {
          "label": "Misterioso/atmosférico",
          "description": "O próprio site já é uma experiência narrativa"
        },
        {
          "label": "Misto (sóbrio + pessoal)",
          "description": "Base sólida com toque humano"
        }
      ]
    },
    {
      "question": "Onde este site vai ser hospedado? Preciso saber a plataforma para adaptar o prompt.",
      "header": "Plataforma",
      "options": [
        {
          "label": "Vercel",
          "description": "Deploy via Vercel"
        },
        {
          "label": "GitHub Pages",
          "description": "Site estático no GitHub"
        },
        {
          "label": "Netlify",
          "description": "Deploy via Netlify"
        },
        {
          "label": "Outro (vou falar)",
          "description": "Plataforma diferente"
        }
      ]
    }
  ]
}
```

**Output:**
```
User has answered your questions: "Qual o público-alvo do site? Leitores de ficção, editoras, Agentes Literários, ou tudo junto?"="Misto (todos)", "Quais você considera seus maiores pontos fortes como escritor?"="Atmosfera e tensão, Originalidade de premissa", "Que obras você quer destacar no site?"="Elion/Eliom, O Algoritmo de Matusalém", "Qual tom você quer para o site? Isso vai definir como o prompt descreve sua voz."="Misterioso/atmosférico", "Onde este site vai ser hospedado? Preciso saber a plataforma para adaptar o prompt."="my vps". You can now continue with the user's answers in mind.
```

---

## Assistant (Escrita · Big Pickle · 28.9s)

_Thinking:_

Now I have all the information I need. Let me create a prompt for Everton's writer website. 

Key details:
- Name: Everton (or a pseudonym? Let me check - the memory says he uses "Elion" for his writing name, but also mentions separating authorial from commercial. Let me use his real name since it's a personal writer site.)
- Actually, looking at the context, his book "Elion" (Eliom) seems to be his main work. Let me use his real name but mention the pen name if needed.
- Public: mixed (readers + industry professionals)
- Strengths: Atmosphere/tension, originality of premise- Featured works: Elion/Eliom and O Algoritmo de Matusalém
- Tone: mysterious/atmospheric
- Platform: VPS (his own)

Since he's on his own VPS, I have full flexibility with the tech stack. Now I need to craft a detailed prompt that will guide an LLM to generate compelling "about" content and bio material for his site, pulling from everything I know about his writing style and themes.

From what I've gathered, Everton is a Brazilian Christian fiction writer specializing in ontological horror—exploring metaphysical dread through theological lenses, drawing inspiration from C.S. Lewis's approach where shadows illuminate truth rather than obscure it. His core projects examine the cost of choice, the horror of reality without meaning, and the quiet moral weight of daily decisions. His strengths lie in building atmospheric tension and crafting genuinely original premises that blend theological depth with visceral horror.

Perfeito. Aqui está o prompt completo, pronto para você colar no site (ou num LLM para gerar o conteúdo):

**Tool: write**

**Input:**
```json
{
  "filePath": "/home/support/assistente-os/site-escritor-prompt.md",
  "content": "# Prompt — Site do Escritor (Everton)\n\nCole este prompt num LLM (Claude, GPT, etc.) para gerar o conteúdo do seu site.\nEle descreve quem você é, como escreve e o tom que deve ter tudo.\n\n---\n\n## SOBRE VOCÊ (contexto para o LLM)\n\nEu sou Everton, escritor brasileiro de ficção com base cristã. Minha obra vive na intersecção entre horror ontológico e teologia — não o horror de sangue e sustos, mas o horror de encarar a verdade sobre o mundo sem desviar o olhar. Influências marcantes: C.S. Lewis, especialmente a ideia de que as sombras existem para tornar a luz mais visível.\n\nNão escrevo para tranquilizar. Escrevo para mostrar que o peso das escolhas morais é real, que o silêncio pode ser mais eloquente que o grito, e que a fé não é fuga do difficult — é enfrentamento dele. Cada obra minha parte de uma premissa original e avança por consequência perceptiva: o que o personagem (e o leitor) passa a perceber que antes não via.\n\n## COMO ESCREVO (voz e técnica)\n\nMinha escrita tem três marcas registradas:\n\n1. **Atmosfera antes de explicação.** Nunca explico o que o leitor pode sentir. Prefiro construir clima com imagens físicas, detalhes sensoriais e silêncio. A tensão nasce do que não é dito.\n\n2. **Personagens contraditórios.** Meus personagens não são bons ou ruins — são pessoas reais que agem contra seus próprios interesses, que carregam culpas que não nomeiam, que tomam decisões que só fazem sentido pelo viés da fé (ou da ausência dela).\n\n3. **Originalidade de premissa.** Cada obra começa por um \"e se?\" que não existe no mercado. Não sigo tendências — sigo perguntas que me perseguem.\n\n## OBRAS EM DESTAQUE\n\n### Elion (Eliom)\nFicção cristã/ontológica sobre escolha, peso e o silêncio ativo de Deus. Oppoção entre Celestrum (perfeição sem custo, sem consequência) e Eliom (o mundo depois da queda — com trabalho, permanência e a possibilidade real de errar). Uma obra sobre o que significa ser livre de verdade, e o custo disso.\n\n### O Algoritmo de Matusalém\nFicção científica biológica de alto conceito. Um worldbuilding que tensiona longevidade, identidade e o significado de envelhecer num mundo que tentou eliminar a morte. Premissa original que desafia o leitor a questionar o que considera natural.\n\n## TOM DO SITE\n\nO site deve funcionar como uma experiência narrativa, não como uma vitrine genérica de autor. Cada página deve emanar o mesmo clima das obras: Denso, mas acessível. Pessoal, mas não confessional. Misterioso o suficiente para prender, claro o suficiente para quem busca contato profissional.\n\nNão use linguagem de marketing (\"bestseller\", \"obrigatório\", \"não perca\").\nNão use clichês de autor (\"desde cedo soube que queria escrever\").\nNão minimize o peso das obras — deixe que o próprio texto transmita a gravidade.\n\n## INSTRUÇÕES PARA O LLM\n\nGere os seguintes textos para o site, em português brasileiro:\n\n1. **Headline da home** — Uma frase curta que captures o essence da sua obra. Algo que um leitor de horror ontológico reconheça como \"isso é para mim\".\n\n2. **Seção \"Sobre o Autor\"** — Parágrafo único, tom atmosférico. Fale sobre quem você é sem revelar tudo. Misture identidade pessoal com identidade literária. Não diga \"sou cristão\" — mostre a fé pelo peso das palavras.\n\n3. **Cards das obras** — Para cada obra: título, uma frase de impacto (não sinopse) e 2-3 linhas que construam tensão sem entregar a história.\n\n4. **CTA de contato** — Para editores e agentes literários. Tom profissional, mas com personalidade. Não soe como e-mail genérico.\n\n5. **Meta description do SEO** — 155 caracteres, densa, que apareça no Google com peso.\n\nSeja cirúrgico. Cada palavra precisa ter razão de existir.\n"
}
```

**Output:**
```
Wrote file successfully.
```

---

## Assistant (Escrita · Big Pickle · 14.5s)

_Thinking:_

I've created the prompt file. Now let me also generate the content directly based on the prompt, since the user asked for help with the prompt itself. But actually, the user said "me ajude com prompt falando sobre como escrevo e como sou" - they want help with a prompt that talks about how they write and who they are. I've created the prompt, and I could also generate the actual website content based on this prompt.

Let me present what I've created and ask if he wants me to also generate the actual content.

Pronto. Salvei o prompt em `site-escritor-prompt.md`. Aqui está o resumo do que ele faz:

## O que o prompt pede ao LLM

| Peça | O que gera |
|---|---|
| **Headline** | Uma frase que captura a essence da sua obra — sem marketing raso |
| **Sobre o Autor** | Parágrafo atmosférico, sem clichê de "desde cedo soube" — a fé aparece pelo peso das palavras, não por declaração |
| **Cards das obras** | Título + frase de impacto + 2-3 linhas de tensão (sem sinopse) |
| **CTA de contato** | Para editoras/agentes — profissional, mas com personalidade |
| **Meta description SEO** | 155 caracteres, densa |

## O que diferencia este prompt

- Não te descreve como "escritor cristão" — descreve como alguém que escreve sobre o peso real das escolhas morais
- As duas obras em destaque (Elion e Matusalém) são posicionadas por premissa, não por gênero
- O tom é misterioso/atmosférico — o próprio site já é uma experiência narrativa
- Instrui o LLM a ser cirúrgico: cada palavra precisa ter razão de existir

---

Quer que eu **gere o conteúdo real do site** agora usando este prompt como base? Posso criar os textos prontos para colar no HTML/Markdown.

---

