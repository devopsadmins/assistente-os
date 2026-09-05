/**
 * Rotas REST para gerenciamento de worktrees (isolamento de tarefas agênticas).
 *
 * Endpoints:
 *   POST   /api/worktree           -> cria worktree { taskId, baseBranch?, soul? }
 *   POST   /api/worktree/:taskId/merge  -> merge local com validação de testes
 *   DELETE /api/worktree/:taskId   -> destrói worktree
 *   GET    /api/worktree           -> lista worktrees ativas
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { sendJson, parseBody, optionalTrimmedString, type RouteHandler, type RequestContext } from "./shared.js";
import { createWorktree, mergeLocally, destroyWorktree, listWorktrees } from "../tools/worktree-manager.js";

const CreateWorktreeSchema = z.object({
  taskId: optionalTrimmedString(),
  baseBranch: optionalTrimmedString(),
  soul: optionalTrimmedString(),
});

const MergeWorktreeSchema = z.object({
  targetBranch: optionalTrimmedString(),
});

async function handleWorktreeList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/worktree") return false;

  // Fonte de verdade: git worktree list (branch/HEAD reais), não só o nome do dir.
  const worktrees = await listWorktrees();
  sendJson(res, 200, { worktrees });
  return true;
}

async function handleWorktreeCreate(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/worktree") return false;

  const parsed = await parseBody(req, CreateWorktreeSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const { taskId, soul } = parsed.data;
  const baseBranch = parsed.data.baseBranch ?? "main";

  if (!taskId) {
    sendJson(res, 400, { error: "taskId é obrigatório" });
    return true;
  }

  try {
    const result = await createWorktree(taskId, baseBranch);
    if (result.success) {
      if (soul) {
        await setupEnvironment(taskId);
      }
      sendJson(res, 201, result);
    } else {
      sendJson(res, 500, { error: result.error });
    }
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

async function handleWorktreeMerge(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "POST") return false;

  const match = url.pathname.match(/^\/api\/worktree\/([^/]+)\/merge$/);
  if (!match) return false;
  const taskId = match[1]!;

  const parsed = await parseBody(req, MergeWorktreeSchema);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { error: parsed.error });
    return true;
  }
  const targetBranch = parsed.data.targetBranch ?? "main";

  try {
    const result = await mergeLocally(taskId, targetBranch);
    if (result.success) {
      sendJson(res, 200, result);
    } else {
      sendJson(res, 400, { error: result.error, testsPassed: result.testsPassed });
    }
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

async function handleWorktreeDestroy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "DELETE") return false;

  const match = url.pathname.match(/^\/api\/worktree\/([^/]+)$/);
  if (!match) return false;
  const taskId = match[1]!;

  try {
    await destroyWorktree(taskId);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

export const handleWorktree: RouteHandler = async (req, res, url, path, context) => {
  if (await handleWorktreeList(req, res, url, context)) return true;
  if (await handleWorktreeCreate(req, res, url, context)) return true;
  if (await handleWorktreeMerge(req, res, url, context)) return true;
  if (await handleWorktreeDestroy(req, res, url, context)) return true;
  return false;
};

async function setupEnvironment(taskId: string): Promise<void> {
  // Re-usa a lógica do worktree-manager (será exportada)
  const { setupEnvironment: setupEnv } = await import("../tools/worktree-manager.js");
  await setupEnv(taskId);
}