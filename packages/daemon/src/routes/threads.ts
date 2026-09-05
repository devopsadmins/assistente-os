import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getPool, loadConfig, getSoul, createThread, listThreads, getThread, renameThread, deleteThread, getThreadMessages } from "@assistente-os/core";
import { sendJson, parseBody, type RequestContext } from "./shared.js";
import { getRequestAccountId } from "./accountAuth.js";

const CreateThreadSchema = z.object({ title: z.string().optional() });
const PatchThreadSchema = z.object({ title: z.string() });

/**
 * CRUD de threads (conversas nomeadas) por soul:
 *   GET/POST /souls/:id/threads
 *   PATCH/DELETE /souls/:id/threads/:threadId
 *   GET /souls/:id/threads/:threadId/messages
 *
 * Posse de SOUL já é garantida pelo guard central em server.ts antes de
 * qualquer rota rodar — aqui só confirmamos que a soul existe (mesmo padrão
 * de memory.ts/chat.ts) e delegamos posse de THREAD pro próprio módulo
 * threads.ts (accountId undefined = token admin, sem filtro).
 */
export async function handleThreads(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  const listOrCreateMatch = path.match(/^\/souls\/([^/]+)\/threads$/);
  if (listOrCreateMatch && (req.method === "GET" || req.method === "POST")) {
    const soul = getSoul(home, decodeURIComponent(listOrCreateMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    if (req.method === "GET") {
      const threads = await listThreads(pool, soul.id, requestAccountId);
      sendJson(res, 200, threads);
      return true;
    }

    // POST — criação sempre precisa de um account_id concreto pra gravar,
    // nunca "undefined": token admin cria como thread de operador (null).
    const parsed = await parseBody(req, CreateThreadSchema);
    if (!parsed.ok) {
      sendJson(res, parsed.status, { error: parsed.error });
      return true;
    }
    const thread = await createThread(pool, soul.id, requestAccountId ?? null, parsed.data.title);
    sendJson(res, 201, thread);
    return true;
  }

  const threadMatch = path.match(/^\/souls\/([^/]+)\/threads\/(\d+)$/);
  if (threadMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const soul = getSoul(home, decodeURIComponent(threadMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const threadId = Number(threadMatch[2]);
    if (!Number.isSafeInteger(threadId) || threadId < 1) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    if (req.method === "PATCH") {
      const parsed = await parseBody(req, PatchThreadSchema);
      if (!parsed.ok) {
        sendJson(res, parsed.status, { error: parsed.error });
        return true;
      }
      const renamed = await renameThread(pool, threadId, requestAccountId, parsed.data.title, soul.id);
      if (!renamed) {
        sendJson(res, 404, { error: "thread não encontrada" });
        return true;
      }
      sendJson(res, 200, renamed);
      return true;
    }

    // DELETE
    const deleted = await deleteThread(pool, threadId, requestAccountId, soul.id);
    if (!deleted) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  const messagesMatch = path.match(/^\/souls\/([^/]+)\/threads\/(\d+)\/messages$/);
  if (messagesMatch && req.method === "GET") {
    const soul = getSoul(home, decodeURIComponent(messagesMatch[1]!));
    if (!soul) {
      sendJson(res, 404, { error: "soul não encontrada" });
      return true;
    }
    const threadId = Number(messagesMatch[2]);
    if (!Number.isSafeInteger(threadId) || threadId < 1) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const requestAccountId = getRequestAccountId(req);

    const thread = await getThread(pool, threadId, requestAccountId, soul.id);
    if (!thread) {
      sendJson(res, 404, { error: "thread não encontrada" });
      return true;
    }
    const messages = await getThreadMessages(pool, threadId);
    sendJson(res, 200, messages);
    return true;
  }

  return false;
}
