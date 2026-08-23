import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIterationLimit } from "../graph/state-checkpoint.js";

// LANGGRAPH_MAX_ITERATIONS é lido de process.env no módulo, default 5 (sem env var setada no ambiente de teste).

test("checkIterationLimit: soul não pode ampliar o limite global (regressão do bug min/undefined)", () => {
  // global=5 (default sem env var). Antes da correção, maxIterations da soul
  // SUBSTITUÍA o global (`?? `), então checkIterationLimit(5, 999) retornaria
  // "continue" (5 >= 999 é falso) — a soul teria ampliado o teto de 5 para 999.
  // Com o clamp, o limite efetivo continua 5, então 5 >= 5 → "end".
  assert.equal(checkIterationLimit(5, 999), "end");
});

test("checkIterationLimit: soul mais restritiva que o global é respeitada", () => {
  assert.equal(checkIterationLimit(3, 2), "end");
  assert.equal(checkIterationLimit(1, 2), "continue");
});

test("checkIterationLimit: sem maxIterations da soul, usa o fallback global", () => {
  assert.equal(checkIterationLimit(4, undefined), "continue");
  assert.equal(checkIterationLimit(5, undefined), "end");
});
