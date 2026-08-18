import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { resolveHome } from "./config.js";
import { ensureSoulsDir, writeSoulConfig } from "./souls.js";

const MD_EXT = new Set([".md", ".markdown"]);
/** Arquivos de alma que viram conteúdo top-level da soul (o resto vai p/ sources/). */
const CORE_SOUL_FILES = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"];

export interface MigrationSummary {
  migrated: number;
  skipped: string[];
  perSoul: Record<string, { files: number; md: number }>;
}

/**
 * Migra almas do SLC-OS (formato Python/OpenClaw) para o formato Assistente OS.
 * Regra: cada alma vira uma soul em <home>/souls/<id>/.
 *  - perfil/contexto/licoes/pessoas -> top-level (mesmos nomes)
 *  - sessoes/ e conhecimento/ -> preservados como estão
 *  - documentos/ -> sources/documentos/
 *  - qualquer .md dentro de conhecimento/ vira sources/knowledge (fonte p/ RAG)
 */
export function migrateAlmas(sourceRoot: string, targetHome = resolveHome()): MigrationSummary {
  const out: MigrationSummary = { migrated: 0, skipped: [], perSoul: {} };
  if (!existsSync(sourceRoot)) return { ...out, skipped: [`fonte não encontrada: ${sourceRoot}`] };
  const soulsRoot = ensureSoulsDir(targetHome);
  const almas = readdirSync(sourceRoot, { withFileTypes: true }).filter((e) => e.isDirectory());

  for (const alma of almas) {
    const src = join(sourceRoot, alma.name);
    const dest = join(soulsRoot, alma.name);
    const counter = { files: 0, md: 0 };
    const errors: string[] = [];

    // Diretórios de alma: sessoes/ e conhecimento/ preservam a árvore no top-level;
    // todo o resto (documentos/, pdf, json, py, etc.) vai para sources/ preservando a árvore.
    const topLevelDirs = new Set(["sessoes", "conhecimento"]);
    const walk = (from: string, to: string, mode: "root" | "tree") => {
      if (!existsSync(from)) return;
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const fp = join(from, entry.name);
        if (entry.isDirectory()) {
          if (mode === "root") {
            walk(fp, topLevelDirs.has(entry.name) ? join(to, entry.name) : join(to, "sources", entry.name), "tree");
          } else {
            walk(fp, join(to, entry.name), "tree");
          }
        } else if (entry.isFile()) {
          // ignora configs/segredos/caches
          if (entry.name === "config.json" || entry.name.endsWith(".local.json")) continue;
          if (/(^|[/\\])(\.env|\.env\.local|node_modules|__pycache__|\.git)([/\\]|$)/.test(fp)) continue;
          const rel = relative(src, fp);
          const target = mode === "root" && !CORE_SOUL_FILES.includes(entry.name) ? join(to, "sources") : to;
          mkdirSync(target, { recursive: true });
          try {
            copyFileSync(fp, join(target, entry.name));
            counter.files++;
            if (MD_EXT.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) counter.md++;
          } catch (err) {
            errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    };

    walk(src, dest, "root");
    // config da soul: id + descrição derivada do perfil, se existir
    writeSoulConfig(dest, { name: alma.name });
    out.perSoul[alma.name] = { files: counter.files, md: counter.md };
    if (counter.files === 0) out.skipped.push(alma.name);
    else out.migrated++;
  }
  return out;
}

/** Imprime o resumo da migração no terminal (para o CLI). */
export function printMigrationSummary(summary: MigrationSummary): void {
  console.log(`Souls migradas: ${summary.migrated}`);
  for (const [name, c] of Object.entries(summary.perSoul)) {
    console.log(`  ${name}: ${c.files} arquivos (${c.md} markdown)`);
  }
  if (summary.skipped.length > 0) {
    console.log(`Sem conteúdo (ignoradas): ${summary.skipped.join(", ")}`);
  }
}

/**
 * Importa o Segundo Cérebro como uma Soul no Assistente OS.
 */
export function importSegundoCerebro(sourceRoot: string, targetHome = resolveHome(), soulName = "segundo-cerebro"): MigrationSummary {
  const out: MigrationSummary = { migrated: 0, skipped: [], perSoul: {} };
  if (!existsSync(sourceRoot)) return { ...out, skipped: [`fonte não encontrada: ${sourceRoot}`] };
  
  const soulsRoot = ensureSoulsDir(targetHome);
  const dest = join(soulsRoot, soulName);
  const counter = { files: 0, md: 0 };
  const errors: string[] = [];
  
  const walk = (from: string, to: string, mode: "root" | "tree") => {
    if (!existsSync(from)) return;
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const fp = join(from, entry.name);
      if (entry.isDirectory()) {
        if (mode === "root") {
          // ignora pastas ocultas do git, vscode etc no root
          if (entry.name.startsWith(".")) continue;
          walk(fp, join(to, "sources", entry.name), "tree");
        } else {
          walk(fp, join(to, entry.name), "tree");
        }
      } else if (entry.isFile()) {
        // renomeia CLAUDE.md para perfil.md
        let targetName = entry.name;
        if (mode === "root" && targetName === "CLAUDE.md") {
          targetName = "perfil.md";
        }
        
        // no root, tudo que não é perfil.md vai pro sources se não for readme/start-here
        const isRootMisc = mode === "root" && targetName !== "perfil.md" && targetName !== "START-HERE.md" && targetName !== "README.txt";
        const targetDir = isRootMisc ? join(to, "sources") : to;
        
        if (/(^|[/\\])(\.env|\.env\.local|node_modules|__pycache__|\.git)([/\\]|$)/.test(fp)) continue;
        
        mkdirSync(targetDir, { recursive: true });
        try {
          copyFileSync(fp, join(targetDir, targetName));
          counter.files++;
          if (MD_EXT.has(targetName.slice(targetName.lastIndexOf(".")).toLowerCase())) counter.md++;
        } catch (err) {
          errors.push(`${relative(sourceRoot, fp)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };

  walk(sourceRoot, dest, "root");
  writeSoulConfig(dest, { name: soulName, description: "Segundo Cérebro importado" });
  
  out.perSoul[soulName] = { files: counter.files, md: counter.md };
  if (counter.files > 0) out.migrated++;
  
  return out;
}
