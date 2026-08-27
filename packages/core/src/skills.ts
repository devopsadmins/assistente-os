/**
 * Skills por soul — instruções declarativas versionadas (`SKILL.md`) que entram
 * no prompt só quando relevantes.
 *
 * Este módulo é lógica pura + leitura de filesystem (parse, descoberta, matcher).
 * O logging/audit/métrica fica com o daemon.
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Soul } from "./souls.js";
import { cache } from "./cache.js";

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

// ── Matcher híbrido léxico + embedding ──────────────────────────────────

export function skillMatchThreshold(): number {
  const n = Number(process.env.SKILL_MATCH_THRESHOLD);
  return Number.isFinite(n) && n >= 0 ? n : 0.35;
}
export function skillMaxActive(): number {
  const n = Number(process.env.SKILL_MAX_ACTIVE);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}
export function skillsEnabled(): boolean {
  return (process.env.SKILLS_ENABLED ?? "1") !== "0";
}

export interface SkillMatch {
  skill: LoadedSkill;
  score: number;
  lexicalHits: string[];
  usedEmbedding: boolean;
}

export interface SkillMatchOptions {
  threshold?: number;
  max?: number;
  /** Injetável (teste / auto-skip). Recebe textos, devolve vetores. undefined = só-léxico. */
  embed?: (texts: string[]) => Promise<number[][]>;
}

const STOPWORDS = new Set([
  "que", "com", "para", "por", "uma", "dos", "das", "não", "nao", "seu", "sua",
  "the", "and", "for", "you", "are", "com", "como", "isso", "aqui", "faz",
]);

function normTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}
function normText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function descEmbedding(
  description: string,
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<number[]> {
  const key = createHash("sha1").update(description).digest("hex");
  try {
    const hit = await cache.getEmbedding(key);
    if (hit) return JSON.parse(hit) as number[];
  } catch {
    /* cache opcional */
  }
  const [vec] = await embed([description]);
  if (vec) {
    try {
      await cache.setEmbedding(key, JSON.stringify(vec));
    } catch {
      /* cache opcional */
    }
  }
  return vec ?? [];
}

/**
 * Casa `prompt` contra `skills` por relevância. Híbrido:
 *  - léxico (overlap de tokens de description+keywords; boost 0.6 se uma keyword
 *    frase inteira é substring do prompt normalizado);
 *  - embedding (cosine da description; vetor da description cacheado por sha1);
 *    qualquer falha do embedder → auto-skip para só-léxico naquela skill.
 * `score = usedEmbedding ? 0.5*lex + 0.5*emb : lex`. Ordena desc, filtra >= threshold, corta em max.
 */
export async function matchSkills(
  prompt: string,
  skills: LoadedSkill[],
  opts: SkillMatchOptions = {},
): Promise<SkillMatch[]> {
  if (skills.length === 0) return [];
  const threshold = opts.threshold ?? skillMatchThreshold();
  const max = opts.max ?? skillMaxActive();

  const promptTokens = new Set(normTokens(prompt));
  const promptNorm = normText(prompt);

  let promptVec: number[] | null = null;
  if (opts.embed) {
    try {
      const [v] = await opts.embed([prompt]);
      promptVec = v ?? null;
    } catch {
      promptVec = null;
    }
  }

  const scored: SkillMatch[] = [];
  for (const skill of skills) {
    const skillTokens = normTokens(`${skill.description} ${skill.keywords.join(" ")}`);
    const uniq = new Set(skillTokens);
    let hitCount = 0;
    for (const t of uniq) if (promptTokens.has(t)) hitCount++;
    let lex = uniq.size ? hitCount / uniq.size : 0;

    const lexicalHits: string[] = [];
    for (const kw of skill.keywords) {
      if (normText(kw) && promptNorm.includes(normText(kw))) {
        lexicalHits.push(kw);
        lex = Math.max(lex, 0.6);
      }
    }
    for (const t of uniq) if (promptTokens.has(t) && !lexicalHits.includes(t)) lexicalHits.push(t);

    let usedEmbedding = false;
    let score = lex;
    if (opts.embed && promptVec) {
      try {
        const dv = await descEmbedding(skill.description, opts.embed);
        if (dv.length) {
          // Modelos estilo e5 dão cosine alto (~0.5+) mesmo para textos sem
          // relação — subtrai a baseline: cos 0.5 → 0, cos 1.0 → 1.
          const embAdj = Math.max(0, (cosine(promptVec, dv) - 0.5) / 0.5);
          score = 0.5 * lex + 0.5 * embAdj;
          usedEmbedding = true;
        }
      } catch {
        usedEmbedding = false;
        score = lex;
      }
    }

    scored.push({ skill, score, lexicalHits, usedEmbedding });
  }

  return scored
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// ── Renderer do bloco de prompt ────────────────────────────────────────

/**
 * Bloco pronto para o prompt: índice de TODAS as skills da allowlist (nome +
 * description) + o corpo completo das ativas. `""` se `available` vazio.
 * `isToolAllowed` marca as `skill.tools` fora da allowlist da soul.
 */
export function renderSkillsPrompt(
  available: LoadedSkill[],
  active: SkillMatch[],
  isToolAllowed: (tool: string) => boolean,
): string {
  if (available.length === 0) return "";
  const parts: string[] = [
    "## Skills disponíveis (ative mentalmente a que se aplica)",
    ...available.map((s) => `- ${s.name} — ${s.description}`),
  ];
  for (const m of active) {
    const s = m.skill;
    parts.push("", `## Skill ativa: ${s.name}`, s.body);
    if (s.tools.length > 0) {
      const rendered = s.tools
        .map((t) => (isToolAllowed(t) ? `\`${t}\`` : `\`${t}\` (indisponível para esta soul)`))
        .join(", ");
      parts.push(`Ferramentas relevantes: ${rendered}`);
    }
  }
  return parts.join("\n");
}
