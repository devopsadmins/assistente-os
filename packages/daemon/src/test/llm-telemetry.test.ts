/**
 * Epic B — telemetria unificada de chamadas LLM fora do chat.
 *
 * Antes só `routes/chat.ts` gravava cost_calls + execution_logs +
 * router_history(status='executed'). Agora `recordLlmCall` fecha isso e os
 * pipelines (email-ingest, meeting-ingest, spec-grill, entity-extraction) o
 * chamam com os tokens reais do Ollama (`prompt_eval_count`/`eval_count`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSoul, getPool, loadConfig, getUsageSummary } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";
import { recordLlmCall, ollamaUsage } from "../observability/record-llm-call.js";
import { emailIngestPipeline } from "../pipelines/email-ingest.js";

test("ollamaUsage: usa prompt_eval_count/eval_count (provider) ou cai para estimate", () => {
  const withCounts = ollamaUsage({ prompt_eval_count: 30, eval_count: 12 }, Date.now() - 40, "abc", "def");
  assert.equal(withCounts.source, "provider");
  assert.equal(withCounts.promptTokens, 30);
  assert.equal(withCounts.completionTokens, 12);
  assert.ok(withCounts.latencyMs >= 0);

  const noCounts = ollamaUsage({}, Date.now(), "x".repeat(40), "y".repeat(8));
  assert.equal(noCounts.source, "estimate");
  assert.equal(noCounts.promptTokens, 10); // ceil(40/4)
  assert.equal(noCounts.completionTokens, 2); // ceil(8/4)
});

test("recordLlmCall grava cost_calls + execution_logs + router_history(executed)", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-llmtel-"));
  createSoul(home, "main", { name: "main" });
  const db = await tempDaemonHome(home);
  try {
    const pool = getPool(loadConfig({ home }).databaseUrl);
    await recordLlmCall({
      pool,
      soul: { id: "main" },
      route: "email-ingest",
      provider: "ollama",
      model: "qwen2.5-coder:3b",
      promptTokens: 41,
      completionTokens: 17,
      latencyMs: 1234,
      source: "provider",
    });

    const cc = await pool.query(
      "SELECT provider, model, input_tokens, output_tokens, note FROM cost_calls WHERE soul='main'",
    );
    assert.equal(cc.rowCount, 1);
    assert.equal(Number(cc.rows[0].input_tokens), 41);
    assert.equal(Number(cc.rows[0].output_tokens), 17);
    assert.match(cc.rows[0].note, /route=email-ingest/);

    const el = await pool.query(
      "SELECT kind, tokens_in, tokens_out FROM execution_logs WHERE soul='main'",
    );
    assert.equal(el.rowCount, 1);
    assert.equal(el.rows[0].kind, "email-ingest");
    assert.equal(Number(el.rows[0].tokens_in), 41);

    const rh = await pool.query(
      "SELECT status, prompt_tokens, completion_tokens, total_tokens, latency_ms, execution_mode FROM router_history WHERE soul='main' AND status='executed'",
    );
    assert.equal(rh.rowCount, 1);
    assert.equal(Number(rh.rows[0].prompt_tokens), 41);
    assert.equal(Number(rh.rows[0].total_tokens), 58);
    assert.equal(Number(rh.rows[0].latency_ms), 1234);
    assert.equal(rh.rows[0].execution_mode, "email-ingest");

    // getUsageSummary conta a linha do pipeline (status='executed')
    const usage = await getUsageSummary(pool, { soul: "main" });
    assert.equal(Number(usage[0]?.total_tokens), 58);
    assert.equal(Number(usage[0]?.by_mode["email-ingest"]?.tokens), 58);
  } finally {
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test("emailIngestPipeline: grava telemetria da extração LLM", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-llmtel-email-"));
  createSoul(home, "main", { name: "main" });
  const db = await tempDaemonHome(home);
  const prevHome = process.env.ASSISTENTE_OS_HOME;
  process.env.ASSISTENTE_OS_HOME = home;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        message: { content: JSON.stringify({ topicos: ["t1"], secoes: [], decisoes: [], acoes: [], lições: [] }) },
        prompt_eval_count: 55,
        eval_count: 9,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    await emailIngestPipeline("Assunto: teste\n\nCorpo do e-mail para extração.", "main");
    const pool = getPool(loadConfig({ home }).databaseUrl);
    const el = await pool.query(
      "SELECT kind, tokens_in, tokens_out FROM execution_logs WHERE soul='main' AND kind='email-ingest'",
    );
    assert.equal(el.rowCount, 1);
    assert.equal(el.rows[0].tokens_in, 55);
    assert.equal(el.rows[0].tokens_out, 9);
    const cc = await pool.query("SELECT note FROM cost_calls WHERE soul='main'");
    assert.match(cc.rows[0].note, /route=email-ingest/);
  } finally {
    globalThis.fetch = realFetch;
    if (prevHome === undefined) delete process.env.ASSISTENTE_OS_HOME;
    else process.env.ASSISTENTE_OS_HOME = prevHome;
    await db.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
