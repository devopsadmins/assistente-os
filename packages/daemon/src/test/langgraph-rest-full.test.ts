/**
 * Testes HTTP REST completos para o agente LangGraph com mode routing.
 *
 * Roda contra o daemon local (porta 4310).
 * Requer: daemon rodando, Ollama disponível, PostgreSQL ativo.
 *
 * Uso: node --test dist/test/langgraph-rest-full.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";

const BASE = process.env.AOS_URL || "http://127.0.0.1:4310";
const TOKEN = process.env.AOS_TOKEN || "";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
};
if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json() as Record<string, unknown> };
}

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await fetch(`${BASE}${path}`, { headers });
  return { status: resp.status, body: await resp.json() as Record<string, unknown> };
}

describe("LangGraph REST completo", () => {
  it("health check", async () => {
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("langgraph status endpoint", async () => {
    const { status, body } = await get("/souls/main/langgraph/status");
    assert.equal(status, 200);
    assert.equal(typeof body.available, "boolean");
    assert.equal(typeof body.ollamaAvailable, "boolean");
    assert.ok(Array.isArray(body.tools));
  });

  it("langgraph history endpoint", async () => {
    const { status, body } = await get("/souls/main/langgraph/history");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.history));
  });

  it("chat sem mode definido usa auto", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Diga apenas: ok",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.mode === "string");
  });

  it("chat com tier=langgraph força langgraph", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Diga apenas: langgraph ok",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tier, "langgraph");
  });

  it("chat com tier=local usa local", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Diga apenas: local ok",
      tier: "local",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tier, "local");
  });

  it("chat com mode=auto respeita auto", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Diga apenas: auto ok",
      tier: "local",
      mode: "auto",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("langgraph com memory_search tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool memory_search para buscar por 'assistente' na memória. Resuma.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com memory_status tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool memory_status para verificar o status da memória.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com graph_list tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool graph_list para listar as entidades do grafo.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com soul_anotar tool", async () => {
    const ts = new Date().toISOString();
    const { status, body } = await post("/souls/main/chat", {
      prompt: `Use a tool soul_anotar para anotar: "REST full test ${ts}"`,
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com soul_licao tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool soul_licao para registrar a lição: 'REST full test funciona'",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com costs_summary tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool costs_summary para verificar os custos.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com agenda_list tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool agenda_list para listar tarefas pendentes.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com agenda_add tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool agenda_add para criar tarefa: 'REST full test item'.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com memória persistente (thread)", async () => {
    const threadId = `rest-full-${Date.now()}`;

    const r1 = await post("/souls/main/chat", {
      prompt: "Lembre que o número secreto é 77.",
      tier: "langgraph",
      threadId,
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, true);

    const r2 = await post("/souls/main/chat", {
      prompt: "Qual é o número secreto?",
      tier: "langgraph",
      threadId,
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.ok, true);
    assert.ok((r2.body.text as string).includes("77"), `Esperado "77": ${r2.body.text}`);
  });

  it("soul inexistente retorna erro", async () => {
    const { status } = await post("/souls/nao-existe/chat", {
      prompt: "Oi",
      tier: "langgraph",
    });
    assert.ok(status >= 400);
  });

  it("langgraph status para soul inexistente", async () => {
    const { status } = await get("/souls/nao-existe/langgraph/status");
    assert.ok(status >= 400);
  });

  it("langgraph history para soul inexistente", async () => {
    const { status } = await get("/souls/nao-existe/langgraph/history");
    assert.ok(status >= 400);
  });
});
