/**
 * Execution manifest (E8.2 / gate AI-3).
 *
 * Retrato reproduzível do que está em execução por release: sha do código,
 * modelos por tier, hash do "system prompt" de cada soul, catálogo de
 * capabilities L1/L2/L3 vigente, tools + níveis, dirs de contexto RAG e as
 * migrações de banco aplicadas.
 *
 * Determinístico: mesmo estado → mesmo `hash`. O `generatedAt` fica FORA do
 * hash de propósito (senão nunca reproduziria).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { listSouls } from "./souls.js";
import { CAPABILITY_CATALOG, CAPABILITY_CATALOG_VERSION } from "./policy.js";
import { loadConfig } from "./config.js";
import { CONCISE_OUTPUT_DIRECTIVE } from "./prompts/system-base.js";

const SOUL_PROMPT_FILES = ["perfil.md", "contexto.md", "soul.md"] as const;

export interface ManifestSoul {
  id: string;
  provider: string | null;
  model: string | null;
  systemPromptHash: string;
  ragDirs: string[];
}

export interface ExecutionManifest {
  schemaVersion: 1;
  generatedAt: string;
  gitSha: string | null;
  routerTiers: string[];
  capabilityCatalog: {
    version: string;
    tools: Array<{ pattern: string; level: string }>;
  };
  souls: ManifestSoul[];
  migrations: string[];
  /** Config de RAG que altera as respostas (entra no hash — dois deploys com
   * RAG_RERANK diferente têm hashes diferentes). */
  rag: {
    embedModel: string;
    embedDims: number;
    rerankMode: "off" | "cross-encoder" | "llm";
    injectionMode: "aviso" | "recusar";
    hnswEfSearch: number;
  };
  hash: string;
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function soulSystemPromptHash(home: string, soulId: string): string {
  const h = createHash("sha256");
  h.update(CONCISE_OUTPUT_DIRECTIVE);
  const dir = join(home, "souls", soulId);
  for (const f of SOUL_PROMPT_FILES) {
    const p = join(dir, f);
    h.update(`\n--${f}--\n`);
    if (existsSync(p)) h.update(readFileSync(p, "utf8"));
  }
  const cfg = join(dir, "config.json");
  if (existsSync(cfg)) h.update(`\n--config--\n${readFileSync(cfg, "utf8")}`);
  return h.digest("hex");
}

export async function buildExecutionManifest(opts: { home: string; pool: Pool }): Promise<ExecutionManifest> {
  const { home, pool } = opts;
  const config = loadConfig({ home });

  let migrations: string[] = [];
  try {
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
    migrations = rows.map((r) => r.id);
  } catch {
    /* banco indisponível — manifesto sai sem a lista de migrações */
  }

  const souls: ManifestSoul[] = listSouls(home).map((s) => ({
    id: s.id,
    provider: s.config.provider ?? null,
    model: s.config.models?.chat ?? null,
    systemPromptHash: soulSystemPromptHash(home, s.id),
    ragDirs: [`souls/${s.id}/`, `souls/${s.id}/sources/`],
  }));

  const capabilityCatalog = {
    version: CAPABILITY_CATALOG_VERSION,
    tools: CAPABILITY_CATALOG.map((e) => ({ pattern: e.pattern, level: e.level })),
  };

  const core = {
    schemaVersion: 1 as const,
    gitSha: gitSha(),
    routerTiers: config.routerTiers,
    capabilityCatalog,
    souls,
    migrations,
    rag: {
      // embedder primário é Xenova/multilingual-e5-base (local, 768d); este é o
      // fallback via Ollama — ambos 768d, então a coluna vector(768) é consistente.
      embedModel: config.ollamaEmbedModel,
      embedDims: 768,
      rerankMode: config.ragRerankMode,
      injectionMode: config.ragInjectionMode,
      hnswEfSearch: config.ragHnswEfSearch,
    },
  };

  const hash = createHash("sha256").update(canonicalJson(core)).digest("hex");

  return { ...core, generatedAt: new Date().toISOString(), hash };
}

/** JSON de chaves ordenadas recursivamente (arrays mantêm ordem). */
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
