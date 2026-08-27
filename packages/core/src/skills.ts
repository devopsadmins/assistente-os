/**
 * Skills por soul — instruções declarativas versionadas (`SKILL.md`) que entram
 * no prompt só quando relevantes.
 *
 * Este módulo é lógica pura + leitura de filesystem (parse, descoberta, matcher).
 * O logging/audit/métrica fica com o daemon.
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Soul } from "./souls.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_DESCRIPTION = 280;

export interface SkillFrontmatter {
  name: string;
  description: string;
  keywords: string[];
  tools: string[];
}

export type SkillParseResult =
  | { ok: true; frontmatter: SkillFrontmatter; body: string }
  | { ok: false; issues: string[] };

/**
 * Parser de frontmatter FLAT (`key: value`, listas inline `[a, b]` ou em bloco
 * `key:` + linhas `  - item`). Nunca lança — acumula issues (o dry-run precisa
 * reportar todos). Não depende de nenhuma lib de YAML.
 */
export function parseSkillFrontmatter(raw: string): SkillParseResult {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { ok: false, issues: ["frontmatter ausente: o arquivo deve começar com '---' e ter um segundo '---'"] };

  const [, block, rest] = m;
  const issues: string[] = [];
  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};

  const lines = (block ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue; // linha não reconhecida — ignora
    const key = kv[1]!;
    const val = (kv[2] ?? "").trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      lists[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (val === "") {
      // lista em bloco: consome as linhas seguintes '  - item'
      const items: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const it = /^\s+-\s+(.*)$/.exec(lines[j]!);
        if (!it) break;
        const v = it[1]!.trim();
        if (v) items.push(v);
      }
      if (j > i + 1) {
        lists[key] = items;
        i = j - 1;
      } else {
        scalars[key] = "";
      }
    } else {
      scalars[key] = val;
    }
  }

  const name = scalars.name ?? "";
  if (!name) issues.push("name: obrigatório");
  else if (!SLUG_RE.test(name)) issues.push(`name: slug inválido '${name}' (esperado ^[a-z0-9][a-z0-9-]{1,63}$)`);

  const description = scalars.description ?? "";
  if (!description) issues.push("description: obrigatória");
  else if (description.length > MAX_DESCRIPTION) issues.push(`description: excede ${MAX_DESCRIPTION} chars (${description.length})`);

  if ("keywords" in scalars) issues.push("keywords: deve ser uma lista ([a, b] ou linhas '- item')");
  if ("tools" in scalars) issues.push("tools: deve ser uma lista ([a, b] ou linhas '- item')");

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    frontmatter: {
      name,
      description,
      keywords: lists.keywords ?? [],
      tools: lists.tools ?? [],
    },
    body: (rest ?? "").trim(),
  };
}

// ── Descoberta / loader ──────────────────────────────────────────────────

export interface LoadedSkill extends SkillFrontmatter {
  scope: "soul" | "global";
  path: string;
  body: string;
  bytes: number;
}

export interface DiscoveredSkill {
  name: string;
  scope: "soul" | "global";
  path: string;
}

function globalSkillPath(home: string, name: string): string {
  return join(home, "skills", name, "SKILL.md");
}
function soulSkillPath(home: string, soulId: string, name: string): string {
  return join(home, "souls", soulId, "skills", name, "SKILL.md");
}

/** per-soul primeiro, senão global; null se não existe em nenhum. */
export function resolveSkillPath(
  home: string,
  soulId: string,
  name: string,
): { path: string; scope: "soul" | "global" } | null {
  const s = soulSkillPath(home, soulId, name);
  if (existsSync(s)) return { path: s, scope: "soul" };
  const g = globalSkillPath(home, name);
  if (existsSync(g)) return { path: g, scope: "global" };
  return null;
}

function listSkillNamesIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Todas as skills EXISTENTES (soul + global; soul sobrescreve global por nome), sem allowlist. */
export function scanSkillDirs(home: string, soulId: string): DiscoveredSkill[] {
  const bySoul = listSkillNamesIn(join(home, "souls", soulId, "skills"));
  const byGlobal = listSkillNamesIn(join(home, "skills"));
  const out = new Map<string, DiscoveredSkill>();
  for (const name of byGlobal) out.set(name, { name, scope: "global", path: globalSkillPath(home, name) });
  for (const name of bySoul) out.set(name, { name, scope: "soul", path: soulSkillPath(home, soulId, name) });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const skillCache = new Map<string, { mtimeMs: number; skill: LoadedSkill }>();

function loadSkillFile(path: string, scope: "soul" | "global"): LoadedSkill | null {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const cached = skillCache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.skill;

  const raw = readFileSync(path, "utf8");
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed.ok) return null;
  const skill: LoadedSkill = { ...parsed.frontmatter, scope, path, body: parsed.body, bytes: st.size };
  skillCache.set(path, { mtimeMs: st.mtimeMs, skill });
  return skill;
}

/** Skills da allowlist da soul (`agent.permissions.skills`), resolvidas e parseadas. Ignora as que não resolvem/parseiam. */
export function listSkills(home: string, soul: Soul): LoadedSkill[] {
  const allow = soul.config.agent?.permissions?.skills ?? [];
  const out: LoadedSkill[] = [];
  for (const name of allow) {
    const r = resolveSkillPath(home, soul.id, name);
    if (!r) continue;
    const s = loadSkillFile(r.path, r.scope);
    if (s) out.push(s);
  }
  return out;
}
