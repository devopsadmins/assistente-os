/**
 * Estado do agente LangGraph para o Assistente OS.
 *
 * Define o schema de estado via Annotation do LangGraph, que gerencia
 * reducers automaticamente e serializa/deserializa o estado entre nós.
 */
import { Annotation } from "@langchain/langgraph";
import { agentReactSystem } from "@assistente-os/core";

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
}

export const AgentState = Annotation.Root({
  soul: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  messages: Annotation<AgentMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),

  context: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  lastToolResult: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),

  entities: Annotation<Record<string, { name: string; kind: string; properties?: Record<string, unknown> }> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),

  relations: Annotation<Array<{ from: string; rel: string; to: string }> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),

  iterationCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /**
   * Uso de tokens acumulado ao longo do grafo (E1/FinOps). Reducer soma os
   * deltas de cada passagem pelo nó `generate`, para o runner reportar o
   * total real da execução (não só da última chamada ao LLM).
   */
  usage: Annotation<{ inputTokens: number; outputTokens: number }>({
    reducer: (prev, next) => ({
      inputTokens: prev.inputTokens + next.inputTokens,
      outputTokens: prev.outputTokens + next.outputTokens,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),

  maxIterations: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => Number(process.env.LANGGRAPH_MAX_ITERATIONS) || 5,
  }),
});

export type AgentStateType = typeof AgentState.State;

export function createInitialState(soul: string): AgentStateType {
  return {
    soul,
    messages: [
      {
        role: "system",
        content: agentReactSystem.render({}),
      },
    ],
    context: "",
    lastToolResult: undefined,
    entities: undefined,
    relations: undefined,
    iterationCount: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    maxIterations: Number(process.env.LANGGRAPH_MAX_ITERATIONS) || 5,
  };
}
