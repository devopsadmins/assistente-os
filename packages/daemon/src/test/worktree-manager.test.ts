/**
 * Testes unitários do worktree-manager.
 *
 * Testa helpers puros e lógica de sanitização.
 * Uso: node --test dist/test/worktree-manager.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getWorktreePath,
  getWorkspacesRoot,
} from "../tools/worktree-manager.js";

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