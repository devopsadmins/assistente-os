import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentDocumentText } from "../indexer.js";

test("segmentDocumentText: texto vazio devolve lista vazia", () => {
  assert.deepEqual(segmentDocumentText(""), []);
});

test("segmentDocumentText: texto pequeno vira um segmento só", () => {
  const text = "Parágrafo curto.\n\nOutro parágrafo curto.";
  const segments = segmentDocumentText(text);
  assert.equal(segments.length, 1);
});

test("segmentDocumentText: documento grande vira múltiplos segmentos, nenhum passando muito do limite", () => {
  const block = "x".repeat(500);
  const text = Array.from({ length: 20 }, () => block).join("\n\n");
  const segments = segmentDocumentText(text, 2000);
  assert.ok(segments.length > 1, "documento de ~10000 chars com limite de 2000 deveria virar vários segmentos");
  for (const seg of segments) {
    assert.ok(seg.length <= 2000 + block.length, `segmento não deveria passar muito do limite: ${seg.length}`);
  }
});

test("segmentDocumentText: com maxChars menor que um bloco, cada bloco vira seu próprio segmento (sem perder conteúdo)", () => {
  const blocks = ["um", "dois", "tres"];
  const text = blocks.join("\n\n");
  const segments = segmentDocumentText(text, 3);
  assert.deepEqual(segments, blocks);
});
