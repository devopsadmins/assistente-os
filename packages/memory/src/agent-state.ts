/**
 * Estado do agente LangGraph para o Assistente OS.
 *
 * Define a estrutura de estado que é mantida entre chamadas do LLM
 * e persistida no grafo de memória (PostgreSQL).
 *
 * O `soul` identifica qual soul/usuário o estado pertence.
 */
export interface AgentState {
  /** Identificador da soul/usuário */
  soul: string;

  /** Histórico de mensagens da conversa */
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;

  /** Contexto recuperado da busca RAG atual */
  context: string;

  /** Resultado da última execução de tool */
  lastToolResult?: string;

  /** Entidades conhecidas do grafo de memória */
  entities?: Record<string, { name: string; kind: string; properties?: Record<string, unknown> }>;

  /** Relações conhecidas do grafo de memória */
  relations?: Array<{ from: string; rel: string; to: string }>;

  /** Contador de iterações para evitar loops infinitos */
  iterationCount: number;

  /** Máximo de iterações permitidas */
  maxIterations: number;
}

/**
 * Estado inicial para um novo agente.
 */
export function createInitialState(soul: string): AgentState {
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

/**
 * Atualiza o estado após uma mensagem do usuário.
 */
export function updateStateWithUserMessage(
  state: AgentState,
  userMessage: string
): AgentState {
  return {
    ...state,
    messages: [...state.messages, { role: "user", content: userMessage }],
  };
}

/**
 * Atualiza o estado após uma execução de tool.
 */
export function updateStateWithToolResult(
  state: AgentState,
  toolResult: string
): AgentState {
  return {
    ...state,
    messages: [...state.messages, { role: "tool", content: toolResult }],
    lastToolResult: toolResult,
  };
}

/**
 * Incrementa o contador de iterações.
 */
export function incrementIteration(state: AgentState): AgentState {
  return {
    ...state,
    iterationCount: state.iterationCount + 1,
  };
}

/**
 * Verifica se o agente atingiu o limite de iterações.
 */
export function hasReachedMaxIterations(state: AgentState): boolean {
  return state.iterationCount >= state.maxIterations;
}