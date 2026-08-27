import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../tokens.js";

test("estimateTokens: string vazia é 0", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens: ~1 token a cada 4 chars, arredondando pra cima", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("a".repeat(400)), 100);
});

test("estimateTokens: entrada não-string vira 0 (defensivo)", () => {
  assert.equal(estimateTokens(undefined as unknown as string), 0);
  assert.equal(estimateTokens(null as unknown as string), 0);
});
