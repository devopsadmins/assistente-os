/**
 * Extração de entidades/relações via LLM local (Ollama), disparada em
 * background pela fila `entity_extraction_queue` (packages/daemon/src/entityExtraction.ts).
 *
 * Espelha o padrão já usado em packages/daemon/src/pipelines/meeting-ingest.ts
 * (extractMeetingWithOllama), com duas diferenças deliberadas:
 * - Timeout maior (60s, não 30s): ninguém espera a resposta HTTP aqui, e
 *   Ollama em CPU pode ser lento — vale mais esperar do que falhar cedo.
 * - Lança erro em falha de rede/JSON inválido em vez de degradar em silêncio:
 *   o job precisa aparecer como "failed" na fila (visibilidade operacional),
 *   não como "completed, 0 entidades" — que pareceria só "nada encontrado"
 *   quando na verdade o Ollama caiu.
 */
import { sanitizeUserPrompt, sanitizeLLMResponse } from "@assistente-os/core";
import { upsertEntity, upsertRelation } from "./graph.js";
import type { Pool } from "@assistente-os/core";

export const ENTITY_KINDS = [
  "person",
  "organization",
  "project",
  "product",
  "decision",
  "deadline",
  "location",
  "document",
  "other",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Abaixo deste tamanho não vale gastar uma chamada de LLM. */
export const MIN_BODY_LENGTH_FOR_EXTRACTION = 20;

/** Trunca corpo grande (ex.: conteúdo inteiro de um upload) antes de mandar pro LLM. */
const MAX_EXTRACTION_INPUT_CHARS = 8000;

const EXTRACTION_TIMEOUT_MS = 60_000;

export interface ExtractedEntity {
  name: string;
  kind: EntityKind;
}

export interface ExtractedRelation {
  from: string;
  rel: string;
  to: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "");
}

function clampKind(kind: unknown): EntityKind {
  const lower = String(kind ?? "").trim().toLowerCase();
  return (ENTITY_KINDS as readonly string[]).includes(lower) ? (lower as EntityKind) : "other";
}

/**
 * Valida e normaliza a saída do LLM: nomes normalizados, kind restrito à
 * taxonomia fixa, e qualquer endpoint de relação que não apareça em
 * `entities` ganha uma entidade própria com kind "other" (evita relação
 * órfã sem entidade correspondente na UI).
 */
function validateAndClamp(parsed: unknown): ExtractionResult {
  const raw = (parsed ?? {}) as { entities?: unknown; relations?: unknown };
  const rawEntities = Array.isArray(raw.entities) ? raw.entities : [];
  const rawRelations = Array.isArray(raw.relations) ? raw.relations : [];

  const entities = new Map<string, EntityKind>();
  for (const e of rawEntities) {
    const name = normalizeEntityName(String((e as { name?: unknown })?.name ?? ""));
    if (!name) continue;
    entities.set(name, clampKind((e as { kind?: unknown })?.kind));
  }

  const relations: ExtractedRelation[] = [];
  for (const r of rawRelations) {
    const from = normalizeEntityName(String((r as { from?: unknown })?.from ?? ""));
    const to = normalizeEntityName(String((r as { to?: unknown })?.to ?? ""));
    const rel = normalizeEntityName(String((r as { rel?: unknown })?.rel ?? ""));
    if (!from || !to || !rel) continue;
    if (!entities.has(from)) entities.set(from, "other");
    if (!entities.has(to)) entities.set(to, "other");
    relations.push({ from, rel, to });
  }

  return {
    entities: [...entities.entries()].map(([name, kind]) => ({ name, kind })),
    relations,
  };
}

/**
 * Chama o Ollama local pra extrair entidades/relações de um texto. Sanitiza
 * segredos antes de montar o prompt, trunca corpos grandes, e lança erro em
 * qualquer falha de rede/parsing (não degrada em silêncio — ver cabeçalho).
 */
export async function extractEntitiesWithOllama(
  text: string,
  ollamaUrl: string,
  chatModel: string,
): Promise<ExtractionResult> {
  const sanitized = sanitizeUserPrompt(text).sanitized;
  const truncated = sanitized.length > MAX_EXTRACTION_INPUT_CHARS ? sanitized.slice(0, MAX_EXTRACTION_INPUT_CHARS) : sanitized;

  const prompt = [
    "Extraia entidades e relações do texto abaixo.",
    `Tipos de entidade permitidos: ${ENTITY_KINDS.join(", ")}.`,
    "Responda apenas em JSON, exatamente neste formato:",
    '{"entities": [{"name": "string", "kind": "string"}], "relations": [{"from": "string", "rel": "string", "to": "string"}]}',
    "Se não houver entidades/relações claras, responda com arrays vazios.",
    "",
    "TEXTO:",
    truncated,
  ].join("\n");

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), EXTRACTION_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    throw new Error(`Ollama respondeu HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) {
    throw new Error("Ollama não retornou conteúdo");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Ollama retornou JSON inválido na extração de entidades");
  }

  return validateAndClamp(parsed);
}

/**
 * Processa um job da fila: extrai via LLM e persiste entidades/relações.
 * Não captura erros — quem decide completed/failed é o poller do daemon
 * (packages/daemon/src/entityExtraction.ts).
 */
export async function processExtractionJob(
  pool: Pool,
  job: { soul: string; body: string },
  opts: { ollamaUrl: string; chatModel: string },
): Promise<{ entitiesCreated: number; relationsCreated: number }> {
  const { entities, relations } = await extractEntitiesWithOllama(job.body, opts.ollamaUrl, opts.chatModel);

  for (const e of entities) {
    const safeName = sanitizeLLMResponse(e.name).sanitized;
    if (!safeName.trim()) continue;
    await upsertEntity(pool, job.soul, safeName, e.kind);
  }
  for (const r of relations) {
    const from = sanitizeLLMResponse(r.from).sanitized;
    const to = sanitizeLLMResponse(r.to).sanitized;
    const rel = sanitizeLLMResponse(r.rel).sanitized;
    if (!from.trim() || !to.trim() || !rel.trim()) continue;
    await upsertRelation(pool, job.soul, from, rel, to);
  }

  return { entitiesCreated: entities.length, relationsCreated: relations.length };
}
