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
import { parseGoldenJsonl, runRagEval, runFaithfulnessEval, formatRagEvalMetrics } from "../rag-eval.js";
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

test("runRagEval: corpus toy — positivos acertam no rank 1; adversariais declinam (E12)", async () => {
  const { docs, cases } = parseGoldenJsonl(readFileSync(SAMPLE, "utf8"));
  assert.ok(docs.length >= 5 && cases.length >= 8);
  const positives = cases.filter((c) => !c.adversarial);
  const adversarials = cases.filter((c) => c.adversarial);
  assert.ok(adversarials.length >= 2, "a fixture tem casos adversariais");

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
    assert.equal(m.n, positives.length, "hit@k é só sobre os positivos");
    assert.equal(m.hitAt1, 1, `esperava hit@1=1\n${formatRagEvalMetrics(m)}`);
    assert.equal(m.mrr, 1);
    assert.equal(m.recallAt5, 1);
    assert.deepEqual(m.failures, []);

    assert.equal(m.nAdversarial, adversarials.length);
    assert.equal(m.adversarialRefusalRate, 1, `adversariais fora de escopo → recuperação declina\n${formatRagEvalMetrics(m)}`);
    assert.deepEqual(m.adversarialLeaks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("runFaithfulnessEval (E12b): pontua a resposta gerada contra as fontes recuperadas", async () => {
  const { docs, cases } = parseGoldenJsonl(readFileSync(SAMPLE, "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "aos-faith-"));
  const testDb = await createTestSchema();
  try {
    for (const d of docs) {
      const p = join(dir, "docs", d.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, d.body + "\n");
    }
    await indexDirectory(testDb.pool, "__eval__", join(dir, "docs"), new LiteralEmbedder());

    // generate stub: eco fiel do 1º snippet p/ metade dos casos, alucinação p/ o resto.
    let i = 0;
    const generate = async (snippets: string[]) =>
      i++ % 2 === 0
        ? snippets[0] ?? ""
        : "Na verdade o sistema exige aprovacao biometrica presencial do diretor financeiro antes de qualquer deploy.";

    const f = await runFaithfulnessEval(testDb.pool, cases, generate, { k: 5, minSupported: 0.7 });
    assert.ok(f.evaluated >= 4, `esperava vários casos avaliados, veio ${f.evaluated}`);
    assert.ok(f.meanSupported > 0 && f.meanSupported < 1, `meanSupported=${f.meanSupported}`);
    assert.ok(f.low.length >= 1, "as respostas alucinadas caem abaixo do piso");
    assert.ok(f.low[0]!.unsupported.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
