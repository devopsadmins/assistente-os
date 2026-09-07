import { test } from "node:test";
import assert from "node:assert/strict";
import { calcCost, type ModelPrice } from "../pricing.js";

test("calcCost: ollama é sempre 0, mesmo com muitos tokens", () => {
  assert.equal(calcCost("ollama", "qualquer-modelo", 1_000_000, 1_000_000), 0);
});

test("calcCost: zen nemotron-3-ultra-free é 0 (free tier real)", () => {
  assert.equal(calcCost("zen", "nemotron-3-ultra-free", 10_000, 10_000), 0);
});

test("calcCost: provider/modelo desconhecido cai pra 0 sem lançar", () => {
  assert.equal(calcCost("openai", "gpt-99", 1000, 1000), 0);
});

test("calcCost: aritmética correta com tabela fabricada (não é preço comercial real)", () => {
  const fakeTable: Record<string, ModelPrice> = {
    "acme:modelo-fake": { inputPer1M: 10, outputPer1M: 30 },
  };
  const cost = calcCost("acme", "modelo-fake", 500_000, 200_000, fakeTable);
  assert.equal(cost, 5 + 6);
});

test("calcCost: zero tokens dá custo zero mesmo com preço não-zero", () => {
  const fakeTable: Record<string, ModelPrice> = {
    "acme:modelo-fake": { inputPer1M: 10, outputPer1M: 30 },
  };
  assert.equal(calcCost("acme", "modelo-fake", 0, 0, fakeTable), 0);
});
