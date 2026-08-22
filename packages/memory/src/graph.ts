import type { Pool } from "@assistente-os/core";

export interface Entity {
  name: string;
  kind: string;
  properties: Record<string, unknown> | null;
}

export interface Relation {
  from: string;
  rel: string;
  to: string;
  properties: Record<string, unknown> | null;
}

export interface Observation {
  entity: string;
  body: string;
  ts: string;
  source?: string;
}

export async function upsertEntity(
  pool: Pool,
  soul: string,
  name: string,
  kind = "unknown",
  properties: Record<string, unknown> | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO entities (soul, name, kind, properties) VALUES ($1, $2, $3, $4)
     ON CONFLICT (soul, name) DO UPDATE SET kind = excluded.kind, properties = excluded.properties`,
    [soul, name, kind, properties],
  );
}

export async function upsertRelation(
  pool: Pool,
  soul: string,
  from: string,
  rel: string,
  to: string,
  properties: Record<string, unknown> | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO relations (soul, from_name, rel, to_name, properties) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (soul, from_name, rel, to_name) DO UPDATE SET properties = excluded.properties`,
    [soul, from, rel, to, properties],
  );
}

export async function addObservation(pool: Pool, soul: string, entity: string, body: string, source?: string): Promise<void> {
  await pool.query("INSERT INTO observations (soul, entity_name, body, ts, source) VALUES ($1, $2, $3, $4, $5)", [
    soul,
    entity,
    body,
    new Date().toISOString(),
    source ?? null,
  ]);
}

export async function listEntities(pool: Pool, soul: string, limit = 100): Promise<Entity[]> {
  const { rows } = await pool.query<{ name: string; kind: string; properties: Record<string, unknown> | null }>(
    "SELECT name, kind, properties FROM entities WHERE soul = $1 ORDER BY name LIMIT $2",
    [soul, limit],
  );
  return rows.map((r) => ({ name: r.name, kind: r.kind, properties: r.properties }));
}

export async function listRelations(pool: Pool, soul: string, limit = 200): Promise<Relation[]> {
  const { rows } = await pool.query<{ from_name: string; rel: string; to_name: string; properties: Record<string, unknown> | null }>(
    "SELECT from_name, rel, to_name, properties FROM relations WHERE soul = $1 ORDER BY id LIMIT $2",
    [soul, limit],
  );
  return rows.map((r) => ({ from: r.from_name, rel: r.rel, to: r.to_name, properties: r.properties }));
}

/**
 * Lista observações da soul, com filtro opcional por origem (`entity`, ex.:
 * "whatsapp") e/ou busca textual em `body` (`q`, via ILIKE).
 */
export async function listObservations(pool: Pool, soul: string, entity?: string, q?: string, limit = 100): Promise<Observation[]> {
  const conditions = ["soul = $1"];
  const params: unknown[] = [soul];
  if (entity) {
    params.push(entity);
    conditions.push(`entity_name = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`body ILIKE $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query<{ entity_name: string; body: string; ts: string; source: string | null }>(
    `SELECT entity_name, body, ts, source FROM observations WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ entity: r.entity_name, body: r.body, ts: r.ts, source: r.source ?? undefined }));
}

async function countTable(pool: Pool, table: "entities" | "relations" | "observations", soul: string): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(`SELECT COUNT(*) AS c FROM ${table} WHERE soul = $1`, [soul]);
  return Number(rows[0]?.c ?? 0);
}

export async function graphStats(pool: Pool, soul: string): Promise<{ entities: number; relations: number; observations: number }> {
  const [entities, relations, observations] = await Promise.all([
    countTable(pool, "entities", soul),
    countTable(pool, "relations", soul),
    countTable(pool, "observations", soul),
  ]);
  return { entities, relations, observations };
}
