/**
 * Estado do agente LangGraph para o Assistente OS.
 *
 * Define o schema de estado via Annotation do LangGraph, que gerencia
 * reducers automaticamente e serializa/deserializa o estado entre nós.
 */
import { Annotation } from "@langchain/langgraph";

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
        content:
          "Você é o assistente do Assistente OS. Use as ferramentas disponíveis para responder perguntas do usuário. " +
          "Você tem acesso a um grafo de memória com entidades, relações e observações.",
      },
    ],
    context: "",
    lastToolResult: undefined,
    entities: undefined,
    relations: undefined,
    iterationCount: 0,
    maxIterations: Number(process.env.LANGGRAPH_MAX_ITERATIONS) || 5,
  };
}
