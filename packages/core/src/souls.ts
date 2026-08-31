import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types/agent.js";

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
  /** Configuração de agente: permissões de tools, skills e guardrails. */
  agent?: AgentConfig;
  /**
   * Dono da soul no modo amigável self-service (id de `accounts`, ver
   * packages/core/src/accounts.ts). Ausente = soul do operador (modo
   * especialista) ou criada antes das contas existirem — nunca listada/
   * acessível por sessão de conta, só pelo token admin.
   */
  ownerAccountId?: number;
  /**
   * Nome amigável editável pelo dono, distinto de `name` (que é sempre o
   * slug/id — forçado em createSoul/createSoulFull/listSouls/getSoul, nunca
   * mude essa invariante). Só o modo amigável usa este campo; ausente =
   * mostra `description` ou o id como fallback.
   */
  displayName?: string;
}

export interface Soul {
  id: string;
  dir: string;
  config: SoulConfig;
}

const SOUL_FILES = ["perfil.md", "contexto.md", "licoes.md", "pessoas.md", "soul.md"] as const;
export type SoulFileName = (typeof SOUL_FILES)[number];

/** dirs/ da estrutura "completa" de uma soul (docs/PLANO-CRIACAO-SOULS.md §2 "Estrutura criada"). */
const SOUL_SUBDIRS = ["sessoes", "sources", "decisoes", "skills"] as const;

export function soulsDir(configHome: string): string {
  return join(configHome, "souls");
}

export function ensureSoulsDir(configHome: string): string {
  const dir = soulsDir(configHome);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Soul ids são nomes de diretório: letras, números, `_` e `-` apenas. */
const SOUL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidSoulId(id: string): boolean {
  return typeof id === "string" && SOUL_ID_PATTERN.test(id);
}

export function soulDir(soulsRoot: string, id: string): string {
  if (!isValidSoulId(id)) {
    throw new Error(`soulId inválido: ${JSON.stringify(id)}`);
  }
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
    // Diretórios temporários de createSoulFull() (ex. de um processo que morreu
    // no meio da criação, antes do rollback) nunca devem aparecer como souls reais.
    if (entry.name.startsWith(".")) continue;
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

export type CreateSoulFullResult =
  | { created: true; soul: Soul }
  | { created: false; code: "E_VALIDATION" | "E_CONFLICT"; reason: string };

/**
 * Cria uma soul de forma atômica (docs/PLANO-CRIACAO-SOULS.md §5.2 passo 5):
 * monta config.json + arquivos de alma + dirs (sessoes/, sources/, decisoes/)
 * inteiramente em um diretório temporário dentro de soulsDir, e só publica via
 * rename() exclusivo. O temp dir mora na mesma soulsDir (mesmo filesystem) para
 * o rename ser atômico — não passa por uma cópia entre filesystems.
 *
 * Corrida: duas chamadas com o mesmo id populam temp dirs próprios e disputam o
 * rename(); a primeira vence porque finalDir ainda não existe. A segunda encontra
 * finalDir já não-vazio — POSIX rename() sobre um diretório não-vazio falha com
 * ENOTEMPTY (ou EEXIST, dependendo do SO) — e essa chamada recebe E_CONFLICT sem
 * corromper o que a primeira já publicou.
 *
 * Qualquer falha intermediária (escrita, mkdir, rename) remove o temp dir antes
 * de propagar o erro — nunca deixa um diretório residual pela metade.
 */
export function createSoulFull(
  configHome: string,
  id: string,
  config: SoulConfig,
  files?: Partial<Record<SoulFileName, string>>,
): CreateSoulFullResult {
  if (!isValidSoulId(id)) {
    return { created: false, code: "E_VALIDATION", reason: `soulId inválido: ${JSON.stringify(id)}` };
  }
  const root = ensureSoulsDir(configHome);
  const finalDir = join(root, id);
  if (existsSync(finalDir)) {
    return { created: false, code: "E_CONFLICT", reason: `soul '${id}' já existe` };
  }

  const tempDir = mkdtempSync(join(root, `.tmp-${id}-`));
  try {
    const fullConfig: SoulConfig = { ...config, name: id };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(fullConfig, null, 2) + "\n", "utf8");
    for (const name of SOUL_FILES) {
      writeFileSync(join(tempDir, name), files?.[name] ?? "", "utf8");
    }
    for (const sub of SOUL_SUBDIRS) {
      mkdirSync(join(tempDir, sub), { recursive: true });
    }
    renameSync(tempDir, finalDir);
    return { created: true, soul: { id, dir: finalDir, config: fullConfig } };
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      return { created: false, code: "E_CONFLICT", reason: `soul '${id}' já existe (corrida de criação)` };
    }
    throw err;
  }
}

export function getSoul(configHome: string, id: string): Soul | null {
  const dir = soulDir(soulsDir(configHome), id);
  if (!existsSync(dir)) return null;
  return { id, dir, config: { ...readSoulConfig(dir), name: id } };
}

export interface SetActiveSoulResult {
  previousActiveSoul: string | null;
  activeSoul: string;
}

/** write+rename atômico de active.json — nunca deixa um leitor ver um arquivo parcialmente escrito. */
function writeActiveSoulAtomic(configHome: string, id: string | null): void {
  const file = join(configHome, "active.json");
  mkdirSync(configHome, { recursive: true });
  if (id === null) {
    if (existsSync(file)) rmSync(file);
    return;
  }
  const tempFile = join(configHome, `.active.json.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tempFile, JSON.stringify({ soul: id }, null, 2) + "\n", "utf8");
  renameSync(tempFile, file);
}

/**
 * Troca a soul ativa de forma atômica, retornando o valor anterior para que o
 * chamador possa fazer rollback com rollbackActiveSoul() se um passo posterior
 * falhar (docs/PLANO-CRIACAO-SOULS.md §2 "set_active": "swap atômico
 * preservando valor anterior p/ rollback").
 */
export function setActiveSoul(configHome: string, id: string): SetActiveSoulResult {
  const previousActiveSoul = getActiveSoul(configHome);
  writeActiveSoulAtomic(configHome, id);
  return { previousActiveSoul, activeSoul: id };
}

/** Desfaz um setActiveSoul(): restaura o valor anterior, ou remove active.json se não havia soul ativa antes. */
export function rollbackActiveSoul(configHome: string, previousActiveSoul: string | null): void {
  writeActiveSoulAtomic(configHome, previousActiveSoul);
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
  for (const sub of SOUL_SUBDIRS) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return SOUL_FILES.map((f) => join(dir, f));
}
