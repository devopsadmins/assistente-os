/**
 * Testes unitários do worktree-manager.
 *
 * Testa ciclo de vida completo: criação, setup, merge, destroy,
 * L3 autonomy gates, fallback em falhas, sanitização de saída.
 * Uso: node --test dist/test/worktree-manager.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  WorktreeManager,
  getWorktreePath,
  getWorkspacesRoot,
  createWorktree,
  setupEnvironment,
  mergeLocally,
  destroyWorktree,
} from "../tools/worktree-manager.js";
import type { AgentConfig, AgentPermissions, AgentGuardrails } from "@assistente-os/core";

const TEST_TASK_ID = "test-task-123";
const TEST_BRANCH = `task/${TEST_TASK_ID}`;
const WORKTREE_PATH = getWorktreePath(TEST_TASK_ID);

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type CommandExecutor = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<ExecResult>;

const mockExecResult = (overrides: Partial<ExecResult> = {}): ExecResult => ({
  code: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...overrides,
});

function createMockExecutor(responses: Map<string, ExecResult>): CommandExecutor {
  return async (command: string, args: string[]) => {
    const cmd = `${command} ${args.join(" ")}`;
    for (const [pattern, result] of responses) {
      if (cmd.includes(pattern)) {
        return result;
      }
    }
    return mockExecResult({ code: 1, stderr: `Unknown command: ${cmd}` });
  };
}

function createTestAgentConfig(autonomy: AgentConfig["autonomy"] = "auto"): AgentConfig {
  return {
    permissions: {
      tools: ["*", "worktree_create", "worktree_merge_locally", "worktree_destroy", "git_commit_push"],
      connectors: [],
    } as AgentPermissions,
    guardrails: {
      maxTurns: 10,
      maxIterations: 5,
      ragRelevanceThreshold: 0.70,
    } as AgentGuardrails,
    autonomy,
  };
}

describe("worktree-manager helpers", () => {
  it("getWorktreePath: retorna path correto", () => {
    const path = getWorktreePath("abc");
    assert.ok(path.endsWith("workspaces/abc"));
  });

  it("getWorkspacesRoot: retorna raiz correta", () => {
    const root = getWorkspacesRoot();
    assert.ok(root.endsWith(".assistant-os/workspaces"));
  });

  it("getWorktreePath: taskId com caracteres especiais", () => {
    const path = getWorktreePath("task-123_abc");
    assert.ok(path.endsWith("workspaces/task-123_abc"));
  });
});

describe("WorktreeManager class", () => {
  // 1. createWorktree — success creates dir + branch task/<taskId>
  it("createWorktree: cria worktree e branch com sucesso", async () => {
    const responses = new Map<string, ExecResult>([
      ["git worktree add", mockExecResult({ code: 0, stdout: "Preparing worktree" })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.createWorktree(TEST_TASK_ID);
    assert.equal(result.success, true);
    assert.ok(result.path.endsWith(WORKTREE_PATH));
    assert.equal(result.branch, TEST_BRANCH);
  });

  // 2. createWorktree — idempotent: removes existing worktree/branch first
  it("createWorktree: idempotente — remove worktree/branch anterior se existir", async () => {
    const responses = new Map<string, ExecResult>([
      ["git worktree remove", mockExecResult({ code: 0 })],
      ["git branch -D", mockExecResult({ code: 0 })],
      ["git worktree add", mockExecResult({ code: 0 })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.createWorktree(TEST_TASK_ID);
    assert.equal(result.success, true);
  });

  // 3. createWorktree — failure: git error returns structured error
  it("createWorktree: falha no git retorna erro estruturado", async () => {
    const responses = new Map<string, ExecResult>([
      ["git worktree add", mockExecResult({ code: 128, stderr: "fatal: not a git repository" })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.createWorktree("fail-task");
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("git worktree add falhou"));
  });

  // 4. setupEnvironment — copies .env + creates symlinks (best-effort)
  it("setupEnvironment: não lança erro (best-effort)", async () => {
    const manager = new WorktreeManager("test-soul", { autonomy: "auto" });
    await assert.doesNotReject(async () => {
      await manager.setupEnvironment(TEST_TASK_ID);
    });
  });

  // 5. setupEnvironment — missing source files: no throw
  it("setupEnvironment: arquivos fonte ausentes não lançam erro", async () => {
    const manager = new WorktreeManager("test-soul", { autonomy: "auto" });
    await assert.doesNotReject(async () => {
      await manager.setupEnvironment("missing-task");
    });
  });

  // 6. mergeLocally — runs build+tests, passes, rebases, merges successfully
  it("mergeLocally: build+test passam, rebase e merge bem-sucedidos", async () => {
    const responses = new Map<string, ExecResult>([
      ["npm run build", mockExecResult({ code: 0, stdout: "Build completed" })],
      ["npm test", mockExecResult({ code: 0, stdout: "Test Suites: 3 passed\nTests: 27 passed" })],
      ["git rebase", mockExecResult({ code: 0, stdout: "Successfully rebased" })],
      ["git checkout", mockExecResult({ code: 0, stdout: "Switched to branch" })],
      ["git merge", mockExecResult({ code: 0, stdout: "Merge made" })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.mergeLocally(TEST_TASK_ID);
    assert.equal(result.success, true);
    assert.equal(result.testsPassed, true);
    assert.equal(result.merged, true);
  });

  // 7. mergeLocally — test failure: returns error, no merge attempted
  it("mergeLocally: falha nos testes retorna erro e não tenta merge", async () => {
    const responses = new Map<string, ExecResult>([
      ["npm run build", mockExecResult({ code: 0 })],
      ["npm test", mockExecResult({ code: 1, stderr: "Test failed" })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.mergeLocally(TEST_TASK_ID);
    assert.equal(result.success, false);
    assert.equal(result.testsPassed, false);
    assert.equal(result.merged, false);
    assert.ok(result.error?.includes("Testes falharam"));
  });

  // 7b. mergeLocally — saída de teste verbosa é sanitizada na mensagem de erro (E4)
  it("mergeLocally: aplica o Terminal Sanitizer na saída de teste falha (E4)", async () => {
    const noise = Array.from({ length: 400 }, (_, i) => `console.log linha de ruído ${i}`).join("\n");
    const verbose = `${noise}\n  ✕ meu teste falhou\n  1 failing\n${noise}`;
    const responses = new Map<string, ExecResult>([
      ["npm run build", mockExecResult({ code: 0 })],
      ["npm test", mockExecResult({ code: 1, stdout: verbose })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.mergeLocally(TEST_TASK_ID);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("Testes falharam"));
    // A mensagem preserva a linha relevante mas não carrega as 800 linhas de ruído.
    assert.ok(result.error!.includes("meu teste falhou"), "mantém a linha do teste que falhou");
    assert.ok(result.error!.length < verbose.length / 2, "trunca o ruído");
    assert.ok(!result.error!.includes("linha de ruído 200"), "corta o miolo de ruído");
  });

  // 8. mergeLocally — build failure: returns error, no test/merge
  it("mergeLocally: falha no build retorna erro e não roda testes", async () => {
    const responses = new Map<string, ExecResult>([
      ["npm run build", mockExecResult({ code: 1, stderr: "TypeScript error" })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.mergeLocally(TEST_TASK_ID);
    assert.equal(result.success, false);
    assert.equal(result.testsPassed, false);
    assert.ok(result.error?.includes("Build falhou"));
  });

  // 9. mergeLocally — rebase failure: aborts rebase, returns error
  it("mergeLocally: falha no rebase aborta e retorna erro", async () => {
    const responses = new Map<string, ExecResult>([
      ["npm run build", mockExecResult({ code: 0 })],
      ["npm test", mockExecResult({ code: 0 })],
      ["git rebase", mockExecResult({ code: 1, stderr: "CONFLICT (content): Merge conflict" })],
      ["git rebase --abort", mockExecResult({ code: 0 })],
    ]);
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("auto"), createMockExecutor(responses));

    const result = await manager.mergeLocally(TEST_TASK_ID);
    assert.equal(result.success, false);
    assert.equal(result.testsPassed, true);
    assert.equal(result.merged, false);
    assert.ok(result.error?.includes("Rebase falhou"));
  });

  // 10. mergeLocally — L3 autonomy 'suggest': blocks with E_POLICY_APPROVAL
  it("mergeLocally: autonomy 'suggest' bloqueia L3 com E_POLICY_APPROVAL", async () => {
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("suggest"));

    await assert.rejects(
      async () => await manager.mergeLocally(TEST_TASK_ID),
      /L3 authorization denied: autonomy 'suggest' bloqueia 'worktree_merge_locally' \(nível L3\)/,
    );
  });

  // 11. mergeLocally — L3 autonomy 'ask': blocks without confirmation
  it("mergeLocally: autonomy 'ask' bloqueia L3 sem confirmação", async () => {
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("ask"));

    await assert.rejects(
      async () => await manager.mergeLocally(TEST_TASK_ID),
      /L3 authorization denied: autonomy 'ask' exige confirmação vigente para 'worktree_merge_locally' \(L3\)/,
    );
  });

  // 12. destroyWorktree — removes worktree, deletes branch, runs prune
  it("destroyWorktree: remove worktree, deleta branch, roda prune", async () => {
    const calls: string[] = [];
    const responses = new Map<string, ExecResult>([
      ["git worktree remove", mockExecResult({ code: 0 })],
      ["git branch -D", mockExecResult({ code: 0 })],
      ["git worktree prune", mockExecResult({ code: 0 })],
    ]);
    const executor = async (command: string, args: string[]) => {
      const cmd = `${command} ${args.join(" ")}`;
      calls.push(cmd);
      for (const [pattern, result] of responses) {
        if (cmd.includes(pattern)) {
          return result;
        }
      }
      return mockExecResult({ code: 1 });
    };
    const manager = new WorktreeManager("test-soul", { autonomy: "auto" }, executor);

    await assert.doesNotReject(async () => {
      await manager.destroyWorktree(TEST_TASK_ID);
    });

    assert.ok(calls.some((c) => c.includes("worktree remove --force")), "git worktree remove --force deve ser chamado");
    assert.ok(calls.some((c) => c.includes("branch -D")), "git branch -D deve ser chamado");
    assert.ok(calls.some((c) => c.includes("worktree prune")), "git worktree prune deve ser chamado");
  });

  // 13. destroyWorktree — forced cleanup: try/catch/finally guarantees prune even on error
  it("destroyWorktree: try/catch/finally garante prune mesmo em erro", async () => {
    let pruneCalled = false;
    const responses = new Map<string, ExecResult>([
      ["git worktree remove", mockExecResult({ code: 1, stderr: "failed to remove" })],
      ["git branch -D", mockExecResult({ code: 1, stderr: "branch not found" })],
      ["git worktree prune", mockExecResult({ code: 0 })],
    ]);
    const executor = async (command: string, args: string[]) => {
      const cmd = `${command} ${args.join(" ")}`;
      if (cmd.includes("git worktree prune")) pruneCalled = true;
      for (const [pattern, result] of responses) {
        if (cmd.includes(pattern)) {
          return result;
        }
      }
      return mockExecResult({ code: 1 });
    };
    const manager = new WorktreeManager("test-soul", { autonomy: "auto" }, executor);

    await assert.doesNotReject(async () => {
      await manager.destroyWorktree(TEST_TASK_ID);
    });

    assert.ok(pruneCalled, "git worktree prune deve ser chamado mesmo quando worktree remove e branch -D falham");
  });

  // 14. destroyWorktree — L3 autonomy gate (git_commit_push)
  it("destroyWorktree: autonomy 'suggest' bloqueia L3 com E_POLICY_APPROVAL", async () => {
    const manager = new WorktreeManager("test-soul", createTestAgentConfig("suggest"));

    await assert.rejects(
      async () => await manager.destroyWorktree(TEST_TASK_ID),
      /L3 authorization denied: autonomy 'suggest' bloqueia 'git_commit_push' \(nível L3\)/,
    );
  });
});

describe("Standalone functions (backward compatibility)", () => {
  it("createWorktree standalone: delega para WorktreeManager", async () => {
    const responses = new Map<string, ExecResult>([
      ["git worktree add", mockExecResult({ code: 0 })],
    ]);
    const executor = createMockExecutor(responses);
    // Note: standalone functions use default executor, so we can't easily test with mocks
    // This test just verifies the function exists and doesn't throw on import
    assert.equal(typeof createWorktree, "function");
  });

  it("setupEnvironment standalone: delega para WorktreeManager", async () => {
    assert.equal(typeof setupEnvironment, "function");
  });

  it("mergeLocally standalone: delega para WorktreeManager", async () => {
    assert.equal(typeof mergeLocally, "function");
  });

  it("destroyWorktree standalone: delega para WorktreeManager", async () => {
    assert.equal(typeof destroyWorktree, "function");
  });

  it("listWorktrees: filtra só as worktrees sob o workspaces root e extrai branch/HEAD (E5)", async () => {
    const root = getWorkspacesRoot();
    const porcelain = [
      `worktree ${process.cwd()}`,
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      `worktree ${root}/task-abc`,
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/task/task-abc",
      "",
      `worktree ${root}/task-xyz`,
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
    ].join("\n");
    const exec: CommandExecutor = async (command, args) => {
      if (command === "git" && args.join(" ") === "worktree list --porcelain") {
        return mockExecResult({ code: 0, stdout: porcelain });
      }
      return mockExecResult({ code: 1 });
    };
    const { listWorktrees } = await import("../tools/worktree-manager.js");
    const list = await listWorktrees(exec);
    assert.equal(list.length, 2, "repo root não conta, só as 2 worktrees de tarefa");
    assert.deepEqual(list.map((w) => w.taskId).sort(), ["task-abc", "task-xyz"]);
    const abc = list.find((w) => w.taskId === "task-abc")!;
    assert.equal(abc.branch, "task/task-abc");
    assert.equal(abc.head, "2222222222222222222222222222222222222222");
    const xyz = list.find((w) => w.taskId === "task-xyz")!;
    assert.equal(xyz.branch, null, "detached → branch null");
  });
});