import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentDocumentText, reciprocalRankFusion } from "../indexer.js";

function row(docKey: string) {
  return { docKey, path: `${docKey}.md`, title: null, body: "corpo", updatedAt: null };
}

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

test("reciprocalRankFusion: doc no topo das duas listas fica em primeiro", () => {
  const fused = reciprocalRankFusion([row("a"), row("b")], [row("a"), row("c")], 60, 5);
  assert.equal(fused[0]?.docKey, "a");
  assert.ok(fused.every((r) => r.method === "hybrid"));
});

test("reciprocalRankFusion: doc só numa lista ainda aparece no resultado", () => {
  const fused = reciprocalRankFusion([row("a")], [row("b")], 60, 5);
  const keys = fused.map((r) => r.docKey).sort();
  assert.deepEqual(keys, ["a", "b"]);
});

test("reciprocalRankFusion: empate nas duas listas soma as contribuições", () => {
  const fused = reciprocalRankFusion([row("a"), row("b")], [row("b"), row("a")], 60, 5);
  const scoreA = fused.find((r) => r.docKey === "a")!.score;
  const scoreB = fused.find((r) => r.docKey === "b")!.score;
  assert.ok(Math.abs(scoreA - scoreB) < 1e-9, "a e b deveriam empatar (1º numa lista, 2º na outra)");
});

test("reciprocalRankFusion: respeita o limit mesmo com união maior", () => {
  const fused = reciprocalRankFusion([row("a"), row("b"), row("c")], [row("d"), row("e")], 60, 2);
  assert.equal(fused.length, 2);
});
