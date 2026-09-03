import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { startDaemon } from "../server.js";
import { createSoul } from "@assistente-os/core";
import { tempDaemonHome } from "./pgTestHelper.js";

const ADMIN_TOKEN = "admin-stream-test-token";

async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = mkdtempSync(join(tmpdir(), "aos-stream-"));
  const db = await tempDaemonHome(home);
  return {
    home,
    async cleanup() {
      await db.cleanup();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function signup(base: string, email: string): Promise<{ accountId: number; token: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "senha-forte-123" }),
  });
  const body = (await res.json()) as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  return { accountId: body.account.id, token: body.token };
}

async function createThreadViaApi(base: string, soulId: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`${base}/souls/${soulId}/threads`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ title: "teste" }),
  });
  const body = (await res.json()) as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.id;
}

/** Lê um response SSE inteiro e devolve os StreamEvents parseados, na ordem. */
async function readAllSSEEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) {
        events.push(JSON.parse(chunk.slice("data: ".length)));
      }
      // linhas ": ping" (heartbeat) são ignoradas de propósito — não são "data:"
    }
  }
  return events;
}

/**
 * Fake do Ollama real (mesmo padrão de ollama-chat-stream.test.ts — um
 * `http.createServer` de verdade, não um mock): serve GET /api/tags (o probe
 * de disponibilidade que `routeFromPrompt` usa pra escolher o tier "local")
 * e POST /api/chat, que devolve NDJSON linha a linha (streaming de verdade,
 * um `res.write()` por chunk) ou um erro HTTP, conforme `opts`.
 *
 * F4 da revisão da task 5: os testes de sucesso do endpoint dependiam
 * silenciosamente de um Ollama real acessível em localhost:11434 — passavam
 * neste ambiente (que tem o container `memoria-ollama`) mas falhariam em
 * qualquer CI sem Ollama, que é o gate de merge real deste projeto (PR+CI).
 * Apontar `OLLAMA_URL` pra este fake elimina a dependência externa.
 */
function startFakeOllama(opts: { chatChunks?: object[]; chatStatusCode?: number } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/chat") {
        if (opts.chatStatusCode && opts.chatStatusCode >= 400) {
          res.writeHead(opts.chatStatusCode);
          res.end("erro simulado");
          return;
        }
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const chunks = opts.chatChunks ?? [];
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
        return;
      }
      res.writeHead(404);
      res.end();
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

/** Aponta OLLAMA_URL pro fake pela duração de `fn`, restaurando o valor original depois (mesmo padrão de kill-switch.test.ts / mission-runner.test.ts). */
async function withFakeOllama<T>(fake: { url: string }, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = fake.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prev;
  }
}

test("stream: soul inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const res = await fetch(`${base}/souls/nao-existe/threads/1/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), false);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: thread inexistente devolve 404 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream1@exemplo.com");
    createSoul(home, "soul-stream1", { name: "soul-stream1", ownerAccountId: alice.accountId });
    const res = await fetch(`${base}/souls/soul-stream1/threads/999999/messages/stream`, {
      method: "POST",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    assert.equal(res.status, 404);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: sem prompt devolve 400 (não abre SSE)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    const base = `http://127.0.0.1:${daemon.port}`;
    const alice = await signup(base, "alice-stream2@exemplo.com");
    createSoul(home, "soul-stream2", { name: "soul-stream2", ownerAccountId: alice.accountId });
    const headers = { authorization: `Bearer ${alice.token}` };
    const threadId = await createThreadViaApi(base, "soul-stream2", headers);
    const res = await fetch(`${base}/souls/soul-stream2/threads/${threadId}/messages/stream`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: emite step/token/done contra um Ollama fake (determinístico, sem rede externa), e a mensagem fica gravada por thread_id", async () => {
  const { home, cleanup } = await tempHome();
  const fake = await startFakeOllama({
    chatChunks: [
      { message: { content: "olá" } },
      { message: { content: ", " } },
      { message: { content: "mundo!" } },
      { done: true, prompt_eval_count: 12, eval_count: 4 },
    ],
  });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream3@exemplo.com");
      createSoul(home, "soul-stream3", { name: "soul-stream3", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream3", headers);

      const res = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "diga oi" }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

      const events = await readAllSSEEvents(res);
      assert.ok(events.length > 0, "esperava pelo menos um evento");
      assert.ok(events.some((e) => e.type === "step"), "esperava ao menos um evento de step (preparação)");
      assert.ok(events.some((e) => e.type === "token"), "esperava eventos de token (streaming progressivo do fake)");
      const doneEvent = events.find((e) => e.type === "done") as { messageId?: number } | undefined;
      assert.ok(doneEvent, "esperava um evento done ao final");
      assert.equal(events.at(-1)?.type, "done", "done deve ser o último evento");

      // GET .../threads/:id/messages agora deve refletir o turno gravado com thread_id —
      // prova de que Task 3's threadId-write funciona ponta a ponta pelo endpoint real.
      const messagesRes = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as Array<{ id: number; role: string; content: string }>;
      assert.equal(messages.length, 2, "esperava as duas mensagens do turno (user + assistant)");
      assert.ok(messages.some((m) => m.role === "user" && m.content === "diga oi"));
      const assistantMsg = messages.find((m) => m.role === "assistant");
      assert.ok(assistantMsg, "esperava a resposta do assistente gravada");
      assert.equal(assistantMsg!.content, "olá, mundo!");
      assert.equal(doneEvent!.messageId, assistantMsg!.id, "done.messageId deve bater com o id da linha do assistente");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: provider falha no meio (HTTP 500 do Ollama fake) → emite {type:error}, sem done, sem gravar nenhuma linha", async () => {
  const { home, cleanup } = await tempHome();
  // /api/tags responde ok (o router escolhe o tier "ollama"); /api/chat falha
  // com 500 — deterministicamente, sem depender de timeout de rede nenhum.
  const fake = await startFakeOllama({ chatStatusCode: 500 });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream-fail@exemplo.com");
      createSoul(home, "soul-stream-fail", { name: "soul-stream-fail", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadId = await createThreadViaApi(base, "soul-stream-fail", headers);

      const res = await fetch(`${base}/souls/soul-stream-fail/threads/${threadId}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "diga oi" }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));

      const events = await readAllSSEEvents(res);
      assert.ok(
        events.some((e) => e.type === "error"),
        "esperava um evento {type:'error'} quando o provider falha",
      );
      assert.ok(
        !events.some((e) => e.type === "done"),
        "não deveria haver 'done' quando a execução falhou",
      );

      const messagesRes = await fetch(`${base}/souls/soul-stream-fail/threads/${threadId}/messages`, { headers });
      const messages = (await messagesRes.json()) as unknown[];
      assert.equal(messages.length, 0, "nenhuma linha (nem a do usuário) deve ser gravada quando a execução falha");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});

test("stream: threads diferentes do mesmo cliente não compartilham histórico (sessão por thread)", async () => {
  const { home, cleanup } = await tempHome();
  const fake = await startFakeOllama({
    chatChunks: [{ message: { content: "ok" } }, { done: true, prompt_eval_count: 1, eval_count: 1 }],
  });
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
    await withFakeOllama(fake, async () => {
      const base = `http://127.0.0.1:${daemon.port}`;
      const alice = await signup(base, "alice-stream4@exemplo.com");
      createSoul(home, "soul-stream4", { name: "soul-stream4", ownerAccountId: alice.accountId });
      const headers = { authorization: `Bearer ${alice.token}` };
      const threadA = await createThreadViaApi(base, "soul-stream4", headers);
      const threadB = await createThreadViaApi(base, "soul-stream4", headers);

      await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages/stream`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "mensagem só da thread A" }),
      }).then((r) => readAllSSEEvents(r));

      const messagesA = (await fetch(`${base}/souls/soul-stream4/threads/${threadA}/messages`, { headers }).then((r) => r.json())) as any[];
      const messagesB = (await fetch(`${base}/souls/soul-stream4/threads/${threadB}/messages`, { headers }).then((r) => r.json())) as any[];

      assert.equal(messagesA.length, 2, "thread A deve ter as duas linhas do turno (user + assistant)");
      assert.equal(messagesB.length, 0, "thread B não deve ver a mensagem gravada só na thread A");
    });
  } finally {
    await daemon.close();
    await cleanup();
    await fake.close();
  }
});
