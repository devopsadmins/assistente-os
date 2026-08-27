/**
 * Worktree Manager — Isolamento de tarefas agênticas paralelas via git worktrees.
 *
 * Cada tarefa roda em worktree isolada em ~/.assistant-os/workspaces/<taskId>
 * na branch task/<taskId>. Suporta setup de ambiente, validação de testes
 * e merge local com rollback automático.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { resolveHome } from "@assistente-os/core";

export interface WorktreeResult {
  success: boolean;
  path: string;
  branch: string;
  error?: string;
}

export interface MergeResult {
  success: boolean;
  testsPassed: boolean;
  merged: boolean;
  error?: string;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const WORKSPACES_DIR = "workspaces";
const DEFAULT_BASE_BRANCH = "main";
const TEST_TIMEOUT_MS = 300_000; // 5 min
const GIT_TIMEOUT_MS = 60_000; // 1 min

export function getWorkspacesRoot(): string {
  return join(resolveHome(), WORKSPACES_DIR);
}

export function getWorktreePath(taskId: string): string {
  return join(getWorkspacesRoot(), taskId);
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr, timedOut: false }));
    child.on("error", (err) => {
      if (err.message.includes("timeout") || err.message.includes("ETIMEDOUT")) {
        resolve({ code: 124, stdout, stderr, timedOut: true });
      } else {
        resolve({ code: 1, stdout, stderr: err.message, timedOut: false });
      }
    });
  });
}

async function runGit(args: string[], cwd: string): Promise<ExecResult> {
  return runCommand("git", args, cwd, GIT_TIMEOUT_MS);
}

async function runNpmTest(cwd: string): Promise<ExecResult> {
  return runCommand("npm", ["test"], cwd, TEST_TIMEOUT_MS);
}

async function ensureWorkspacesDir(): Promise<void> {
  const root = getWorkspacesRoot();
  await fs.mkdir(root, { recursive: true });
}

/**
 * Cria worktree isolada para uma tarefa.
 * @param taskId Identificador único da tarefa
 * @param baseBranch Branch base (default: main)
 */
export async function createWorktree(taskId: string, baseBranch = DEFAULT_BASE_BRANCH): Promise<WorktreeResult> {
  await ensureWorkspacesDir();

  const worktreePath = getWorktreePath(taskId);
  const branch = `task/${taskId}`;

  // Remove worktree anterior se existir (idempotente)
  try {
    await fs.access(worktreePath);
    await runGit(["worktree", "remove", "--force", worktreePath], process.cwd());
    await runGit(["branch", "-D", branch], process.cwd());
  } catch {
    // não existe, segue
  }

  const result = await runGit(
    ["worktree", "add", worktreePath, "-b", branch, baseBranch],
    process.cwd(),
  );

  if (result.code !== 0) {
    return {
      success: false,
      path: worktreePath,
      branch,
      error: `git worktree add falhou: ${result.stderr || result.stdout}`,
    };
  }

  return { success: true, path: worktreePath, branch };
}

/**
 * Configura ambiente na worktree (copia .env, cria symlinks de cache/db).
 * Best-effort: falhas não bloqueiam, apenas logam warning.
 */
export async function setupEnvironment(taskId: string): Promise<void> {
  const worktreePath = getWorktreePath(taskId);
  const home = resolveHome();

  // Copia .env se existir
  try {
    const envSrc = join(home, ".env");
    const envDst = join(worktreePath, ".env");
    await fs.copyFile(envSrc, envDst);
  } catch {
    // .env não existe na raiz — ignora
  }

  // Symlinks para cache e kernel.db (opcional, best-effort)
  const links = [
    { src: join(home, ".assistant-os", "cache"), dst: join(worktreePath, ".cache") },
    { src: join(home, ".assistant-os", "kernel.db"), dst: join(worktreePath, "kernel.db") },
  ];

  for (const { src, dst } of links) {
    try {
      await fs.access(src);
      await fs.symlink(src, dst, "dir");
    } catch {
      // fonte não existe ou link já existe — ignora
    }
  }
}

/**
 * Executa validação (npm test) e faz merge local na branch alvo.
 * Rollback automático se testes falharem.
 */
export async function mergeLocally(taskId: string, targetBranch = DEFAULT_BASE_BRANCH): Promise<MergeResult> {
  const worktreePath = getWorktreePath(taskId);
  const branch = `task/${taskId}`;

  // 1. Roda testes na worktree
  const testResult = await runNpmTest(worktreePath);
  const testsPassed = testResult.code === 0 && !testResult.timedOut;

  if (!testsPassed) {
    return {
      success: false,
      testsPassed: false,
      merged: false,
      error: `Testes falharam (código ${testResult.code}${testResult.timedOut ? ", timeout" : ""}): ${testResult.stderr.slice(-500) || testResult.stdout.slice(-500)}`,
    };
  }

  // 2. Rebase na targetBranch
  const rebaseResult = await runGit(["rebase", targetBranch], worktreePath);
  if (rebaseResult.code !== 0) {
    // Tenta abortar rebase
    await runGit(["rebase", "--abort"], worktreePath);
    return {
      success: false,
      testsPassed: true,
      merged: false,
      error: `Rebase falhou: ${rebaseResult.stderr || rebaseResult.stdout}`,
    };
  }

  // 3. Checkout targetBranch e merge
  const checkoutResult = await runGit(["checkout", targetBranch], process.cwd());
  if (checkoutResult.code !== 0) {
    return {
      success: false,
      testsPassed: true,
      merged: false,
      error: `Checkout ${targetBranch} falhou: ${checkoutResult.stderr || checkoutResult.stdout}`,
    };
  }

  const mergeResult = await runGit(["merge", branch], process.cwd());
  if (mergeResult.code !== 0) {
    await runGit(["merge", "--abort"], process.cwd());
    return {
      success: false,
      testsPassed: true,
      merged: false,
      error: `Merge falhou: ${mergeResult.stderr || mergeResult.stdout}`,
    };
  }

  return { success: true, testsPassed: true, merged: true };
}

/**
 * Destroi worktree e limpa referências git.
 * Força remoção mesmo se branch não foi merged.
 */
export async function destroyWorktree(taskId: string): Promise<void> {
  const worktreePath = getWorktreePath(taskId);
  const branch = `task/${taskId}`;

  // Remove worktree (força se necessário)
  await runGit(["worktree", "remove", "--force", worktreePath], process.cwd()).catch(() => {});

  // Deleta branch local
  await runGit(["branch", "-D", branch], process.cwd()).catch(() => {});

  // Prune para limpar refs órfãs
  await runGit(["worktree", "prune"], process.cwd()).catch(() => {});

  // Remove diretório se ainda existir (fallback)
  try {
    await fs.rm(worktreePath, { recursive: true, force: true });
  } catch {
    // ignora
  }
}