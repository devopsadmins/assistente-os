import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeText,
  detectSecrets,
  sanitizeUserPrompt,
  sanitizeLLMResponse,
  DEFAULT_PATTERNS,
} from "../security/content-filter.js";

// ── detectSecrets ────────────────────────────────────────────────────

test("detectSecrets: detecta OpenAI API key", () => {
  const text = "Minha chave é sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234";
  const results = detectSecrets(text);
  assert.ok(results.length >= 1);
  assert.equal(results[0]!.name, "OPENAI_API_KEY");
});

test("detectSecrets: detecta GitHub token", () => {
  const text = "Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890"; // ghp_ + 36 chars
  const results = detectSecrets(text);
  assert.ok(results.length >= 1);
  assert.ok(results.some((r) => r.name === "GITHUB_TOKEN"));
});

test("detectSecrets: detecta AWS key", () => {
  const text = "Key: AKIAIOSFODNN7EXAMPLE";
  const results = detectSecrets(text);
  assert.ok(results.length >= 1);
  assert.equal(results[0]!.name, "AWS_ACCESS_KEY");
});

test("detectSecrets: retorna vazio quando não há secrets", () => {
  const text = "Olá, tudo bem? Não tenho nenhum segredo aqui.";
  const results = detectSecrets(text);
  assert.equal(results.length, 0);
});

// ── sanitizeText ─────────────────────────────────────────────────────

test("sanitizeText: mascara OpenAI key", () => {
  const text = "Use sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234 para autenticar";
  const result = sanitizeText(text);
  assert.ok(result.sanitized.includes("[REDACTED_OPENAI_KEY]"));
  assert.ok(!result.sanitized.includes("sk-abc123"));
  assert.equal(result.count, 1);
  assert.equal(result.detected[0]!.name, "OPENAI_API_KEY");
});

test("sanitizeText: mascara múltiplos secrets", () => {
  const text = "Key1: sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234 Key2: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  const result = sanitizeText(text);
  assert.ok(result.count >= 2);
  assert.ok(!result.sanitized.includes("sk-abc123"));
  assert.ok(!result.sanitized.includes("ghp_abc"));
});

test("sanitizeText: não mascara texto limpo", () => {
  const text = "Olá, tudo bem? Não tenho nenhum segredo aqui.";
  const result = sanitizeText(text);
  assert.equal(result.count, 0);
  assert.equal(result.sanitized, text);
});

test("sanitizeText: mascara private key", () => {
  const text = `Chave: -----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy5AH...
-----END RSA PRIVATE KEY-----`;
  const result = sanitizeText(text);
  assert.ok(result.sanitized.includes("[REDACTED_PRIVATE_KEY]"));
  assert.ok(!result.sanitized.includes("BEGIN RSA PRIVATE KEY"));
});

test("sanitizeText: mascara database URL", () => {
  const text = "Conexão: postgres://user:pass@localhost:5432/db";
  const result = sanitizeText(text);
  assert.ok(result.sanitized.includes("[REDACTED_DB_URL]"));
  assert.ok(!result.sanitized.includes("postgres://"));
});

// ── sanitizeUserPrompt / sanitizeLLMResponse ─────────────────────────

test("sanitizeUserPrompt: funciona igual sanitizeText", () => {
  const text = "Use sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234";
  const result = sanitizeUserPrompt(text);
  assert.ok(result.sanitized.includes("[REDACTED_OPENAI_KEY]"));
});

test("sanitizeLLMResponse: funciona igual sanitizeText", () => {
  const text = "A chave é ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  const result = sanitizeLLMResponse(text);
  assert.ok(result.sanitized.includes("[REDACTED_GITHUB_TOKEN]"));
});

// ── DEFAULT_PATTERNS ─────────────────────────────────────────────────

test("DEFAULT_PATTERNS tem 12 padrões", () => {
  assert.equal(DEFAULT_PATTERNS.length, 12);
});

test("DEFAULT_PATTERNS: todos têm name, regex e replacement", () => {
  for (const p of DEFAULT_PATTERNS) {
    assert.ok(p.name, `pattern ${JSON.stringify(p)} sem name`);
    assert.ok(p.regex instanceof RegExp, `pattern ${p.name} sem regex`);
    assert.ok(typeof p.replacement === "string", `pattern ${p.name} sem replacement`);
  }
});
