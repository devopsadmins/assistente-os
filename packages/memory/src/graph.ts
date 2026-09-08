import { enqueueEntityExtraction, type Pool } from "@assistente-os/core";
import { MIN_BODY_LENGTH_FOR_EXTRACTION } from "./entity-extraction.js";
import { toVectorLiteral } from "./indexer.js";

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

export interface EntityHistoryEntry {
  name: string;
  kind: string;
  properties: Record<string, unknown> | null;
  replacedAt: string;
  replacedBy: string | null;
}

/**
 * Upsert que preserva histórico (ledger, inspirado no Utopia): só grava uma
 * linha em `entity_history` quando `kind`/`properties` realmente mudam — um
 * upsert idempotente (mesmo valor repetido) não gera ruído no histórico.
 * `source` vai para `entity_history.replaced_by` (ex.: "entity_extraction",
 * "observation_add", "manual") pra rastrear quem mudou o quê.
 */
export async function upsertEntity(
  pool: Pool,
  soul: string,
  name: string,
  kind = "unknown",
  properties: Record<string, unknown> | null = null,
  source?: string,
): Promise<void> {
  await pool.query(
    `WITH old AS (
       SELECT id, name, kind, properties FROM entities WHERE soul = $1 AND name = $2
     ), changed AS (
       SELECT id FROM old WHERE kind IS DISTINCT FROM $3 OR properties IS DISTINCT FROM $4
     ), snapshot AS (
       INSERT INTO entity_history (entity_id, soul, name, kind, properties, replaced_by)
       SELECT old.id, $1, old.name, old.kind, old.properties, $5 FROM old JOIN changed ON changed.id = old.id
     )
     INSERT INTO entities (soul, name, kind, properties, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (soul, name) DO UPDATE SET kind = excluded.kind, properties = excluded.properties, updated_at = now()`,
    [soul, name, kind, properties, source ?? null],
  );
}

export async function upsertRelation(
  pool: Pool,
  soul: string,
  from: string,
  rel: string,
  to: string,
  properties: Record<string, unknown> | null = null,
  source?: string,
): Promise<void> {
  await pool.query(
    `WITH old AS (
       SELECT id, from_name, rel, to_name, properties FROM relations
       WHERE soul = $1 AND from_name = $2 AND rel = $3 AND to_name = $4
     ), changed AS (
       SELECT id FROM old WHERE properties IS DISTINCT FROM $5
     ), snapshot AS (
       INSERT INTO relation_history (relation_id, soul, from_name, rel, to_name, properties, replaced_by)
       SELECT old.id, $1, old.from_name, old.rel, old.to_name, old.properties, $6
       FROM old JOIN changed ON changed.id = old.id
     )
     INSERT INTO relations (soul, from_name, rel, to_name, properties, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (soul, from_name, rel, to_name) DO UPDATE SET properties = excluded.properties, updated_at = now()`,
    [soul, from, rel, to, properties, source ?? null],
  );
}

/** Histórico de mudanças de uma entidade (ledger append-only), mais recente primeiro. */
export async function getEntityHistory(pool: Pool, soul: string, name: string, limit = 50): Promise<EntityHistoryEntry[]> {
  const { rows } = await pool.query<{
    name: string;
    kind: string;
    properties: Record<string, unknown> | null;
    replaced_at: string;
    replaced_by: string | null;
  }>(
    `SELECT eh.name, eh.kind, eh.properties, eh.replaced_at, eh.replaced_by
     FROM entity_history eh
     JOIN entities e ON e.id = eh.entity_id
     WHERE e.soul = $1 AND e.name = $2
     ORDER BY eh.replaced_at DESC
     LIMIT $3`,
    [soul, name, limit],
  );
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    properties: r.properties,
    replacedAt: new Date(r.replaced_at).toISOString(),
    replacedBy: r.replaced_by,
  }));
}

/** Match por nome exato ou por `name_fold` (case-insensitive) — sempre ativo, barato. */
export async function findDuplicateEntityByName(pool: Pool, soul: string, name: string): Promise<Entity | null> {
  const { rows } = await pool.query<{ name: string; kind: string; properties: Record<string, unknown> | null }>(
    `SELECT name, kind, properties FROM entities WHERE soul = $1 AND name_fold = lower($2) LIMIT 1`,
    [soul, name],
  );
  return rows[0] ? { name: rows[0].name, kind: rows[0].kind, properties: rows[0].properties } : null;
}

export interface EmbedderLike {
  embed(text: string): Promise<number[] | null>;
}

export interface GraphDedupConfig {
  embeddingEnabled: boolean;
  threshold: number;
}

/**
 * GRAPH_ENTITY_DEDUP fica OFF por padrão — mesmo padrão de RAG_RERANK/
 * RAG_SEMANTIC_CACHE: custo de embed por entidade extraída só entra depois
 * de medição confirmar ganho real de dedup sobre o fold por nome (sempre
 * ativo, barato).
 */
export function graphDedupConfig(): GraphDedupConfig {
  const raw = (process.env.GRAPH_ENTITY_DEDUP ?? "off").toLowerCase();
  const embeddingEnabled = raw === "on" || raw === "1" || raw === "true";
  const threshold = Math.min(0.999, Math.max(0.5, Number(process.env.GRAPH_ENTITY_DEDUP_THRESHOLD) || 0.92));
  return { embeddingEnabled, threshold };
}

/** Entidade mais próxima por similaridade de embedding, acima do threshold (ou null). */
export async function findSimilarEntity(
  pool: Pool,
  soul: string,
  name: string,
  embedder: EmbedderLike,
  threshold = 0.92,
): Promise<{ name: string; kind: string; similarity: number } | null> {
  const vec = await embedder.embed(name);
  if (!vec) return null;
  const { rows } = await pool.query<{ name: string; kind: string; similarity: number }>(
    `SELECT name, kind, 1 - (embedding <=> $1::vector) AS similarity
     FROM entities
     WHERE soul = $2 AND embedding IS NOT NULL AND name <> $3
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [toVectorLiteral(vec), soul, name],
  );
  const top = rows[0];
  if (!top || top.similarity < threshold) return null;
  return top;
}

/**
 * Resolve o nome canônico de uma entidade recém-extraída: exato → fold
 * (case-insensitive) → similaridade de embedding (se `embedder` for passado
 * e `GRAPH_ENTITY_DEDUP` estiver ligado). Não cria nada — quem chama decide
 * se upserta com o nome bruto (nova entidade) ou com o canônico retornado
 * (evita duplicata).
 */
export async function resolveCanonicalEntityName(
  pool: Pool,
  soul: string,
  rawName: string,
  embedder?: EmbedderLike,
): Promise<{ canonical: string; matchedBy: "exact" | "fold" | "embedding" | null }> {
  const exact = await pool.query<{ name: string }>(`SELECT name FROM entities WHERE soul = $1 AND name = $2 LIMIT 1`, [soul, rawName]);
  if (exact.rows[0]) return { canonical: exact.rows[0].name, matchedBy: "exact" };

  const fold = await findDuplicateEntityByName(pool, soul, rawName);
  if (fold) return { canonical: fold.name, matchedBy: "fold" };

  const dedup = graphDedupConfig();
  if (dedup.embeddingEnabled && embedder) {
    const similar = await findSimilarEntity(pool, soul, rawName, embedder, dedup.threshold);
    if (similar) return { canonical: similar.name, matchedBy: "embedding" };
  }

  return { canonical: rawName, matchedBy: null };
}

/**
 * Grava uma observação e, por padrão, enfileira extração de entidades/relações
 * via LLM em background (packages/memory/src/entity-extraction.ts,
 * processada por packages/daemon/src/entityExtraction.ts). Esse é o ponto
 * único de disparo — todo ponto de entrada atual (modal "Adicionar à alma",
 * tools observation_add) e qualquer futuro que passe a chamar addObservation
 * ganha extração automaticamente, sem precisar religar em cada lugar novo.
 *
 * `options.enqueueExtraction: false` existe para um futuro script de
 * importação em massa não afogar a fila.
 */
export async function addObservation(
  pool: Pool,
  soul: string,
  entity: string,
  body: string,
  source?: string,
  options?: { enqueueExtraction?: boolean },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO observations (soul, entity_name, body, ts, source) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [soul, entity, body, new Date().toISOString(), source ?? null],
  );
  const observationId = Number(rows[0]!.id);

  const shouldEnqueue = options?.enqueueExtraction ?? true;
  if (shouldEnqueue && body.trim().length >= MIN_BODY_LENGTH_FOR_EXTRACTION) {
    try {
      await enqueueEntityExtraction(pool, soul, entity, body, source ?? null, observationId);
    } catch (err) {
      console.error(`[graph] Falha ao enfileirar extração de entidades (non-fatal): ${(err as Error).message}`);
    }
  }

  return observationId;
}

/** Lista entidades da soul, com filtro opcional por nome (`q`, ILIKE) e/ou `kind` exato. */
export async function listEntities(pool: Pool, soul: string, q?: string, kind?: string, limit = 100): Promise<Entity[]> {
  const conditions = ["soul = $1"];
  const params: unknown[] = [soul];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (kind) {
    params.push(kind);
    conditions.push(`kind = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query<{ name: string; kind: string; properties: Record<string, unknown> | null }>(
    `SELECT name, kind, properties FROM entities WHERE ${conditions.join(" AND ")} ORDER BY name LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ name: r.name, kind: r.kind, properties: r.properties }));
}

/** Lista relações da soul, com filtro opcional de busca textual (`q`) em from/rel/to. */
export async function listRelations(pool: Pool, soul: string, q?: string, limit = 200): Promise<Relation[]> {
  const conditions = ["soul = $1"];
  const params: unknown[] = [soul];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(from_name ILIKE $${params.length} OR rel ILIKE $${params.length} OR to_name ILIKE $${params.length})`);
  }
  params.push(limit);
  const { rows } = await pool.query<{ from_name: string; rel: string; to_name: string; properties: Record<string, unknown> | null }>(
    `SELECT from_name, rel, to_name, properties FROM relations WHERE ${conditions.join(" AND ")} ORDER BY id LIMIT $${params.length}`,
    params,
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

export interface GraphWalkNode {
  name: string;
  kind: string;
  depth: number;
}

export interface GraphWalkEdge {
  from: string;
  rel: string;
  to: string;
  depth: number;
}

export interface GraphWalkResult {
  nodes: GraphWalkNode[];
  edges: GraphWalkEdge[];
  truncated: boolean;
}

/**
 * Percorre o grafo a partir de uma entidade (BFS não-direcionado, N saltos),
 * complementando o dump plano de `graph_list`. BFS iterativo em Node (não CTE
 * recursivo) porque o grafo por soul é pequeno — fica trivial de testar
 * maxHops/relTypes/maxNodes isoladamente sem depender do plano de query do
 * Postgres.
 */
export async function walkGraph(
  pool: Pool,
  soul: string,
  startName: string,
  opts: { maxHops?: number; relTypes?: string[]; maxNodes?: number } = {},
): Promise<GraphWalkResult> {
  const maxHops = Math.min(4, Math.max(1, Math.floor(opts.maxHops ?? 2)));
  const maxNodes = Math.max(1, Math.floor(opts.maxNodes ?? 200));
  const relTypes = opts.relTypes?.length ? opts.relTypes : null;

  const startRow = await pool.query<{ name: string; kind: string }>(
    `SELECT name, kind FROM entities WHERE soul = $1 AND name = $2 LIMIT 1`,
    [soul, startName],
  );
  const startKind = startRow.rows[0]?.kind ?? "unknown";

  const nodeDepth = new Map<string, number>([[startName, 0]]);
  const nodeKind = new Map<string, string>([[startName, startKind]]);
  const edgeKey = new Set<string>();
  const edges: GraphWalkEdge[] = [];
  let truncated = false;
  let frontier = [startName];

  for (let hop = 1; hop <= maxHops && frontier.length > 0 && nodeDepth.size < maxNodes; hop++) {
    const conditions = ["soul = $1", "(from_name = ANY($2::text[]) OR to_name = ANY($2::text[]))"];
    const params: unknown[] = [soul, frontier];
    if (relTypes) {
      params.push(relTypes);
      conditions.push(`rel = ANY($${params.length}::text[])`);
    }
    const { rows } = await pool.query<{ from_name: string; rel: string; to_name: string }>(
      `SELECT from_name, rel, to_name FROM relations WHERE ${conditions.join(" AND ")}`,
      params,
    );

    const nextFrontier: string[] = [];
    for (const r of rows) {
      const key = `${r.from_name} ${r.rel} ${r.to_name}`;
      if (!edgeKey.has(key)) {
        edgeKey.add(key);
        edges.push({ from: r.from_name, rel: r.rel, to: r.to_name, depth: hop });
      }
      for (const candidate of [r.from_name, r.to_name]) {
        if (!nodeDepth.has(candidate)) {
          if (nodeDepth.size >= maxNodes) {
            truncated = true;
            continue;
          }
          nodeDepth.set(candidate, hop);
          nextFrontier.push(candidate);
        }
      }
    }
    frontier = nextFrontier;
  }

  if (nodeDepth.size > 1) {
    const names = [...nodeDepth.keys()].filter((n) => n !== startName);
    const { rows: kindRows } = await pool.query<{ name: string; kind: string }>(
      `SELECT name, kind FROM entities WHERE soul = $1 AND name = ANY($2::text[])`,
      [soul, names],
    );
    for (const r of kindRows) nodeKind.set(r.name, r.kind);
  }

  const nodes: GraphWalkNode[] = [...nodeDepth.entries()].map(([name, depth]) => ({
    name,
    kind: nodeKind.get(name) ?? "unknown",
    depth,
  }));

  return { nodes, edges, truncated };
}
