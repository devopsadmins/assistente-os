/**
 * Epic C — runner de avaliação de recuperação do RAG.
 *
 * Determinístico: monta o corpus toy da fixture `eval/rag-golden.sample.jsonl`,
 * indexa com LiteralEmbedder (busca cai no ILIKE literal) e confere as métricas
 * num corpus controlado onde todo caso acerta no rank 1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LiteralEmbedder } from "../embedders.js";
import { indexDirectory } from "../indexer.js";
import { parseGoldenJsonl, runRagEval, formatRagEvalMetrics } from "../rag-eval.js";
import { createTestSchema } from "./pgTestHelper.js";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval", "rag-golden.sample.jsonl");

test("parseGoldenJsonl: separa docs de casos, ignora comentários/linhas em branco", () => {
  const { docs, cases } = parseGoldenJsonl(
    [
      "// comentário",
      "",
      '{"kind":"doc","path":"a.md","body":"corpo"}',
      '{"kind":"case","id":"c1","soul":"s","query":"q","expect_path_substr":["a.md"]}',
    ].join("\n"),
  );
  assert.equal(docs.length, 1);
  assert.equal(cases.length, 1);
  assert.equal(cases[0]!.id, "c1");
});

test("parseGoldenJsonl: caso malformado lança", () => {
  assert.throws(() => parseGoldenJsonl('{"kind":"case","id":"x"}'));
});

test("runRagEval: no corpus toy da fixture, todo caso acerta no rank 1", async () => {
  const { docs, cases } = parseGoldenJsonl(readFileSync(SAMPLE, "utf8"));
  assert.ok(docs.length >= 5 && cases.length >= 6);

  const dir = mkdtempSync(join(tmpdir(), "aos-rageval-"));
  const testDb = await createTestSchema();
  try {
    for (const d of docs) {
      const p = join(dir, "docs", d.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, d.body + "\n");
    }
    await indexDirectory(testDb.pool, "__eval__", join(dir, "docs"), new LiteralEmbedder());

    const m = await runRagEval(testDb.pool, cases, { k: 5 });
    assert.equal(m.n, cases.length);
    assert.equal(m.hitAt1, 1, `esperava hit@1=1, obteve ${m.hitAt1}\n${formatRagEvalMetrics(m)}`);
    assert.equal(m.mrr, 1);
    assert.equal(m.recallAt5, 1);
    assert.deepEqual(m.failures, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
