// packages/daemon/src/test/sse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { ServerResponse } from "node:http";
import { startSSE, writeSSEEvent, startHeartbeat } from "../routes/sse.js";

function fakeRes(): { res: ServerResponse; chunks: string[]; headers: { status?: number; headers?: Record<string, string> } } {
  const chunks: string[] = [];
  const headers: { status?: number; headers?: Record<string, string> } = {};
  const stream = new PassThrough();
  stream.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
  const res = {
    writeHead: (status: number, hdrs: Record<string, string>) => {
      headers.status = status;
      headers.headers = hdrs;
    },
    write: (chunk: string) => {
      stream.write(chunk);
      return true;
    },
    end: () => stream.end(),
  } as unknown as ServerResponse;
  return { res, chunks, headers };
}

test("startSSE: envia headers corretos pra event-stream", () => {
  const { res, headers } = fakeRes();
  startSSE(res);
  assert.equal(headers.status, 200);
  assert.equal(headers.headers?.["content-type"], "text/event-stream");
  assert.equal(headers.headers?.["cache-control"], "no-cache");
  assert.equal(headers.headers?.["connection"], "keep-alive");
});

test("writeSSEEvent: formata como 'data: <json>\\n\\n'", () => {
  const { res, chunks } = fakeRes();
  writeSSEEvent(res, { type: "token", text: "olá" });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], `data: ${JSON.stringify({ type: "token", text: "olá" })}\n\n`);
});

test("writeSSEEvent: cada tipo de evento serializa os campos certos", () => {
  const { res, chunks } = fakeRes();
  writeSSEEvent(res, { type: "step", step: "rag", message: "contexto encontrado" });
  writeSSEEvent(res, { type: "done", messageId: 42, usage: { promptTokens: 10, completionTokens: 5, source: "provider" } });
  writeSSEEvent(res, { type: "error", message: "falhou" });
  assert.equal(chunks.length, 3);
  assert.deepEqual(JSON.parse(chunks[0]!.slice("data: ".length, -2)), { type: "step", step: "rag", message: "contexto encontrado" });
  assert.deepEqual(JSON.parse(chunks[1]!.slice("data: ".length, -2)), {
    type: "done",
    messageId: 42,
    usage: { promptTokens: 10, completionTokens: 5, source: "provider" },
  });
  assert.deepEqual(JSON.parse(chunks[2]!.slice("data: ".length, -2)), { type: "error", message: "falhou" });
});

test("startHeartbeat: escreve um comentário SSE periodicamente até ser parado", async () => {
  const { res, chunks } = fakeRes();
  const stop = startHeartbeat(res, 20);
  await new Promise((resolve) => setTimeout(resolve, 65));
  stop();
  const countAfterStop = chunks.length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(chunks.length, countAfterStop, "não deve escrever mais nada depois de stop()");
  assert.ok(countAfterStop >= 2, `esperava pelo menos 2 heartbeats em 65ms com intervalo 20ms, teve ${countAfterStop}`);
  for (const c of chunks) assert.equal(c, ": ping\n\n");
});
