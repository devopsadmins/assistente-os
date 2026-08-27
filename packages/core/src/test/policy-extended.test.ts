/**
 * Testes estendidos de policy.ts — capabilities L3 novas e annotate_diff L2.
 *
 * Uso: node --test dist/test/policy-extended.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityRiskLevel,
  authorizeExecution,
  type AuthorizeExecutionInput,
} from "../policy.js";

describe("capabilityRiskLevel - novas capabilities", () => {
  it("worktree_merge_locally é L3", () => {
    assert.equal(capabilityRiskLevel("worktree_merge_locally"), "L3");
  });

  it("git_commit_push é L3", () => {
    assert.equal(capabilityRiskLevel("git_commit_push"), "L3");
  });

  it("annotate_diff é L2", () => {
    assert.equal(capabilityRiskLevel("annotate_diff"), "L2");
  });
});

describe("authorizeExecution - worktree_merge_locally", () => {
  const baseInput: AuthorizeExecutionInput = {
    soulId: "test-soul",
    capability: "worktree_merge_locally",
    agentConfig: {
      permissions: { tools: ["*"] },
      guardrails: {},
      autonomy: "ask",
    },
  };

  it("autonomy=ask bloqueia sem confirmação", () => {
    const result = authorizeExecution({ ...baseInput, confirmation: undefined });
    assert.equal(result.allow, false);
    assert.equal(result.code, "E_POLICY_APPROVAL");
  });

  it("autonomy=ask permite com confirmação", () => {
    const result = authorizeExecution({ ...baseInput, confirmation: { ok: true } });
    assert.equal(result.allow, true);
  });

  it("autonomy=suggest bloqueia", () => {
    const result = authorizeExecution({
      ...baseInput,
      agentConfig: { ...baseInput.agentConfig!, autonomy: "suggest" },
      confirmation: { ok: true },
    });
    assert.equal(result.allow, false);
    assert.equal(result.code, "E_POLICY_APPROVAL");
  });

  it("autonomy=auto permite", () => {
    const result = authorizeExecution({
      ...baseInput,
      agentConfig: { ...baseInput.agentConfig!, autonomy: "auto" },
    });
    assert.equal(result.allow, true);
  });

  it("approvalPolicy adiciona exigência extra", () => {
    const result = authorizeExecution({
      ...baseInput,
      agentConfig: {
        ...baseInput.agentConfig!,
        autonomy: "auto",
        approvalPolicy: ["worktree_merge_locally"],
      },
      confirmation: undefined,
    });
    assert.equal(result.allow, false);
    assert.equal(result.code, "E_POLICY_APPROVAL");
  });
});

describe("authorizeExecution - annotate_diff", () => {
  const baseInput: AuthorizeExecutionInput = {
    soulId: "test-soul",
    capability: "annotate_diff",
    agentConfig: {
      permissions: { tools: ["*"] },
      guardrails: {},
      autonomy: "ask",
    },
  };

  it("autonomy=ask permite (L2 não bloqueado por ask)", () => {
    const result = authorizeExecution(baseInput);
    assert.equal(result.allow, true);
  });

  it("autonomy=suggest bloqueia (L2 bloqueado por suggest)", () => {
    const result = authorizeExecution({
      ...baseInput,
      agentConfig: { ...baseInput.agentConfig!, autonomy: "suggest" },
    });
    assert.equal(result.allow, false);
    assert.equal(result.code, "E_POLICY_APPROVAL");
  });
});