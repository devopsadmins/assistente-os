/**
 * Testes de integração para streaming LangGraph via REST.
 *
 * Roda contra o daemon local (porta 4310).
 * Requer: daemon rodando, Ollama disponível.
 *
 * Uso: node --test dist/test/langgraph-stream.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";

const BASE = process.env.AOS_URL || "http://127.0.0.1:4310";
const TOKEN = process.env.AOS_TOKEN || "";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

async function postChat(soul: string, prompt: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/souls/${encodeURIComponent(soul)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ prompt, tier: "langgraph", ...extra }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

describe("LangGraph streaming (REST)", () => {
  it("health check", async () => {
    const res = await fetch(`${BASE}/health`, { headers: authHeaders() });
    const body = await res.json() as { ok: boolean };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  });

  it("langgraph/status retorna status para soul", async () => {
    const res = await fetch(`${BASE}/souls/main/langgraph/status`, { headers: authHeaders() });
    const body = await res.json() as { available: boolean; ollamaAvailable: boolean };
    assert.equal(res.status, 200);
    assert.equal(typeof body.available, "boolean");
    assert.equal(typeof body.ollamaAvailable, "boolean");
  });

  it("langgraph/history retorna array", async () => {
    const res = await fetch(`${BASE}/souls/main/langgraph/history`, { headers: authHeaders() });
    const body = await res.json() as { history: unknown[] };
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.history));
  });

  it("chat com tier=langgraph funciona", async () => {
    const body = await postChat("main", "Diga apenas: stream ok");
    assert.equal(body.ok, true);
    assert.equal(body.tier, "langgraph");
    assert.ok(typeof body.text === "string");
    assert.ok((body.text as string).length > 0);
  });

  it("chat com tier=local funciona", async () => {
    const body = await postChat("main", "Diga apenas: local ok", { tier: "local" });
    assert.equal(body.ok, true);
    assert.equal(body.tier, "local");
    assert.ok(typeof body.text === "string");
  });

  it("chat sem tier usa auto", async () => {
    const body = await postChat("main", "Diga apenas: auto ok", { tier: undefined });
    assert.equal(body.ok, true);
    assert.ok(typeof body.mode === "string");
  });

  it("chat com threadId mantém contexto", async () => {
    const threadId = `stream-test-${Date.now()}`;

    const r1 = await postChat("main", "Lembre que o código é 99", { threadId });
    assert.equal(r1.ok, true);

    const r2 = await postChat("main", "Qual é o código que eu te pedi para lembrar?", { threadId });
    assert.equal(r2.ok, true);
    assert.ok((r2.text as string).includes("99"), `Esperado "99" na resposta: ${r2.text}`);
  });

  it("chat com tool-call retorna toolCalls", async () => {
    const body = await postChat("main", "Use a tool memory_status para verificar o status da memória.");
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("soul inexistente retorna erro", async () => {
    const res = await fetch(`${BASE}/souls/nao-existe/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ prompt: "oi", tier: "langgraph" }),
    });
    assert.ok(res.status >= 400);
  });

  it("langgraph/status para soul inexistente", async () => {
    const res = await fetch(`${BASE}/souls/nao-existe/langgraph/status`, { headers: authHeaders() });
    assert.ok(res.status >= 400);
  });

  it("langgraph/history para soul inexistente", async () => {
    const res = await fetch(`${BASE}/souls/nao-existe/langgraph/history`, { headers: authHeaders() });
    assert.ok(res.status >= 400);
  });
});
