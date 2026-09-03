import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("stream: emite step/token/done pra um provider ollama indisponível, e a mensagem fica gravada por thread_id", async () => {
  const { home, cleanup } = await tempHome();
  // Sem Ollama real disponível neste ambiente de teste: o roteador cai pro
  // fallback local configurado; se resultar em falha de execução (código != 0),
  // o stream ainda deve completar corretamente com um evento `done` (ok:false
  // implícito, sem token de conteúdo real) — não travar, não 500. O objetivo
  // deste teste é a MECÂNICA do protocolo (step→...→done, thread_id gravado),
  // não a qualidade de uma resposta real de LLM.
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
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
    const doneEvent = events.find((e) => e.type === "done");
    assert.ok(doneEvent, "esperava um evento done ao final");

    // GET .../threads/:id/messages agora deve refletir o turno gravado com thread_id —
    // prova de que Task 3's threadId-write funciona ponta a ponta pelo endpoint real.
    const messagesRes = await fetch(`${base}/souls/soul-stream3/threads/${threadId}/messages`, { headers });
    const messages = await messagesRes.json();
    assert.ok(Array.isArray(messages) && messages.length >= 1, "esperava ao menos a mensagem do usuário gravada");
    assert.ok(messages.some((m: { role: string; content: string }) => m.role === "user" && m.content === "diga oi"));
  } finally {
    await daemon.close();
    await cleanup();
  }
});

test("stream: threads diferentes do mesmo cliente não compartilham histórico (sessão por thread)", async () => {
  const { home, cleanup } = await tempHome();
  const daemon = await startDaemon({ port: 0, home, token: ADMIN_TOKEN });
  try {
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

    assert.ok(messagesA.length >= 1);
    assert.equal(messagesB.length, 0, "thread B não deve ver a mensagem gravada só na thread A");
  } finally {
    await daemon.close();
    await cleanup();
  }
});
