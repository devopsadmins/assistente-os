import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesToolPattern,
  isToolAllowed,
  resolveAllowedTools,
  resolveGuardrails,
  resolveEffectiveGuardrails,
  resolveConnectors,
  resolveAutonomy,
  resolveApprovalPolicy,
  resolveMemoryPolicy,
  clampMaxPermissive,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_GUARDRAILS,
  DEFAULT_GLOBAL_GUARDRAILS,
} from "../types/agent.js";
import type { AgentConfig, GlobalGuardrails } from "../types/agent.js";

// ── matchesToolPattern ────────────────────────────────────────────────

test("matchesToolPattern: exact match", () => {
  assert.ok(matchesToolPattern("soul_context", "soul_context"));
  assert.ok(!matchesToolPattern("soul_context", "soul_chat"));
});

test("matchesToolPattern: namespace wildcard memory:*", () => {
  assert.ok(matchesToolPattern("memory:*", "memory_search"));
  assert.ok(matchesToolPattern("memory:*", "memory_index"));
  assert.ok(matchesToolPattern("memory:*", "memory_status"));
  assert.ok(matchesToolPattern("memory:*", "memory"));
  assert.ok(!matchesToolPattern("memory:*", "graph_list"));
});

test("matchesToolPattern: namespace wildcard ado_*", () => {
  assert.ok(matchesToolPattern("ado_*", "ado_list_projects"));
  assert.ok(matchesToolPattern("ado_*", "ado_create_work_item"));
  assert.ok(!matchesToolPattern("ado_*", "memory_search"));
});

test("matchesToolPattern: glob * matches everything", () => {
  assert.ok(matchesToolPattern("*", "anything"));
  assert.ok(matchesToolPattern("*", "ado_list_projects"));
  assert.ok(matchesToolPattern("*", "browser_navigate"));
});

test("matchesToolPattern: partial wildcard ado_list_*", () => {
  assert.ok(matchesToolPattern("ado_list_*", "ado_list_projects"));
  assert.ok(matchesToolPattern("ado_list_*", "ado_list_repositories"));
  assert.ok(!matchesToolPattern("ado_list_*", "ado_create_work_item"));
});

test("matchesToolPattern: regex special chars escaped", () => {
  assert.ok(!matchesToolPattern("soul.context", "soul_context"));
  assert.ok(matchesToolPattern("soul.context", "soul.context"));
});

// ── isToolAllowed ─────────────────────────────────────────────────────

test("isToolAllowed: matches any pattern in list", () => {
  const patterns = ["memory:*", "soul_context", "ado_*"];
  assert.ok(isToolAllowed(patterns, "memory_search"));
  assert.ok(isToolAllowed(patterns, "soul_context"));
  assert.ok(isToolAllowed(patterns, "ado_list_projects"));
  assert.ok(!isToolAllowed(patterns, "browser_navigate"));
  assert.ok(!isToolAllowed(patterns, "action_execute"));
});

test("isToolAllowed: empty list denies all", () => {
  assert.ok(!isToolAllowed([], "memory_search"));
});

test("isToolAllowed: wildcard allows all", () => {
  assert.ok(isToolAllowed(["*"], "anything_goes"));
});

// ── resolveAllowedTools ───────────────────────────────────────────────

test("resolveAllowedTools: returns defaults when no agent config", () => {
  const tools = resolveAllowedTools(undefined);
  assert.deepEqual(tools, DEFAULT_ALLOWED_TOOLS);
});

test("resolveAllowedTools: returns agent permissions when configured", () => {
  const agent: AgentConfig = {
    permissions: { tools: ["memory:*", "browser_*"] },
    guardrails: {},
  };
  const tools = resolveAllowedTools(agent);
  assert.deepEqual(tools, ["memory:*", "browser_*"]);
});

// ── resolveGuardrails ─────────────────────────────────────────────────

test("resolveGuardrails: returns defaults when no agent config", () => {
  const g = resolveGuardrails(undefined);
  assert.equal(g.maxTurns, 10);
  assert.equal(g.maxIterations, 5);
  assert.equal(g.ragRelevanceThreshold, 0.70);
});

test("resolveGuardrails: overrides from agent config", () => {
  const agent: AgentConfig = {
    permissions: { tools: [] },
    guardrails: { maxTurns: 15, ragRelevanceThreshold: 0.80 },
  };
  const g = resolveGuardrails(agent);
  assert.equal(g.maxTurns, 15);
  assert.equal(g.maxIterations, 5); // fallback
  assert.equal(g.ragRelevanceThreshold, 0.80);
});

// ── Cohort 1 patterns ────────────────────────────────────────────────

test("desenvolvimento allowlist: allows browser_*, ado_*, memory:*", () => {
  const devPatterns = [
    "memory:*", "soul_context", "soul_chat", "graph_list", "observation_add",
    "soul_anotar", "soul_licao", "soul_decidir", "agenda_add", "agenda_list",
    "action_execute", "ado_*", "browser_navigate", "browser_click",
    "browser_extract_text", "browser_screenshot", "browser_close",
  ];
  assert.ok(isToolAllowed(devPatterns, "memory_search"));
  assert.ok(isToolAllowed(devPatterns, "ado_list_projects"));
  assert.ok(isToolAllowed(devPatterns, "browser_navigate"));
  assert.ok(isToolAllowed(devPatterns, "action_execute"));
  assert.ok(!isToolAllowed(devPatterns, "souls_list"));
});

test("investimentos allowlist: no ado_*, no action_execute", () => {
  const invPatterns = [
    "memory:*", "soul_context", "soul_chat", "graph_list", "observation_add",
    "soul_anotar", "soul_licao", "soul_decidir", "agenda_add", "agenda_list",
    "browser_navigate", "browser_extract_text", "browser_screenshot",
  ];
  assert.ok(isToolAllowed(invPatterns, "memory_search"));
  assert.ok(isToolAllowed(invPatterns, "browser_navigate"));
  assert.ok(!isToolAllowed(invPatterns, "ado_list_projects"));
  assert.ok(!isToolAllowed(invPatterns, "action_execute"));
  assert.ok(!isToolAllowed(invPatterns, "browser_click"));
});

// ── clampMaxPermissive ───────────────────────────────────────────────

test("clampMaxPermissive: soulLimit undefined retorna o global", () => {
  assert.equal(clampMaxPermissive(10, undefined), 10);
});

test("clampMaxPermissive: soulLimit maior que o global é clampado para o global", () => {
  assert.equal(clampMaxPermissive(5, 999), 5);
});

test("clampMaxPermissive: soulLimit menor que o global é respeitado (soul pode restringir)", () => {
  assert.equal(clampMaxPermissive(10, 3), 3);
});

// ── resolveEffectiveGuardrails ────────────────────────────────────────

const GLOBAL: GlobalGuardrails = { maxTurns: 10, maxIterations: 5, ragRelevanceThreshold: 0.70 };

test("resolveEffectiveGuardrails: soul pedindo mais iterações que o global é clampada", () => {
  const agent: AgentConfig = { permissions: { tools: [] }, guardrails: { maxIterations: 20 } };
  const g = resolveEffectiveGuardrails(GLOBAL, agent);
  assert.equal(g.maxIterations, 5);
});

test("resolveEffectiveGuardrails: ragRelevanceThreshold usa max() — soul não pode afrouxar abaixo do global", () => {
  const agent: AgentConfig = { permissions: { tools: [] }, guardrails: { ragRelevanceThreshold: 0.50 } };
  const g = resolveEffectiveGuardrails(GLOBAL, agent);
  assert.equal(g.ragRelevanceThreshold, 0.70);
});

test("resolveEffectiveGuardrails: soul mais restritiva que o global é respeitada", () => {
  const agent: AgentConfig = { permissions: { tools: [] }, guardrails: { maxTurns: 3, ragRelevanceThreshold: 0.90 } };
  const g = resolveEffectiveGuardrails(GLOBAL, agent);
  assert.equal(g.maxTurns, 3);
  assert.equal(g.ragRelevanceThreshold, 0.90);
});

test("resolveEffectiveGuardrails: sem agentConfig cai nos defaults globais", () => {
  const g = resolveEffectiveGuardrails(GLOBAL, undefined);
  assert.equal(g.maxTurns, GLOBAL.maxTurns);
  assert.equal(g.maxIterations, GLOBAL.maxIterations);
  assert.equal(g.ragRelevanceThreshold, GLOBAL.ragRelevanceThreshold);
});

test("DEFAULT_GLOBAL_GUARDRAILS: valores padrão consistentes com DEFAULT_GUARDRAILS", () => {
  assert.equal(DEFAULT_GLOBAL_GUARDRAILS.maxTurns, DEFAULT_GUARDRAILS.maxTurns);
  assert.equal(DEFAULT_GLOBAL_GUARDRAILS.maxIterations, DEFAULT_GUARDRAILS.maxIterations);
  assert.equal(DEFAULT_GLOBAL_GUARDRAILS.ragRelevanceThreshold, DEFAULT_GUARDRAILS.ragRelevanceThreshold);
});

// ── resolveConnectors / resolveAutonomy / resolveApprovalPolicy / resolveMemoryPolicy ──

test("resolveConnectors: sem agentConfig retorna lista vazia (§9)", () => {
  assert.deepEqual(resolveConnectors(undefined), []);
});

test("resolveConnectors: retorna os conectores declarados", () => {
  const agent: AgentConfig = { permissions: { tools: [], connectors: ["playwright"] }, guardrails: {} };
  assert.deepEqual(resolveConnectors(agent), ["playwright"]);
});

test("resolveAutonomy: sem agentConfig retorna 'ask' (§9)", () => {
  assert.equal(resolveAutonomy(undefined), "ask");
});

test("resolveAutonomy: retorna o valor declarado", () => {
  const agent: AgentConfig = { permissions: { tools: [] }, guardrails: {}, autonomy: "auto" };
  assert.equal(resolveAutonomy(agent), "auto");
});

test("resolveApprovalPolicy: sem agentConfig retorna lista vazia", () => {
  assert.deepEqual(resolveApprovalPolicy(undefined), []);
});

test("resolveMemoryPolicy: sem agentConfig retorna enforcement 'partial' (§9)", () => {
  const policy = resolveMemoryPolicy(undefined);
  assert.equal(policy.enforcement, "partial");
  assert.equal(policy.classification, "internal");
});
