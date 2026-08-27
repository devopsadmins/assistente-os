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
import { authorizeExecution, type AuthorizeExecutionInput, type AgentConfig } from "@assistente-os/core";
import { sanitizeCommandOutput } from "./terminal-sanitizer.js";

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

type CommandExecutor = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<ExecResult>;

const WORKSPACES_DIR = "workspaces";
const DEFAULT_BASE_BRANCH = "main";
const TEST_TIMEOUT_MS = 300_000; // 5 min
const GIT_TIMEOUT_MS = 60_000; // 1 min
const BUILD_TIMEOUT_MS = 300_000; // 5 min

export function getWorkspacesRoot(): string {
  return join(resolveHome(), WORKSPACES_DIR);
}

export function getWorktreePath(taskId: string): string {
  return join(getWorkspacesRoot(), taskId);
}

function defaultExecutor(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecResult> {
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

export class WorktreeManager {
  private soulId: string;
  private agentConfig?: AgentConfig;
  private executor: CommandExecutor;

  constructor(soulId: string, agentConfig?: AgentConfig, executor?: CommandExecutor) {
    this.soulId = soulId;
    this.agentConfig = agentConfig;
    this.executor = executor ?? defaultExecutor;
  }

  private async checkL3Authorization(capability: string): Promise<void> {
    const authInput: AuthorizeExecutionInput = {
      soulId: this.soulId,
      capability,
      agentConfig: this.agentConfig,
      effect: "external",
    };
    const decision = authorizeExecution(authInput);
    if (!decision.allow) {
      throw new Error(`L3 authorization denied: ${decision.reason}`);
    }
  }

  private async runGit(args: string[], cwd: string): Promise<ExecResult> {
    return this.executor("git", args, cwd, GIT_TIMEOUT_MS);
  }

  private async runNpmTest(cwd: string): Promise<ExecResult> {
    return this.executor("npm", ["test"], cwd, TEST_TIMEOUT_MS);
  }

  private async runNpmBuild(cwd: string): Promise<ExecResult> {
    return this.executor("npm", ["run", "build", "--workspaces"], cwd, BUILD_TIMEOUT_MS);
  }

  private async ensureWorkspacesDir(): Promise<void> {
    const root = getWorkspacesRoot();
    await fs.mkdir(root, { recursive: true });
  }

  /**
   * Cria worktree isolada para uma tarefa.
   * @param taskId Identificador único da tarefa
   * @param baseBranch Branch base (default: main)
   */
  async createWorktree(taskId: string, baseBranch = DEFAULT_BASE_BRANCH): Promise<WorktreeResult> {
    await this.ensureWorkspacesDir();

    const worktreePath = getWorktreePath(taskId);
    const branch = `task/${taskId}`;

    // Remove worktree anterior se existir (idempotente)
    try {
      await fs.access(worktreePath);
      await this.runGit(["worktree", "remove", "--force", worktreePath], process.cwd());
      await this.runGit(["branch", "-D", branch], process.cwd());
    } catch {
      // não existe, segue
    }

    const result = await this.runGit(
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
  async setupEnvironment(taskId: string): Promise<void> {
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
   * Executa validação (npm run build --workspaces + npm test) e faz merge local na branch alvo.
   * Rollback automático se testes falharem.
   * Exige autorização L3 (worktree_merge_locally).
   */
  async mergeLocally(taskId: string, targetBranch = DEFAULT_BASE_BRANCH): Promise<MergeResult> {
    // L3 Gate: worktree_merge_locally
    await this.checkL3Authorization("worktree_merge_locally");

    const worktreePath = getWorktreePath(taskId);
    const branch = `task/${taskId}`;

    // 1. Roda build na worktree (Regra 1: compilação limpa)
    const buildResult = await this.runNpmBuild(worktreePath);
    if (buildResult.code !== 0 || buildResult.timedOut) {
      // Terminal Sanitizer: mantém só as linhas relevantes (erros/resumo) da saída
      // de build, poupando tokens quando esta mensagem entra em audit trail / prompt.
      const s = sanitizeCommandOutput("npm run build --workspaces", buildResult.stdout, buildResult.stderr);
      return {
        success: false,
        testsPassed: false,
        merged: false,
        error: `Build falhou (código ${buildResult.code}${buildResult.timedOut ? ", timeout" : ""}): ${s.sanitized.slice(-1000)}`,
      };
    }

    // 2. Roda testes na worktree
    const testResult = await this.runNpmTest(worktreePath);
    const testsPassed = testResult.code === 0 && !testResult.timedOut;

    if (!testsPassed) {
      const s = sanitizeCommandOutput("npm test", testResult.stdout, testResult.stderr);
      return {
        success: false,
        testsPassed: false,
        merged: false,
        error: `Testes falharam (código ${testResult.code}${testResult.timedOut ? ", timeout" : ""}): ${s.sanitized.slice(-1000)}`,
      };
    }

    // 3. Rebase na targetBranch
    const rebaseResult = await this.runGit(["rebase", targetBranch], worktreePath);
    if (rebaseResult.code !== 0) {
      // Tenta abortar rebase
      await this.runGit(["rebase", "--abort"], worktreePath);
      return {
        success: false,
        testsPassed: true,
        merged: false,
        error: `Rebase falhou: ${rebaseResult.stderr || rebaseResult.stdout}`,
      };
    }

    // 4. Checkout targetBranch e merge
    const checkoutResult = await this.runGit(["checkout", targetBranch], process.cwd());
    if (checkoutResult.code !== 0) {
      return {
        success: false,
        testsPassed: true,
        merged: false,
        error: `Checkout ${targetBranch} falhou: ${checkoutResult.stderr || checkoutResult.stdout}`,
      };
    }

    const mergeResult = await this.runGit(["merge", branch], process.cwd());
    if (mergeResult.code !== 0) {
      await this.runGit(["merge", "--abort"], process.cwd());
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
   * Exige autorização L3 (git_commit_push - efeito externo irreversível).
   * Garantia WORKTREE_CLEANUP_INTEGRITY: try/catch/finally com prune forçado.
   */
  async destroyWorktree(taskId: string): Promise<void> {
    // L3 Gate: git_commit_push (efeito externo irreversível)
    await this.checkL3Authorization("git_commit_push");

    const worktreePath = getWorktreePath(taskId);
    const branch = `task/${taskId}`;

    let pruneExecuted = false;

    try {
      // Remove worktree (força se necessário)
      await this.runGit(["worktree", "remove", "--force", worktreePath], process.cwd());
    } catch {
      // ignora erro, continua cleanup
    } finally {
      try {
        // Deleta branch local
        await this.runGit(["branch", "-D", branch], process.cwd());
      } catch {
        // ignora
      } finally {
        try {
          // Prune para limpar refs órfãs - SEMPRE executa
          await this.runGit(["worktree", "prune"], process.cwd());
          pruneExecuted = true;
        } catch {
          // ignora
        } finally {
          // Remove diretório se ainda existir (fallback final)
          try {
            await fs.rm(worktreePath, { recursive: true, force: true });
          } catch {
            // ignora
          }
        }
      }
    }

    if (!pruneExecuted) {
      // Last resort: force prune even if everything else failed
      await this.runGit(["worktree", "prune"], process.cwd()).catch(() => {});
    }
  }
}

/**
 * Cria worktree isolada para uma tarefa (função standalone para compatibilidade).
 * @param taskId Identificador único da tarefa
 * @param baseBranch Branch base (default: main)
 */
export async function createWorktree(taskId: string, baseBranch = DEFAULT_BASE_BRANCH): Promise<WorktreeResult> {
  const manager = new WorktreeManager("system");
  return manager.createWorktree(taskId, baseBranch);
}

/**
 * Configura ambiente na worktree (função standalone para compatibilidade).
 * Best-effort: falhas não bloqueiam, apenas logam warning.
 */
export async function setupEnvironment(taskId: string): Promise<void> {
  const manager = new WorktreeManager("system");
  return manager.setupEnvironment(taskId);
}

/**
 * Executa validação (npm run build --workspaces + npm test) e faz merge local na branch alvo (função standalone).
 * Rollback automático se testes falharem.
 */
export async function mergeLocally(taskId: string, targetBranch = DEFAULT_BASE_BRANCH): Promise<MergeResult> {
  const manager = new WorktreeManager("system");
  return manager.mergeLocally(taskId, targetBranch);
}

/**
 * Destroi worktree e limpa referências git (função standalone para compatibilidade).
 * Força remoção mesmo se branch não foi merged.
 */
export async function destroyWorktree(taskId: string): Promise<void> {
  const manager = new WorktreeManager("system");
  return manager.destroyWorktree(taskId);
}

export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string | null;
  head: string | null;
}

/**
 * Lista as worktrees de tarefa (as que vivem sob getWorkspacesRoot()).
 * Fonte de verdade é `git worktree list --porcelain` — pega branch/HEAD reais,
 * não só o nome do diretório. Diretórios órfãos (sem worktree git) são ignorados.
 */
export async function listWorktrees(executor: CommandExecutor = defaultExecutor): Promise<WorktreeInfo[]> {
  const root = resolve(getWorkspacesRoot());
  const res = await executor("git", ["worktree", "list", "--porcelain"], process.cwd(), GIT_TIMEOUT_MS);
  if (res.code !== 0) return [];

  const out: WorktreeInfo[] = [];
  let cur: Partial<WorktreeInfo> = {};
  const flush = () => {
    if (cur.path) {
      const abs = resolve(cur.path);
      if (abs.startsWith(root + "/")) {
        out.push({
          taskId: abs.slice(root.length + 1),
          path: cur.path,
          branch: cur.branch ?? null,
          head: cur.head ?? null,
        });
      }
    }
    cur = {};
  };
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      cur.path = line.slice("worktree ".length).trim();
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  flush();
  return out;
}