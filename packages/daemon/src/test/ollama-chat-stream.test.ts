import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ollamaChatStream } from "../routes/chat.js";

function startFakeOllama(chunks: object[], opts?: { statusCode?: number }): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (opts?.statusCode && opts.statusCode >= 400) {
        res.writeHead(opts.statusCode);
        res.end("erro simulado");
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      let i = 0;
      const sendNext = () => {
        if (i >= chunks.length) {
          res.end();
          return;
        }
        res.write(JSON.stringify(chunks[i]) + "\n");
        i++;
        setTimeout(sendNext, 5);
      };
      sendNext();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("ollamaChatStream: encaminha cada token via onToken e acumula o texto final", async () => {
  const fake = await startFakeOllama([
    { message: { content: "Olá" } },
    { message: { content: ", " } },
    { message: { content: "mundo!" } },
    { done: true, prompt_eval_count: 12, eval_count: 4 },
  ]);
  try {
    const tokens: string[] = [];
    const result = await ollamaChatStream(fake.url, { model: "test-model", messages: [{ role: "user", content: "oi" }] }, 5000, (t) =>
      tokens.push(t),
    );
    assert.deepEqual(tokens, ["Olá", ", ", "mundo!"]);
    assert.equal(result.stdout, "Olá, mundo!");
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.usage?.promptTokens, 12);
    assert.equal(result.usage?.completionTokens, 4);
    assert.equal(result.usage?.source, "provider");
  } finally {
    await fake.close();
  }
});

test("ollamaChatStream: HTTP de erro devolve code!=0 sem lançar", async () => {
  const fake = await startFakeOllama([], { statusCode: 500 });
  try {
    const result = await ollamaChatStream(fake.url, { model: "x", messages: [] }, 5000, () => {});
    assert.notEqual(result.code, 0);
    assert.equal(result.timedOut, false);
  } finally {
    await fake.close();
  }
});

test("ollamaChatStream: timeout devolve timedOut=true", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    // nunca escreve nada nem fecha — força o timeout.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const result = await ollamaChatStream(`http://127.0.0.1:${port}`, { model: "x", messages: [] }, 50, () => {});
    assert.equal(result.timedOut, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
