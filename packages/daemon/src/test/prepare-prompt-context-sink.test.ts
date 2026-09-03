// A minimal direct test of the sink injection, independent of full HTTP
// plumbing — proves the factory receives traceId and that emitStep routes
// through it (not through any hardcoded hub call) without needing a live daemon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePromptContext } from "../routes/chat.js";
import { createTestSchema } from "./pgTestHelper.js";
import { createSoul } from "@assistente-os/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("preparePromptContext: createStepSink recebe o traceId real e emitStep passa por ele", async () => {
  const testDb = await createTestSchema();
  const home = mkdtempSync(join(tmpdir(), "aos-sink-"));
  try {
    createSoul(home, "soul-sink-test", { name: "soul-sink-test" });
    const soul = { id: "soul-sink-test", dir: join(home, "souls", "soul-sink-test"), config: { name: "soul-sink-test" } };
    const received: Array<{ module: string; message: string; level?: string; traceId: string }> = [];
    let capturedTraceId: string | undefined;

    const config = { defaultMaxTurns: 10, databaseUrl: "", ollamaUrl: "http://127.0.0.1:11434" } as any;
    const req = { headers: {} } as any;
    const fakeHub = { broadcast: () => {} } as any;

    const result = await preparePromptContext({
      req,
      pool: testDb.pool,
      hub: fakeHub,
      home,
      config,
      soul: soul as any,
      prompt: "teste de sink",
      createStepSink: (traceId: string) => {
        capturedTraceId = traceId;
        return (module: string, message: string, level?: "err") => {
          received.push({ module, message, level, traceId });
        };
      },
    });

    assert.ok(result.ok, "esperava sucesso na preparação");
    assert.ok(capturedTraceId, "createStepSink deveria ter recebido um traceId");
    assert.ok(received.length > 0, "emitStep deveria ter chamado o sink pelo menos uma vez");
    for (const r of received) assert.equal(r.traceId, capturedTraceId, "todo evento deve carregar o mesmo traceId");
    if (result.ok) assert.equal(result.context.traceId, capturedTraceId, "o traceId devolvido no contexto deve ser o mesmo passado ao sink");
  } finally {
    await testDb.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});
