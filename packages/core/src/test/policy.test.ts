import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_CATALOG_VERSION,
  authorizeExecution,
  capabilityRiskLevel,
  isKnownCapability,
} from "../policy.js";
import type { AgentConfig } from "../types/agent.js";

// ── CAPABILITY_CATALOG_VERSION ──────────────────────────────────────────

test("CAPABILITY_CATALOG_VERSION is defined", () => {
  assert.equal(typeof CAPABILITY_CATALOG_VERSION, "string");
  assert.ok(CAPABILITY_CATALOG_VERSION.length > 0);
});

// ── capabilityRiskLevel / isKnownCapability ─────────────────────────────

test("capabilityRiskLevel: exact match L1", () => {
  assert.equal(capabilityRiskLevel("memory_search"), "L1");
  assert.equal(capabilityRiskLevel("soul_context"), "L1");
});

test("capabilityRiskLevel: exact match L2", () => {
  assert.equal(capabilityRiskLevel("observation_add"), "L2");
  assert.equal(capabilityRiskLevel("ado_list_projects"), "L2");
});

test("capabilityRiskLevel: wildcard match L3 (browser_*)", () => {
  assert.equal(capabilityRiskLevel("browser_navigate"), "L3");
  assert.equal(capabilityRiskLevel("browser_click"), "L3");
});

test("capabilityRiskLevel: exact match wins over a broader wildcard (ado_create_work_item L3 vs ado_* not in catalog)", () => {
  assert.equal(capabilityRiskLevel("ado_create_work_item"), "L3");
  assert.equal(capabilityRiskLevel("ado_list_projects"), "L2");
});

test("capabilityRiskLevel: action_execute is L3 (fail-safe, doc contradiction resolved conservatively)", () => {
  assert.equal(capabilityRiskLevel("action_execute"), "L3");
});

test("capabilityRiskLevel: unknown capability returns undefined", () => {
  assert.equal(capabilityRiskLevel("totally_fake_tool"), undefined);
});

test("isKnownCapability: true for catalogued, false for unknown", () => {
  assert.ok(isKnownCapability("soul_create"));
  assert.ok(isKnownCapability("browser_navigate"));
  assert.ok(!isKnownCapability("totally_fake_tool"));
});

// ── authorizeExecution: precedência (doc §C1 / §11 #15) ─────────────────

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    permissions: { tools: ["memory_search", "observation_add", "browser_navigate", "soul_create"] },
    guardrails: {},
    autonomy: "ask",
    ...overrides,
  };
}

test("authorizeExecution: capability fora do snapshot -> E_AUTHZ", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "guardian_approve_rule",
    agentConfig: agentConfig(),
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) assert.equal(decision.code, "E_AUTHZ");
});

test("authorizeExecution: denylist vence mesmo com budget e confirmação OK", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "memory_search",
    agentConfig: agentConfig({ autonomy: "auto" }),
    budget: { ok: true },
    confirmation: { ok: true },
    denylist: ["memory_search"],
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) assert.equal(decision.code, "E_AUTHZ");
});

test("authorizeExecution: conector não declarado -> E_CONNECTOR, mesmo com capability no snapshot", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "browser_navigate",
    agentConfig: agentConfig({ autonomy: "auto" }),
    connector: "playwright",
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) assert.equal(decision.code, "E_CONNECTOR");
});

test("authorizeExecution: conector declarado -> passa a checagem de conector", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "browser_navigate",
    agentConfig: agentConfig({
      autonomy: "auto",
      permissions: { tools: ["browser_navigate"], connectors: ["playwright"] },
    }),
    connector: "playwright",
  });
  assert.equal(decision.allow, true);
});

test("authorizeExecution: budget insuficiente -> E_BUDGET, mesmo com capability L1 e autonomy auto", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "memory_search",
    agentConfig: agentConfig({ autonomy: "auto" }),
    budget: { ok: false, reason: "limite diário excedido" },
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) {
    assert.equal(decision.code, "E_BUDGET");
    assert.match(decision.reason, /limite diário/);
  }
});

test("authorizeExecution: autonomy 'suggest' bloqueia L2 e L3", () => {
  const cfg = agentConfig({ autonomy: "suggest" });
  const l2 = authorizeExecution({ soulId: "s1", capability: "observation_add", agentConfig: cfg });
  const l3 = authorizeExecution({ soulId: "s1", capability: "browser_navigate", agentConfig: cfg });
  assert.equal(l2.allow, false);
  assert.equal(l3.allow, false);
  if (!l2.allow) assert.equal(l2.code, "E_POLICY_APPROVAL");
  if (!l3.allow) assert.equal(l3.code, "E_POLICY_APPROVAL");
});

test("authorizeExecution: autonomy 'suggest' permite L1", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "memory_search",
    agentConfig: agentConfig({ autonomy: "suggest" }),
  });
  assert.equal(decision.allow, true);
});

test("authorizeExecution: autonomy 'ask' bloqueia L3 sem confirmação, libera com confirmação", () => {
  const cfg = agentConfig({ autonomy: "ask" });
  const denied = authorizeExecution({ soulId: "s1", capability: "browser_navigate", agentConfig: cfg });
  assert.equal(denied.allow, false);
  if (!denied.allow) assert.equal(denied.code, "E_POLICY_APPROVAL");

  const allowed = authorizeExecution({
    soulId: "s1",
    capability: "browser_navigate",
    agentConfig: cfg,
    confirmation: { ok: true },
  });
  assert.equal(allowed.allow, true);
});

test("authorizeExecution: autonomy 'ask' não exige confirmação para L2", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "observation_add",
    agentConfig: agentConfig({ autonomy: "ask" }),
  });
  assert.equal(decision.allow, true);
});

test("authorizeExecution: autonomy 'auto' libera L3 já no snapshot sem exigir confirmação", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "browser_navigate",
    agentConfig: agentConfig({ autonomy: "auto" }),
  });
  assert.equal(decision.allow, true);
});

test("authorizeExecution: approvalPolicy adiciona exigência sem confirmação, mesmo com autonomy 'auto'", () => {
  const cfg = agentConfig({ autonomy: "auto", approvalPolicy: ["soul_create"] });
  const denied = authorizeExecution({ soulId: "s1", capability: "soul_create", agentConfig: cfg });
  assert.equal(denied.allow, false);
  if (!denied.allow) assert.equal(denied.code, "E_POLICY_APPROVAL");

  const allowed = authorizeExecution({
    soulId: "s1",
    capability: "soul_create",
    agentConfig: cfg,
    confirmation: { ok: true },
  });
  assert.equal(allowed.allow, true);
  if (allowed.allow) {
    assert.equal(allowed.requiresApproval, true);
    assert.equal(allowed.approvalReason, "approvalPolicy");
  }
});

test("authorizeExecution: approvalPolicy nunca resgata uma negação de autonomy 'suggest'", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "observation_add",
    agentConfig: agentConfig({ autonomy: "suggest", approvalPolicy: ["observation_add"] }),
    confirmation: { ok: true },
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) assert.equal(decision.code, "E_POLICY_APPROVAL");
});

test("authorizeExecution: effect 'external' escala L2 para L3 (bloqueia sob autonomy ask sem confirmação)", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "observation_add",
    agentConfig: agentConfig({ autonomy: "ask" }),
    effect: "external",
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) assert.equal(decision.code, "E_POLICY_APPROVAL");
});

test("authorizeExecution: allow limpo retorna requiresApproval:false quando não há approvalPolicy", () => {
  const decision = authorizeExecution({
    soulId: "s1",
    capability: "memory_search",
    agentConfig: agentConfig({ autonomy: "ask" }),
  });
  assert.equal(decision.allow, true);
  if (decision.allow) assert.equal(decision.requiresApproval, false);
});
