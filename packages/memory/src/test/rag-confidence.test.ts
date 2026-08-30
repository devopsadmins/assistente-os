import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRagConfidence, ragMinConfidence } from "../rag-confidence.js";
import type { RagChunk } from "../rag-chain.js";

const chunk = (score: number, indexedAt?: string | null): RagChunk => ({
  doc: "d::0",
  path: "a.md",
  score,
  method: "semantic",
  snippet: "x",
  indexedAt: indexedAt ?? null,
});

const NOW = Date.parse("2026-08-29T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

test("computeRagConfidence: sem fontes → score 0 / low", () => {
  const c = computeRagConfidence([], { now: NOW });
  assert.equal(c.score, 0);
  assert.equal(c.level, "low");
  assert.equal(c.signals.freshnessDays, null);
});

test("computeRagConfidence: top-score é a âncora; 3 fontes fortes e frescas → high", () => {
  const c = computeRagConfidence(
    [chunk(0.92, daysAgo(1)), chunk(0.8, daysAgo(2)), chunk(0.7, daysAgo(3))],
    { now: NOW, staleDays: 365 },
  );
  assert.equal(c.signals.topScore, 0.92);
  assert.equal(c.signals.concord, 1, "3 fontes ≥ 0.5 = concordância cheia");
  assert.ok(c.signals.freshnessPenalty < 0.02);
  assert.ok(c.score >= 0.7 && c.level === "high", `score=${c.score}`);
});

test("computeRagConfidence: 1 fonte só, score médio → concord baixa puxa pra baixo", () => {
  const c = computeRagConfidence([chunk(0.6, daysAgo(10))], { now: NOW });
  assert.equal(c.signals.concord, 1 / 3);
  assert.ok(c.score < 0.6, `score=${c.score}`);
});

test("computeRagConfidence: índice velho aplica penalidade de freshness", () => {
  const fresco = computeRagConfidence([chunk(0.9, daysAgo(1)), chunk(0.8, daysAgo(1))], { now: NOW, staleDays: 100 });
  const velho = computeRagConfidence([chunk(0.9, daysAgo(200)), chunk(0.8, daysAgo(200))], { now: NOW, staleDays: 100 });
  assert.equal(velho.signals.freshnessPenalty, 1, "200d > staleDays 100 → penalidade satura");
  assert.ok(velho.score < fresco.score);
});

test("computeRagConfidence: sem indexedAt → freshnessPenalty 0 (não penaliza o que não dá pra datar)", () => {
  const c = computeRagConfidence([chunk(0.85, null), chunk(0.7, null)], { now: NOW });
  assert.equal(c.signals.freshnessDays, null);
  assert.equal(c.signals.freshnessPenalty, 0);
});

test("computeRagConfidence: concordFloor filtra fontes fracas", () => {
  const c = computeRagConfidence([chunk(0.9), chunk(0.3), chunk(0.2)], { now: NOW, concordFloor: 0.5, concordTarget: 3 });
  assert.equal(c.signals.concord, 1 / 3, "só 1 das 3 passa do piso 0.5");
});

test("ragMinConfidence: default 0 (desligado); lê AOS_RAG_MIN_CONFIDENCE clampado a 1", () => {
  const prev = process.env.AOS_RAG_MIN_CONFIDENCE;
  try {
    delete process.env.AOS_RAG_MIN_CONFIDENCE;
    assert.equal(ragMinConfidence(), 0);
    process.env.AOS_RAG_MIN_CONFIDENCE = "0.55";
    assert.equal(ragMinConfidence(), 0.55);
    process.env.AOS_RAG_MIN_CONFIDENCE = "9";
    assert.equal(ragMinConfidence(), 1);
  } finally {
    if (prev === undefined) delete process.env.AOS_RAG_MIN_CONFIDENCE;
    else process.env.AOS_RAG_MIN_CONFIDENCE = prev;
  }
});
