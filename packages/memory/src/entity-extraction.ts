/**
 * Extração de entidades/relações via LLM local (Ollama), disparada em
 * background pela fila `entity_extraction_queue` (packages/daemon/src/entityExtraction.ts).
 *
 * Espelha o padrão já usado em packages/daemon/src/pipelines/meeting-ingest.ts
 * (extractMeetingWithOllama), com duas diferenças deliberadas:
 * - Timeout maior (180s por padrão, configurável via ENTITY_EXTRACTION_TIMEOUT_MS):
 *   ninguém espera a resposta HTTP aqui, e Ollama em CPU/LAN pode ser lento —
 *   vale mais esperar do que falhar cedo.
 * - Lança erro em falha de rede/JSON inválido em vez de degradar em silêncio:
 *   o job precisa aparecer como "failed" na fila (visibilidade operacional),
 *   não como "completed, 0 entidades" — que pareceria só "nada encontrado"
 *   quando na verdade o Ollama caiu.
 */
import { sanitizeUserPrompt, sanitizeLLMResponse, entityExtraction } from "@assistente-os/core";
import { upsertEntity, upsertRelation, resolveCanonicalEntityName, type EmbedderLike } from "./graph.js";
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

/** Trunca corpo grande (ex.: conteúdo inteiro de um upload) antes de mandar pro LLM.
 * Override via env pra medir o efeito de segmentos maiores/menores (menos/mais
 * chamadas de LLM) sem precisar rebuildar a cada experimento — ver docs/ROADMAP.md. */
export const MAX_EXTRACTION_INPUT_CHARS = Number(process.env.ENTITY_EXTRACTION_MAX_INPUT_CHARS) || 8000;

/**
 * Default subiu de 60s pra 180s (2026-09): 18 de 21 falhas históricas da fila
 * eram timeout contra o modelo local/LAN configurado, não erro de prompt/parsing.
 * Override via env pra ambientes com Ollama mais lento ou mais rápido.
 */
const EXTRACTION_TIMEOUT_MS = Number(process.env.ENTITY_EXTRACTION_TIMEOUT_MS) || 180_000;

export interface ExtractedEntity {
  name: string;
  kind: EntityKind;
}

export interface ExtractedRelation {
  from: string;
  rel: string;
  to: string;
}

/** Telemetria da chamada LLM (só presente quando o Ollama devolveu contagem). */
export interface LlmUsageLite {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  usage?: LlmUsageLite;
}

/**
 * Modelos pequenos (ex.: qwen2.5-coder:3b) costumam envolver o JSON pedido em
 * cerca de código markdown (```json ... ```) mesmo quando instruídos a
 * responder "apenas em JSON" — achado ao validar o backfill contra dados
 * reais (2026-09-06): o conteúdo extraído estava correto, só `JSON.parse`
 * rejeitava a cerca. Remove a cerca se presente; texto sem cerca passa
 * intacto.
 */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]! : trimmed;
}

export function normalizeEntityName(name: string): string {
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

  const prompt = entityExtraction.render({ entityKinds: ENTITY_KINDS.join(", "), text: truncated });

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), EXTRACTION_TIMEOUT_MS);
  const startedAt = Date.now();

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

  const data = (await resp.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const content = data.message?.content;
  if (!content) {
    throw new Error("Ollama não retornou conteúdo");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error("Ollama retornou JSON inválido na extração de entidades");
  }

  const result = validateAndClamp(parsed);
  if (typeof data.prompt_eval_count === "number" || typeof data.eval_count === "number") {
    result.usage = {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  }
  return result;
}

/**
 * Processa um job da fila: extrai via LLM e persiste entidades/relações.
 * Não captura erros — quem decide completed/failed é o poller do daemon
 * (packages/daemon/src/entityExtraction.ts).
 */
export async function processExtractionJob(
  pool: Pool,
  job: { soul: string; body: string },
  opts: {
    ollamaUrl: string;
    chatModel: string;
    embedder?: EmbedderLike;
    /** Cache de nome→canônico compartilhado entre chamadas (ex.: por soul,
     * dentro de uma run de `os memory backfill-entities`). Sem isso, cada
     * chamada cria um Map novo (comportamento do poller do daemon, que
     * processa 1 job por vez e não se beneficiaria de um cache maior). */
    canonicalNameCache?: Map<string, string>;
  },
): Promise<{ entitiesCreated: number; relationsCreated: number; usage?: LlmUsageLite }> {
  const { entities, relations, usage } = await extractEntitiesWithOllama(job.body, opts.ollamaUrl, opts.chatModel);

  // Resolve cada nome extraído pro seu canônico (exato → fold → embedding,
  // se `opts.embedder` + GRAPH_ENTITY_DEDUP estiverem ligados) antes de
  // upsertar — evita criar duplicata e evita relação órfã apontando pro
  // nome bruto quando o canônico é outro.
  const canonicalNames = opts.canonicalNameCache ?? new Map<string, string>();
  const resolve = async (rawName: string): Promise<string> => {
    const cached = canonicalNames.get(rawName);
    if (cached) return cached;
    const { canonical } = await resolveCanonicalEntityName(pool, job.soul, rawName, opts.embedder);
    canonicalNames.set(rawName, canonical);
    return canonical;
  };

  for (const e of entities) {
    const safeName = sanitizeLLMResponse(e.name).sanitized;
    if (!safeName.trim()) continue;
    const canonical = await resolve(safeName);
    await upsertEntity(pool, job.soul, canonical, e.kind, null, "entity_extraction");
  }
  for (const r of relations) {
    const from = sanitizeLLMResponse(r.from).sanitized;
    const to = sanitizeLLMResponse(r.to).sanitized;
    const rel = sanitizeLLMResponse(r.rel).sanitized;
    if (!from.trim() || !to.trim() || !rel.trim()) continue;
    const [canonicalFrom, canonicalTo] = await Promise.all([resolve(from), resolve(to)]);
    await upsertRelation(pool, job.soul, canonicalFrom, rel, canonicalTo, null, "entity_extraction");
  }

  return { entitiesCreated: entities.length, relationsCreated: relations.length, usage };
}
