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
import { sendJson, readJson, type RouteHandler, type RequestContext } from "./shared.js";
import { createWorktree, mergeLocally, destroyWorktree, getWorkspacesRoot } from "../tools/worktree-manager.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

async function handleWorktreeList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/worktree") return false;

  const root = getWorkspacesRoot();
  let worktrees: Array<{ taskId: string; path: string; branch?: string }> = [];

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        worktrees.push({ taskId: entry.name, path: join(root, entry.name) });
      }
    }
  } catch {
    // diretório não existe ainda
  }

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

  const { body, error } = await readJson(req);
  if (error || !body) {
    sendJson(res, 400, { error: "body JSON inválido" });
    return true;
  }

  const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : null;
  const baseBranch = typeof body.baseBranch === "string" && body.baseBranch.trim() ? body.baseBranch.trim() : "main";
  const soul = typeof body.soul === "string" && body.soul.trim() ? body.soul.trim() : null;

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

  const { body, error } = await readJson(req);
  const targetBranch = (typeof body?.targetBranch === "string" && body.targetBranch.trim())
    ? body.targetBranch.trim()
    : "main";

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