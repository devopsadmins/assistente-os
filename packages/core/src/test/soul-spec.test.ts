import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SOUL_SPEC_LIMITS,
  SOUL_SPEC_SCHEMA_VERSION,
  buildAgentConfigFromSpec,
  canonicalJsonStringify,
  computePlanHash,
  resolveSoulSpecDefaults,
  validateSoulSpec,
  type SoulSpec,
} from "../soul-spec.js";
import { CAPABILITY_CATALOG_VERSION } from "../policy.js";
import { DEFAULT_GLOBAL_GUARDRAILS } from "../types/agent.js";

function baseSpec(overrides: Partial<SoulSpec> = {}): SoulSpec {
  return {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    newId: "nova-soul",
    autonomy: "ask",
    capabilities: ["memory_search", "soul_context"],
    ...overrides,
  };
}

// ── validateSoulSpec: newId ──────────────────────────────────────────────

test("validateSoulSpec: newId com path traversal é rejeitado (§11 #4)", () => {
  const result = validateSoulSpec(baseSpec({ newId: "../etc/passwd" }), { existingIds: new Set() });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === "newId"));
});

test("validateSoulSpec: newId vazio é rejeitado", () => {
  const result = validateSoulSpec(baseSpec({ newId: "" }), { existingIds: new Set() });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === "newId"));
});

test("validateSoulSpec: newId já existente é rejeitado", () => {
  const result = validateSoulSpec(baseSpec({ newId: "ja-existe" }), { existingIds: new Set(["ja-existe"]) });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === "newId"));
});

test("validateSoulSpec: newId válido e único passa", () => {
  const result = validateSoulSpec(baseSpec(), { existingIds: new Set(["outra-soul"]) });
  assert.ok(!result.issues.some((i) => i.field === "newId"));
});

// ── validateSoulSpec: limites em bytes (§6, §11 #9) ──────────────────────

test("validateSoulSpec: arquivo exatamente no limite (32KB) passa", () => {
  const content = "a".repeat(DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes);
  const result = validateSoulSpec(baseSpec({ perfilMd: content }), { existingIds: new Set() });
  assert.ok(!result.issues.some((i) => i.field === "perfilMd"));
});

test("validateSoulSpec: arquivo acima do limite (32KB + 1) é rejeitado", () => {
  const content = "a".repeat(DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes + 1);
  const result = validateSoulSpec(baseSpec({ perfilMd: content }), { existingIds: new Set() });
  assert.ok(result.issues.some((i) => i.field === "perfilMd"));
});

test("validateSoulSpec: soma de arquivos abaixo do limite individual mas acima do total (128KB) é rejeitada", () => {
  // 4 arquivos de 32KB cada = 128KB exato; 5º campo de texto pequeno estoura o total.
  const chunk = "a".repeat(DEFAULT_SOUL_SPEC_LIMITS.maxFileBytes);
  const result = validateSoulSpec(
    baseSpec({
      perfilMd: chunk,
      contextoMd: chunk,
      pessoasMd: chunk,
      soulMd: chunk,
      mission: "estourando o total",
    }),
    { existingIds: new Set() },
  );
  assert.ok(result.issues.some((i) => i.field === "_total"));
});

// ── validateSoulSpec: skills / connectors (§6) ───────────────────────────

test("validateSoulSpec: 21 skills excede o limite de 20", () => {
  const skills = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
  const result = validateSoulSpec(baseSpec({ skills }), { existingIds: new Set() });
  assert.ok(result.issues.some((i) => i.field === "skills"));
});

test("validateSoulSpec: 20 skills não excede o limite", () => {
  const skills = Array.from({ length: 20 }, (_, i) => `skill-${i}`);
  const result = validateSoulSpec(baseSpec({ skills }), { existingIds: new Set() });
  assert.ok(!result.issues.some((i) => i.field === "skills"));
});

test("validateSoulSpec: 11 conectores excede o limite de 10", () => {
  const connectors = Array.from({ length: 11 }, (_, i) => `connector-${i}`);
  const result = validateSoulSpec(baseSpec({ connectors }), { existingIds: new Set() });
  assert.ok(result.issues.some((i) => i.field === "connectors"));
});

test("validateSoulSpec: 10 conectores não excede o limite", () => {
  const connectors = Array.from({ length: 10 }, (_, i) => `connector-${i}`);
  const result = validateSoulSpec(baseSpec({ connectors }), { existingIds: new Set() });
  assert.ok(!result.issues.some((i) => i.field === "connectors"));
});

// ── validateSoulSpec: capabilities fora do catálogo (§11 #10) ────────────

test("validateSoulSpec: capability sintaticamente válida mas fora do catálogo é rejeitada", () => {
  const result = validateSoulSpec(baseSpec({ capabilities: ["totally_fake_tool_xyz"] }), {
    existingIds: new Set(),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.field === "capabilities"));
});

test("validateSoulSpec: capabilities conhecidas (incluindo wildcard) passam", () => {
  const result = validateSoulSpec(baseSpec({ capabilities: ["memory_search", "browser_navigate"] }), {
    existingIds: new Set(),
  });
  assert.ok(!result.issues.some((i) => i.field === "capabilities"));
});

// ── computePlanHash / canonicalJsonStringify (§11 #14) ───────────────────

function planHashInputFor(spec: SoulSpec, catalogVersion = CAPABILITY_CATALOG_VERSION) {
  return {
    schemaVersion: SOUL_SPEC_SCHEMA_VERSION,
    catalogVersion,
    spec: resolveSoulSpecDefaults(spec, DEFAULT_GLOBAL_GUARDRAILS),
    effectiveProvider: "zen",
    effectiveModel: "nemotron-3-ultra-free",
  };
}

test("canonicalJsonStringify: chaves em ordem diferente produzem a mesma string", () => {
  const a = { b: 1, a: 2 };
  const b = { a: 2, b: 1 };
  assert.equal(canonicalJsonStringify(a), canonicalJsonStringify(b));
});

test("canonicalJsonStringify: arrays não são reordenados (ordem é semântica)", () => {
  const a = { list: [1, 2, 3] };
  const b = { list: [3, 2, 1] };
  assert.notEqual(canonicalJsonStringify(a), canonicalJsonStringify(b));
});

test("computePlanHash: determinístico para o mesmo input", () => {
  const spec = baseSpec();
  const hash1 = computePlanHash(planHashInputFor(spec));
  const hash2 = computePlanHash(planHashInputFor(spec));
  assert.equal(hash1, hash2);
});

test("computePlanHash: muda ao adicionar uma capability", () => {
  const hashBefore = computePlanHash(planHashInputFor(baseSpec()));
  const hashAfter = computePlanHash(planHashInputFor(baseSpec({ capabilities: ["memory_search", "soul_context", "agenda_add"] })));
  assert.notEqual(hashBefore, hashAfter);
});

test("computePlanHash: muda quando catalogVersion muda (catálogo mudou entre preview e commit)", () => {
  const spec = baseSpec();
  const hashV1 = computePlanHash(planHashInputFor(spec, "1.0.0"));
  const hashV2 = computePlanHash(planHashInputFor(spec, "1.1.0"));
  assert.notEqual(hashV1, hashV2);
});

test("computePlanHash: muda ao reordenar o array capabilities", () => {
  const hashA = computePlanHash(planHashInputFor(baseSpec({ capabilities: ["memory_search", "soul_context"] })));
  const hashB = computePlanHash(planHashInputFor(baseSpec({ capabilities: ["soul_context", "memory_search"] })));
  assert.notEqual(hashA, hashB);
});

// ── buildAgentConfigFromSpec / resolveSoulSpecDefaults ───────────────────

test("buildAgentConfigFromSpec: spec sem guardrails usa os guardrails globais", () => {
  const config = buildAgentConfigFromSpec(baseSpec(), DEFAULT_GLOBAL_GUARDRAILS);
  assert.equal(config.guardrails.maxTurns, DEFAULT_GLOBAL_GUARDRAILS.maxTurns);
  assert.equal(config.guardrails.maxIterations, DEFAULT_GLOBAL_GUARDRAILS.maxIterations);
});

test("resolveSoulSpecDefaults: clampa maxIterations pedido acima do global", () => {
  const resolved = resolveSoulSpecDefaults(baseSpec({ guardrails: { maxIterations: 999 } }), DEFAULT_GLOBAL_GUARDRAILS);
  assert.equal(resolved.guardrails?.maxIterations, DEFAULT_GLOBAL_GUARDRAILS.maxIterations);
});

test("resolveSoulSpecDefaults: aplica defaults de memoryPolicy/approvalPolicy/connectors/skills", () => {
  const resolved = resolveSoulSpecDefaults(baseSpec(), DEFAULT_GLOBAL_GUARDRAILS);
  assert.deepEqual(resolved.approvalPolicy, []);
  assert.deepEqual(resolved.connectors, []);
  assert.deepEqual(resolved.skills, []);
  assert.equal(resolved.memoryPolicy?.enforcement, "partial");
});
