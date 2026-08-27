/**
 * `os skill` — list / show / create de SKILL.md (global ou per-soul).
 * Lógica separada do dispatcher para ser testável sem child_process.
 */
import { readFileSync } from "node:fs";
import {
  scanSkillDirs,
  resolveSkillPath,
  parseSkillFrontmatter,
  writeSkillFile,
  getSoul,
  type SkillFrontmatter,
} from "@assistente-os/core";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}
function csv(v: string | undefined): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function runSkillCommand(home: string, args: string[]): string {
  const sub = args[0];
  const soulId = flag(args, "--soul") ?? "main";

  if (sub === "list") {
    const allow = new Set(getSoul(home, soulId)?.config.agent?.permissions?.skills ?? []);
    const rows = scanSkillDirs(home, soulId).map((d) => {
      let description = "";
      try {
        const p = parseSkillFrontmatter(readFileSync(d.path, "utf8"));
        if (p.ok) description = p.frontmatter.description;
      } catch {
        /* ilegível */
      }
      return `  ${d.name}  [${d.scope}${allow.has(d.name) ? ", allowlist ✓" : ""}]  ${description}`;
    });
    return rows.length ? `skills visíveis para '${soulId}':\n${rows.join("\n")}` : `(nenhuma skill para '${soulId}')`;
  }

  if (sub === "show") {
    const name = args[1];
    if (!name) return "uso: os skill show <name> [--soul <id>]";
    const r = resolveSkillPath(home, soulId, name);
    if (!r) return `skill '${name}' não encontrada (soul '${soulId}' nem global)`;
    return `# ${r.path} (${r.scope})\n\n${readFileSync(r.path, "utf8")}`;
  }

  if (sub === "create") {
    const name = args[1];
    const description = flag(args, "--desc") ?? flag(args, "--description");
    if (!name || !description) return "uso: os skill create <name> --desc \"...\" [--scope soul|global] [--soul <id>] [--tools a,b] [--keywords x,y] [--body-file <path>]";
    const scope = flag(args, "--scope") === "global" ? "global" : "soul";
    const bodyFile = flag(args, "--body-file");
    const body = bodyFile ? readFileSync(bodyFile, "utf8") : (flag(args, "--body") ?? "");
    const fm: SkillFrontmatter = {
      name,
      description,
      keywords: csv(flag(args, "--keywords")),
      tools: csv(flag(args, "--tools")),
    };
    const res = writeSkillFile(home, scope, scope === "soul" ? soulId : undefined, fm, body);
    return res.ok ? `criada: ${res.path}` : `erro (${res.code}): ${res.reason}`;
  }

  return "uso: os skill <list|show|create> ...";
}
