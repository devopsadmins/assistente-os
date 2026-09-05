import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, getPool, getSoul, anotar, registrarLicao, decidir, logger } from "@assistente-os/core";
import { indexFile, indexStats, searchWithVerdict, graphStats, listEntities, listRelations, listObservations, addObservation, getEmbedder } from "@assistente-os/memory";
import { handleUpload, directoryTotalBytes, friendlyUploadKbLimit } from "../upload.js";
import { relevanceRule } from "../relevance.js";
import { sendJson, parseBody, requiredTrimmedString, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

/** Clampa um número pra [min,max]; outros tipos passam adiante (falham na validação Zod). */
const clampedNumber = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "number" ? Math.max(min, Math.min(max, v)) : v), z.number());

const MemorySearchSchema = z.object({
  query: requiredTrimmedString("query é obrigatório"),
  limit: clampedNumber(1, 20).optional().default(5),
  minScore: clampedNumber(0, 1).optional().default(0.3),
});

const AnotarLicaoSchema = z.object({ texto: requiredTrimmedString("texto é obrigatório") });

const DecidirSchema = z.object({
  titulo: requiredTrimmedString("titulo é obrigatório"),
  contexto: z.string().optional(),
  decisao: z.string().optional(),
  alternativas: z.string().optional(),
  consequencias: z.string().optional(),
});

const LimparSchema = z.object({
  maxAgeDays: z.number().optional(),
  maxBytes: z.number().optional(),
});

const AddObservationSchema = z.object({
  entity: z.string().min(1, "entity e body são obrigatórios"),
  body: z.string().min(1, "entity e body são obrigatórios"),
  source: z.string().optional(),
});

/**
 * Memória por soul: status/busca RAG, upload de fontes, escrita de memória
 * (anotar/licao/decidir), health, limpeza, e grafo de entidades/observações.
 */
export async function handleMemory(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, hub } = context;

  const memoryMatch = path.match(/^\/souls\/([^/]+)\/memory\/status$/);
  if (memoryMatch && req.method === "GET") {
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(memoryMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { soul: soul.id, chunks: await indexStats(pool, soul.id), graph: await graphStats(pool, soul.id) });
    return true;
  }

  const memorySearchMatch = path.match(/^\/souls\/([^/]+)\/memory\/search$/);
  if (memorySearchMatch && req.method === "POST") {
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(memorySearchMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const accountId = getRequestAccountId(req);
    if (accountId != null && soul.config.ownerAccountId !== accountId) {
      sendJson(res, 403, { error: "soul não pertence a esta conta" });
      return true;
    }
    const parsed = await parseBody(req, MemorySearchSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { query, limit, minScore: rawMinScore } = parsed.data;
    // Map slider [0,1] to threshold [0.1, 0.5] — more permissive: slider 0 = 0.1, slider 1 = 0.5
    // This allows low-relevance results like "dimastec" to appear while still filtering
    const minScore = rawMinScore * 0.4 + 0.1;
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const embedder = getEmbedder();
    const { results, verdict } = await searchWithVerdict(pool, soul.id, query, embedder, relevanceRule(), limit, minScore);
    // Se o gate de relevância recusou (ok=false), filtra resultados por score >= minScore
    const scoreThreshold = minScore || 0.3;
    const filteredResults = verdict.ok
      ? results
      : results.filter((r) => r.score && r.score >= scoreThreshold);
    const payload = {
      soul: soul.id,
      query,
      verdict,
      results: filteredResults.map((r) => ({ doc: r.docKey, path: r.path, score: r.score, method: r.method, snippet: r.body.slice(0, 300) })),
    };
    // modo "recusar" + gate fechado -> 409 para que clientes saibam que a busca foi recusada
    if (!verdict.ok && verdict.modo === "recusar") {
      sendJson(res, 409, payload);
      return true;
    }
    sendJson(res, 200, payload);
    return true;
  }

  // ----- Upload de arquivos/zips pra base da soul (sources/uploads/) -----
  const uploadMatch = path.match(/^\/souls\/([^/]+)\/upload$/);
  if (uploadMatch && req.method === "POST") {
    const soul = getSoul(home, decodeURIComponent(uploadMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
      sendJson(res, 400, { error: "esperado multipart/form-data (campo files)" });
      return true;
    }
    const uploadsDir = join(soul.dir, "sources", "uploads");

    // Teto de KB só pra sessão de conta (modo amigável) — pré-checagem via
    // Content-Length: rejeita cedo, antes de gastar disco/CPU processando um
    // upload que já sabemos que estoura o teto (aproximado — overhead do
    // multipart deixa a estimativa levemente pra cima, é intencionalmente
    // conservador).
    if (getRequestAccountId(req) != null) {
      const limitBytes = friendlyUploadKbLimit() * 1024;
      const usedBytes = directoryTotalBytes(uploadsDir);
      const incomingBytes = Number(req.headers["content-length"] ?? 0);
      if (usedBytes + incomingBytes > limitBytes) {
        sendJson(res, 400, {
          error: `limite de conhecimento (${friendlyUploadKbLimit()} KB) atingido ou excedido por este upload`,
          code: "E_ACCOUNT_LIMIT",
          usedKb: Math.round(usedBytes / 1024),
          limitKb: friendlyUploadKbLimit(),
        });
        return true;
      }
    }

    let result;
    try {
      result = await handleUpload(req, uploadsDir);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
    // Indexa em segundo plano só os arquivos recém-salvos (.md/.txt): reindexar
    // a soul inteira (indexDirectory) a cada upload re-embeda tudo via Ollama —
    // horas em CPU — e a resposta HTTP ficava presa até o fim (a UI travava em
    // "enviando…"). Reindex completo continua disponível pela CLI (comando index).
    const TEXT_EXT = /\.(md|markdown|txt)$/i;
    const newFiles: string[] = [];
    for (const s of result.saved) {
      if (s.extracted) {
        const destDir = join(uploadsDir, s.name.replace(/\.zip$/i, ""));
        for (const entry of s.extracted) if (TEXT_EXT.test(entry)) newFiles.push(join(destDir, entry));
      } else if (TEXT_EXT.test(s.name)) {
        newFiles.push(join(uploadsDir, s.name));
      }
    }
    try {
      hub.broadcast(
        { type: "upload.done", soul: soul.id, saved: result.saved.length, rejected: result.rejected.length },
        { accountId: soul.config.ownerAccountId ?? null },
      );
    } catch {
      /* ws opcional */
    }
    sendJson(res, result.rejected.length > 0 && result.saved.length === 0 ? 400 : 200, { ok: true, ...result, indexing: newFiles.length });
    if (newFiles.length > 0) {
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
      const embedder = getEmbedder();
      void (async () => {
        let indexed = 0;
        for (const file of newFiles) {
          try {
            indexed += (await indexFile(pool, soul.id, soul.dir, file, embedder)).chunks;
          } catch (err) {
            logger.warn({ err, file }, "falha ao indexar arquivo de upload");
          }
        }
        try {
          hub.broadcast(
            { type: "index.done", soul: soul.id, indexed, files: newFiles.length },
            { accountId: soul.config.ownerAccountId ?? null },
          );
        } catch {
          /* ws opcional */
        }
      })();
    }
    return true;
  }

  // ----- Escrita de memória da alma (openclaw-style) -----
  const almaBaseMatch = path.match(/^\/souls\/([^/]+)\/(anotar|licao|decidir)$/);
  if (almaBaseMatch && req.method === "POST") {
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(almaBaseMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const dir = soul.dir;
    try {
      const op = almaBaseMatch[2]!;
      if (op === "anotar") {
        const parsed = await parseBody(req, AnotarLicaoSchema);
        if (!parsed.ok) {
          sendJson(res, parsed.status, { error: parsed.error });
          return true;
        }
        const file = anotar(dir, parsed.data.texto);
        sendJson(res, 200, { ok: true, arquivo: file, texto: parsed.data.texto });
        return true;
      }
      if (op === "licao") {
        const parsed = await parseBody(req, AnotarLicaoSchema);
        if (!parsed.ok) {
          sendJson(res, parsed.status, { error: parsed.error });
          return true;
        }
        const file = registrarLicao(dir, parsed.data.texto);
        sendJson(res, 200, { ok: true, arquivo: file, texto: parsed.data.texto });
        return true;
      }
      // decidir
      const parsed = await parseBody(req, DecidirSchema);
      if (!parsed.ok) {
        sendJson(res, parsed.status, { error: parsed.error });
        return true;
      }
      const { titulo, contexto, decisao, alternativas, consequencias } = parsed.data;
      const file = decidir(dir, { titulo, contexto, decisao, alternativas, consequencias });
      sendJson(res, 200, { ok: true, arquivo: file, titulo });
      return true;
    } catch (err) {
      sendJson(res, 409, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  const healthMatch = path.match(/^\/souls\/([^/]+)\/health$/);
  if (healthMatch && req.method === "GET") {
    const { getSoul: getSoulDyn, soulHealth } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(healthMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    sendJson(res, 200, soulHealth(soul.dir));
    return true;
  }

  const limparMatch = path.match(/^\/souls\/([^/]+)\/limpar$/);
  if (limparMatch && req.method === "POST") {
    const { getSoul: getSoulDyn, limparSoul } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(limparMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const parsed = await parseBody(req, LimparSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const { maxAgeDays, maxBytes } = parsed.data;
    const result = limparSoul(soul.dir, { maxAgeDays, maxBytes });
    sendJson(res, 200, { soul: soul.id, ...result });
    return true;
  }

  const graphMatch = path.match(/^\/souls\/([^/]+)\/graph$/);
  if (graphMatch && req.method === "GET") {
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(graphMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const entityFilter = url.searchParams.get("entity")?.trim() || undefined;
    const qFilter = url.searchParams.get("q")?.trim() || undefined;
    const entitiesQ = url.searchParams.get("entities_q")?.trim() || undefined;
    const entitiesKind = url.searchParams.get("entities_kind")?.trim() || undefined;
    const relationsQ = url.searchParams.get("relations_q")?.trim() || undefined;
    sendJson(res, 200, {
      soul: soul.id,
      entities: await listEntities(pool, soul.id, entitiesQ, entitiesKind),
      relations: await listRelations(pool, soul.id, relationsQ),
      observations: await listObservations(pool, soul.id, entityFilter, qFilter),
    });
    return true;
  }

  // ----- POST /souls/:soul/graph/observation — adiciona observação ao grafo -----
  const obsMatch = path.match(/^\/souls\/([^/]+)\/graph\/observation$/);
  if (obsMatch && req.method === "POST") {
    const { getSoul: getSoulDyn } = await import("@assistente-os/core");
    const soul = getSoulDyn(home, decodeURIComponent(obsMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    try {
      const parsed = await parseBody(req, AddObservationSchema);
      if (!parsed.ok) {
        sendJson(res, parsed.status, { error: parsed.error });
        return true;
      }
      const { entity, body, source } = parsed.data;
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
      await addObservation(pool, soul.id, entity, body, source);
      sendJson(res, 200, { ok: true, soul: soul.id, entity });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  return false;
}
