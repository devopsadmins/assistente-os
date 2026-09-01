import type { Pool } from "pg";
import { CAPABILITY_CATALOG } from "./policy.js";

/**
 * Lista de capabilities/skills que o admin (modo especialista) libera pro
 * self-service (modo amigável) escolher na criação/configurações de soul —
 * ver docs/PLANO-CRIACAO-SOULS.md §4 pro catálogo original, fechado por
 * padrão pra qualquer conta self-service (capabilities:[] até o admin abrir
 * algo aqui). Migração 0019_friendly_allowlist.
 */

export interface FriendlyAllowlist {
  capabilities: string[];
  skills: string[];
}

export async function getFriendlyAllowlist(pool: Pool): Promise<FriendlyAllowlist> {
  const { rows } = await pool.query<{ pattern: string; kind: string }>(
    "SELECT pattern, kind FROM friendly_allowlist ORDER BY pattern",
  );
  return {
    capabilities: rows.filter((r) => r.kind === "capability").map((r) => r.pattern),
    skills: rows.filter((r) => r.kind === "skill").map((r) => r.pattern),
  };
}

/**
 * Substitui a allowlist inteira (não incremental) — reflete exatamente o que
 * o admin marcou na tela na hora de salvar. Patterns fora do
 * CAPABILITY_CATALOG são silenciosamente ignorados (defesa: mesmo que a UI
 * tenha um bug e mande algo inválido, nunca entra na allowlist como se fosse
 * uma capability real). Skills não são validadas contra um catálogo fechado
 * aqui — variam por instalação (dirs de skill global) — a rota chamadora
 * decide se quer checar contra scanSkillDirs antes de chamar isto.
 */
export async function setFriendlyAllowlist(pool: Pool, next: FriendlyAllowlist): Promise<void> {
  const knownCapabilities = new Set(CAPABILITY_CATALOG.map((e) => e.pattern));
  const capabilities = [...new Set(next.capabilities.filter((p) => knownCapabilities.has(p)))];
  const skills = [...new Set(next.skills)];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM friendly_allowlist");
    for (const pattern of capabilities) {
      await client.query("INSERT INTO friendly_allowlist (pattern, kind) VALUES ($1, 'capability')", [pattern]);
    }
    for (const pattern of skills) {
      await client.query("INSERT INTO friendly_allowlist (pattern, kind) VALUES ($1, 'skill')", [pattern]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
