import { test } from "node:test";
import assert from "node:assert/strict";
import { recordRouterSelection, getUsageSummary } from "../router.js";
import { createTestSchema } from "./pgTestHelper.js";
import type { Soul } from "../souls.js";

const fakeSoul = (id: string): Soul =>
  ({ id, dir: `/tmp/${id}`, config: {} } as unknown as Soul);

test("getUsageSummary: ignora linhas de sonda (status != 'executed') e soma só as execuções reais", async () => {
  const db = await createTestSchema();
  try {
    // Linha de sonda que route() grava — 0 tokens, status 'ok'. NÃO deve entrar na agregação.
    await db.pool.query(
      `INSERT INTO router_history (ts, soul, tier, provider, model, status)
       VALUES (now(), 'main', 'local', 'ollama', 'ollama/x', 'ok')`,
    );
    // Execução real registrada pós-inferência.
    await recordRouterSelection(db.pool, {
      soul: fakeSoul("main"),
      target: { tier: "local", provider: "ollama", model: "ollama/qwen2.5-coder:3b" },
      reason: "modo fast",
      status: "executed",
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      modelUsed: "qwen2.5-coder:3b",
      executionMode: "fast",
    });

    const rows = await getUsageSummary(db.pool, { soul: "main" });
    const row = rows[0];
    assert.ok(row, "deve haver uma linha de resumo para 'main'");
    assert.equal(Number(row.total_calls), 1);
    assert.equal(Number(row.total_prompt_tokens), 120);
    assert.equal(Number(row.total_completion_tokens), 45);
    assert.equal(Number(row.total_tokens), 165);
    assert.equal(row.by_mode.fast?.calls, 1);
    assert.equal(row.by_mode.fast?.tokens, 165);
    assert.equal(row.by_model["qwen2.5-coder:3b"]?.tokens, 165);
  } finally {
    await db.cleanup();
  }
});

test("getUsageSummary: agrega múltiplas execuções por mode e model", async () => {
  const db = await createTestSchema();
  try {
    const base = {
      soul: fakeSoul("dev"),
      reason: "x",
      status: "executed" as const,
    };
    await recordRouterSelection(db.pool, {
      ...base,
      target: { tier: "local", provider: "ollama", model: "m" },
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      modelUsed: "local-model",
      executionMode: "fast",
    });
    await recordRouterSelection(db.pool, {
      ...base,
      target: { tier: "zen", provider: "zen", model: "zen" },
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      modelUsed: "zen-model",
      executionMode: "pro",
    });

    const rows = await getUsageSummary(db.pool, { soul: "dev" });
    const row = rows[0];
    assert.ok(row);
    assert.equal(Number(row.total_calls), 2);
    assert.equal(Number(row.total_tokens), 220);
    assert.equal(row.by_mode.fast?.tokens, 20);
    assert.equal(row.by_mode.pro?.tokens, 200);
    assert.equal(row.by_model["local-model"]?.calls, 1);
    assert.equal(row.by_model["zen-model"]?.calls, 1);
  } finally {
    await db.cleanup();
  }
});
