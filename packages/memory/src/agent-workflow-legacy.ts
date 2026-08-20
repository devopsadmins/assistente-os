/**
 * Funções auxiliares legacy do agente.
 * Mantidas para retrocompatibilidade com código existente que importa diretamente.
 */
import { runRagChain } from "./rag-chain.js";
import type { AgentStateType } from "./agent-state.js";
import type { Pool } from "@assistente-os/core";

export function addUserMessage(
  state: AgentStateType,
  message: string
): AgentStateType {
  return {
    ...state,
    messages: [...state.messages, { role: "user", content: message }],
  };
}

export function addToolResult(
  state: AgentStateType,
  result: string
): AgentStateType {
  return {
    ...state,
    messages: [...state.messages, { role: "tool", content: result }],
    lastToolResult: result,
  };
}

export function checkMaxIterations(state: AgentStateType): boolean {
  return state.iterationCount >= state.maxIterations;
}

export function nextIteration(state: AgentStateType): AgentStateType {
  return { ...state, iterationCount: state.iterationCount + 1 };
}

export async function executeRagChain(
  pool: Pool,
  soul: string,
  query: string
): Promise<{
  answer: string;
  sources: Array<{ doc: string; snippet: string; score: number }>;
  model: string;
}> {
  return await runRagChain(pool, soul, query, 5);
}

export function decideNextStep(
  state: AgentStateType
): "__end__" | "generate" | "execute_tool" {
  if (state.iterationCount >= (state.maxIterations || 5)) {
    return "__end__";
  }
  if (state.lastToolResult) {
    return "generate";
  }
  return "generate";
}
