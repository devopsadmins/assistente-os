/**
 * Testes HTTP REST para o agente LangGraph com tool-calling.
 *
 * Roda contra o daemon local (porta 4310).
 * Requer: daemon rodando, Ollama disponível, PostgreSQL ativo.
 *
 * Uso: node --test dist/test/langgraph-tools-rest.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";

const BASE = process.env.AOS_URL || "http://127.0.0.1:4310";
const TOKEN = process.env.AOS_TOKEN || "";

const headers: Record<string, string> = {
  "Content-Type": "application/json",
};
if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

interface ChatResponse {
  ok: boolean;
  text: string;
  provider: string;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: ChatResponse }> {
  const resp = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json() as ChatResponse };
}

async function get(path: string): Promise<{ status: number; body: { ok: boolean } }> {
  const resp = await fetch(`${BASE}${path}`, { headers });
  return { status: resp.status, body: await resp.json() as { ok: boolean } };
}

describe("LangGraph tool-calling (REST)", () => {
  it("health check", async () => {
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("langgraph tier responde sem tools", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Diga apenas: ok",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
    assert.ok(body.text.length > 0);
    assert.equal(body.provider, "langgraph");
  });

  it("langgraph com memory_search tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool memory_search para buscar por 'assistente' na memória. Resuma o que encontrou.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
    assert.ok(body.text.length > 0);
  });

  it("langgraph com memory_status tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool memory_status para verificar o status da memória desta soul.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com graph_list tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool graph_list para listar as entidades do grafo de memória.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com soul_anotar tool", async () => {
    const ts = new Date().toISOString();
    const { status, body } = await post("/souls/main/chat", {
      prompt: `Use a tool soul_anotar para anotar: "Teste de tool-calling ${ts}"`,
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com soul_licao tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool soul_licao para registrar a lição: 'Tool-calling funciona via LangGraph'",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com costs_summary tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool costs_summary para verificar os custos desta soul.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com agenda_list tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool agenda_list para listar as tarefas pendentes.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com agenda_add tool", async () => {
    const { status, body } = await post("/souls/main/chat", {
      prompt: "Use a tool agenda_add para criar uma tarefa: 'Teste LangGraph tool-calling'.",
      tier: "langgraph",
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
    assert.ok(typeof body.text === "string");
  });

  it("langgraph com memória persistente (thread)", async () => {
    const threadId = `test-thread-${Date.now()}`;

    const r1 = await post("/souls/main/chat", {
      prompt: "Lembre que o número secreto é 42.",
      tier: "langgraph",
      threadId,
    });
    assert.equal(r1.status, 200);
    assert.ok(r1.body.ok);

    const r2 = await post("/souls/main/chat", {
      prompt: "Qual é o número secreto que eu te pedi para lembrar?",
      tier: "langgraph",
      threadId,
    });
    assert.equal(r2.status, 200);
    assert.ok(r2.body.ok);
    assert.ok(r2.body.text.includes("42"), `Esperado "42" na resposta: ${r2.body.text}`);
  });

  it("langgraph nega sem token quando token obrigatório", async () => {
    const resp = await fetch(`${BASE}/souls/main/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", tier: "langgraph" }),
    });
    if (TOKEN) {
      assert.equal(resp.status, 401);
    } else {
      assert.ok(resp.status === 200 || resp.status === 401);
    }
  });

  it("langgraph com soul inexistente retorna erro", async () => {
    const { status } = await post("/souls/nao-existe/chat", {
      prompt: "Olá",
      tier: "langgraph",
    });
    assert.ok(status >= 400);
  });
});
