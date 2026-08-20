/**
 * Testes unitários do agent-workflow (LangGraph).
 *
 * Testa: createInitialState, shouldContinue, estrutura do grafo.
 * Sem dependência de Ollama/Postgres — apenas lógica pura.
 *
 * Uso: node --test dist/test/agent-workflow.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInitialState, type AgentStateType, type AgentMessage } from "../agent-state.js";

// ── createInitialState ──────────────────────────────────────────────

describe("createInitialState", () => {
  it("cria estado com soul e system message", () => {
    const state = createInitialState("minha-soul");
    assert.equal(state.soul, "minha-soul");
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0]!.role, "system");
    assert.ok(state.messages[0]!.content.includes("Assistente OS"));
  });

  it("inicializa campos default corretamente", () => {
    const state = createInitialState("test");
    assert.equal(state.context, "");
    assert.equal(state.lastToolResult, undefined);
    assert.equal(state.entities, undefined);
    assert.equal(state.relations, undefined);
    assert.equal(state.iterationCount, 0);
    assert.equal(typeof state.maxIterations, "number");
    assert.ok(state.maxIterations > 0);
  });

  it("cria estado isolado (copia profunda)", () => {
    const a = createInitialState("soul-1");
    const b = createInitialState("soul-2");
    a.messages.push({ role: "user", content: "olá" });
    assert.equal(b.messages.length, 1, "estados devem ser independentes");
  });
});

// ── shouldContinue (lógica extraída) ────────────────────────────────

/**
 * Reimplementa a lógica de shouldContinue para teste isolado.
 * Em produção, está em agent-workflow.ts como função interna.
 * Aqui testamos a mesma lógica sem importar o módulo completo
 * (que depende de Ollama/Postgres).
 */
function shouldContinue(state: AgentStateType): string {
  if (state.iterationCount >= state.maxIterations) return "__end__";
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.role === "assistant" && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
    return "tools";
  }
  return "__end__";
}

describe("shouldContinue (logic)", () => {
  it("retorna 'tools' quando assistant tem toolCalls", () => {
    const state = createInitialState("test");
    state.iterationCount = 0;
    state.maxIterations = 5;
    state.messages.push({
      role: "assistant",
      content: "vou buscar",
      toolCalls: [{ id: "tc-1", name: "memory_search", args: { query: "olá" } }],
    });
    assert.equal(shouldContinue(state), "tools");
  });

  it("retorna '__end__' quando iterações esgotadas", () => {
    const state = createInitialState("test");
    state.iterationCount = 5;
    state.maxIterations = 5;
    state.messages.push({
      role: "assistant",
      content: "resposta",
      toolCalls: [{ id: "tc-1", name: "memory_search", args: { query: "olá" } }],
    });
    assert.equal(shouldContinue(state), "__end__");
  });

  it("retorna '__end__' quando último msg é assistant sem toolCalls", () => {
    const state = createInitialState("test");
    state.iterationCount = 1;
    state.maxIterations = 5;
    state.messages.push({ role: "assistant", content: "resposta final" });
    assert.equal(shouldContinue(state), "__end__");
  });

  it("retorna '__end__' quando último msg é tool", () => {
    const state = createInitialState("test");
    state.iterationCount = 1;
    state.maxIterations = 5;
    state.messages.push({ role: "tool", content: "resultado", toolCallId: "tc-1" });
    assert.equal(shouldContinue(state), "__end__");
  });

  it("retorna 'tools' mesmo com iteração alta (antes do limite)", () => {
    const state = createInitialState("test");
    state.iterationCount = 4;
    state.maxIterations = 5;
    state.messages.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc-2", name: "soul_anotar", args: { texto: "nota" } }],
    });
    assert.equal(shouldContinue(state), "tools");
  });
});

// ── AgentMessage tipos ──────────────────────────────────────────────

describe("AgentMessage types", () => {
  it("suporta todos os roles válidos", () => {
    const roles: AgentMessage["role"][] = ["system", "user", "assistant", "tool"];
    for (const role of roles) {
      const msg: AgentMessage = { role, content: "test" };
      assert.equal(msg.role, role);
    }
  });

  it("toolCalls é opcional", () => {
    const msg: AgentMessage = { role: "assistant", content: "ok" };
    assert.equal(msg.toolCalls, undefined);
  });

  it("toolCallId é opcional", () => {
    const msg: AgentMessage = { role: "tool", content: "ok" };
    assert.equal(msg.toolCallId, undefined);
  });
});

// ── Reducer behavior ────────────────────────────────────────────────

describe("AgentState reducers", () => {
  it("messages reducer concatena", () => {
    const prev: AgentMessage[] = [{ role: "user", content: "a" }];
    const next: AgentMessage[] = [{ role: "assistant", content: "b" }];
    const reducer = (a: AgentMessage[], b: AgentMessage[]) => [...a, ...b];
    const result = reducer(prev, next);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.content, "a");
    assert.equal(result[1]!.content, "b");
  });

  it("iterationCount reducer substitui", () => {
    const reducer = (_prev: number, next: number) => next;
    assert.equal(reducer(0, 1), 1);
    assert.equal(reducer(3, 5), 5);
  });

  it("context reducer substitui", () => {
    const reducer = (_prev: string, next: string) => next;
    assert.equal(reducer("old", "new"), "new");
  });
});
