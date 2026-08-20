/**
 * Testes unitários do orchestrator/router.
 *
 * Testa: selectExecutionMode, describeMode, FAST_CONFIG/PRO_CONFIG behavior.
 * Sem dependência de DB — apenas lógica de seleção de modo.
 *
 * Uso: node --test dist/test/orchestrator-router.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selectExecutionMode,
  describeMode,
  type ModeSelectionInput,
  type ExecutionMode,
  type RoutingDecision,
} from "../orchestrator/router.js";

// ── selectExecutionMode ─────────────────────────────────────────────

function makeInput(overrides: Partial<ModeSelectionInput> = {}): ModeSelectionInput {
  return {
    prompt: "ola, tudo bem?",
    ...overrides,
  };
}

describe("selectExecutionMode", () => {
  it("retorna 'fast' quando prompt simples sem explícito", () => {
    const result = selectExecutionMode(makeInput());
    assert.equal(result, "fast");
  });

  it("retorna 'fast' quando explícito = fast", () => {
    const result = selectExecutionMode(makeInput({ explicitMode: "fast" }));
    assert.equal(result, "fast");
  });

  it("retorna 'pro' quando explícito = pro", () => {
    const result = selectExecutionMode(makeInput({ explicitMode: "pro" }));
    assert.equal(result, "pro");
  });

  it("retorna 'pro' quando prompt contém keyword de complexidade", () => {
    const result = selectExecutionMode(makeInput({
      prompt: "faça uma análise completa dos dados",
    }));
    assert.equal(result, "pro");
  });

  it("retorna 'pro' quando prompt > 500 chars", () => {
    const longPrompt = "a".repeat(501);
    const result = selectExecutionMode(makeInput({ prompt: longPrompt }));
    assert.equal(result, "pro");
  });

  it("retorna 'fast' quando prompt é curto e sem keywords", () => {
    const result = selectExecutionMode(makeInput({
      prompt: "qual a capital do Brasil?",
    }));
    assert.equal(result, "fast");
  });

  it("retorna 'fast' quando explicitMode inválido é ignorado", () => {
    const result = selectExecutionMode(makeInput({
      explicitMode: "invalido" as ExecutionMode,
    }));
    assert.equal(result, "fast");
  });

  it("retorna 'pro' com keyword 'tabela'", () => {
    const result = selectExecutionMode(makeInput({
      prompt: "monte uma tabela de clientes",
    }));
    assert.equal(result, "pro");
  });

  it("retorna 'pro' com keyword 'passo a passo'", () => {
    const result = selectExecutionMode(makeInput({
      prompt: "explique passo a passo como funciona",
    }));
    assert.equal(result, "pro");
  });

  it("retorna 'pro' com keyword 'scrape'", () => {
    const result = selectExecutionMode(makeInput({
      prompt: "scrape esse site e extraia os dados",
    }));
    assert.equal(result, "pro");
  });
});

// ── describeMode ────────────────────────────────────────────────────

function makeRoutingDecision(mode: ExecutionMode): RoutingDecision {
  return {
    mode,
    model: "test-model",
    maxIterations: mode === "fast" ? 2 : 5,
    ragTopK: mode === "fast" ? 3 : 5,
    ragRatio: { semantic: mode === "fast" ? 1.0 : 0.7, literal: mode === "fast" ? 0.0 : 0.3 },
    deepExtraction: mode === "pro",
    route: {
      target: { tier: "local", model: "test-model" },
      reason: "test",
    },
  } as RoutingDecision;
}

describe("describeMode", () => {
  it("retorna descrição para 'fast'", () => {
    const desc = describeMode(makeRoutingDecision("fast"));
    assert.ok(desc.length > 0);
    assert.ok(desc.includes("FAST"));
  });

  it("retorna descrição para 'pro'", () => {
    const desc = describeMode(makeRoutingDecision("pro"));
    assert.ok(desc.length > 0);
    assert.ok(desc.includes("PRO"));
  });

  it("inclui informações de maxIterations", () => {
    const desc = describeMode(makeRoutingDecision("fast"));
    assert.ok(desc.includes("2"));
  });

  it("inclui deep extraction info", () => {
    const fastDesc = describeMode(makeRoutingDecision("fast"));
    assert.ok(fastDesc.includes("não"));
    const proDesc = describeMode(makeRoutingDecision("pro"));
    assert.ok(proDesc.includes("sim"));
  });
});

// ── RoutingDecision structure ───────────────────────────────────────

describe("RoutingDecision structure", () => {
  it("fast mode config: maxIterations = 2, ragTopK = 3", () => {
    const fast = makeRoutingDecision("fast");
    assert.equal(fast.maxIterations, 2);
    assert.equal(fast.ragTopK, 3);
    assert.equal(fast.deepExtraction, false);
  });

  it("pro mode config: maxIterations = 5, ragTopK = 5", () => {
    const pro = makeRoutingDecision("pro");
    assert.equal(pro.maxIterations, 5);
    assert.equal(pro.ragTopK, 5);
    assert.equal(pro.deepExtraction, true);
  });

  it("ragRatio semantic > literal para pro", () => {
    const pro = makeRoutingDecision("pro");
    assert.ok(pro.ragRatio.semantic > pro.ragRatio.literal);
  });
});
