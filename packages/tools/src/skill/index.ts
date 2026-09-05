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
