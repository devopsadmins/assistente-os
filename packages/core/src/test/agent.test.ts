import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesToolPattern,
  isToolAllowed,
  resolveAllowedTools,
  resolveGuardrails,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_GUARDRAILS,
} from "../types/agent.js";
import type { AgentConfig } from "../types/agent.js";

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
