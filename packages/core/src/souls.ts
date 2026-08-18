import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SoulConfig {
  name: string;
  description?: string;
  /** Provider customizado do opencode (ex.: "zen-sousa") e modelos, se a soul tiver identidade própria. */
  provider?: string;
  models?: {
    chat?: string;
    embed?: string;
  };
  /** Limite de gasto diário em unidades do provedor, se aplicável. */
  dailyLimit?: number;
  /** Limite de turnos (prompts) por sessão aberta, se aplicável. */
  maxTurns?: number;
}

export interface Soul {
  id: string;
  dir: string;
  config: SoulConfig;
}

const SOUL_FILES = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"] as const;

export function soulsDir(configHome: string): string {
  return join(configHome, "souls");
}

export function ensureSoulsDir(configHome: string): string {
  const dir = soulsDir(configHome);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function soulDir(soulsRoot: string, id: string): string {
  return join(soulsRoot, id);
}

export function readSoulConfig(dir: string): SoulConfig {
  const p = join(dir, "config.json");
  if (!existsSync(p)) return { name: "", description: "" };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SoulConfig;
  } catch {
    return { name: "", description: "" };
  }
}

export function writeSoulConfig(dir: string, config: SoulConfig): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Lista as souls presentes em <soulsRoot> (uma subpasta com config.json ou arquivo de alma). */
export function listSouls(configHome: string): Soul[] {
  const root = soulsDir(configHome);
  if (!existsSync(root)) return [];
  const out: Soul[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const config = readSoulConfig(dir);
    const id = entry.name;
    out.push({ id, dir, config: { ...config, name: id } });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function createSoul(configHome: string, id: string, config: SoulConfig): Soul {
  const dir = soulDir(ensureSoulsDir(configHome), id);
  writeSoulConfig(dir, { ...config, name: id });
  return { id, dir, config: { ...config, name: id } };
}

export function getSoul(configHome: string, id: string): Soul | null {
  const dir = soulDir(soulsDir(configHome), id);
  if (!existsSync(dir)) return null;
  return { id, dir, config: { ...readSoulConfig(dir), name: id } };
}

export function setActiveSoul(configHome: string, id: string): void {
  const file = join(configHome, "active.json");
  mkdirSync(configHome, { recursive: true });
  writeFileSync(file, JSON.stringify({ soul: id }, null, 2) + "\n", "utf8");
}

export function getActiveSoul(configHome: string): string | null {
  const file = join(configHome, "active.json");
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { soul?: string };
    return data.soul ?? null;
  } catch {
    return null;
  }
}

/** Cria os arquivos de alma padrão (perfil/contexto/licoes/pessoas) se não existirem. */
export function ensureSoulFiles(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  for (const name of SOUL_FILES) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      writeFileSync(p, "", "utf8");
    }
  }
  mkdirSync(join(dir, "sessoes"), { recursive: true });
  mkdirSync(join(dir, "sources"), { recursive: true });
  return SOUL_FILES.map((f) => join(dir, f));
}
