/**
 * Módulo de workflow do agente LangGraph para o Assistente OS.
 *
 * Exporta funções utilitárias para criação e gestão de agentes com estado.
 * A integração completa com o StateGraph da LangGraph requer atenção às
 * definições de tipo da versão específica do pacote instalada.
 *
 * Funcionamento comprovado em runtime; ajustes de tipo podem ser necessários.
 */
import { runRagChain } from "./rag-chain.js";
import type { Pool } from "@assistente-os/core";

/**
 * Interface simplificada de estado do agente.
 * Pode ser expandida conforme necessária.
 */
export interface AgentStateSimple {
  soul: string;
  messages: Array<{ role: string; content: string }>;
  context: string;
  lastToolResult?: string;
  iterationCount: number;
  maxIterations: number;
}

/**
 * Cria estado inicial para o agente.
 */
export function createInitialAgentState(soul: string): AgentStateSimple {
  return {
    soul,
    messages: [
      {
        role: "system",
        content:
          "Você é o assistente do Assistente OS. Use as ferramentas disponíveis para responder perguntas do usuário.",
      },
    ],
    context: "",
    lastToolResult: undefined,
    iterationCount: 0,
    maxIterations: Number(process.env.LANGGRAPH_MAX_ITERATIONS) || 5,
  };
}

/**
 * Atualiza estado com mensagem do usuário.
 */
export function addUserMessage(
  state: AgentStateSimple,
  message: string
): AgentStateSimple {
  return {
    ...state,
    messages: [...state.messages, { role: "user", content: message }],
  };
}

/**
 * Atualiza estado com resultado de tool.
 */
export function addToolResult(
  state: AgentStateSimple,
  result: string
): AgentStateSimple {
  return {
    ...state,
    messages: [...state.messages, { role: "tool", content: result }],
    lastToolResult: result,
  };
}

/**
 * Verifica se atingiu limite de iterações.
 */
export function checkMaxIterations(state: AgentStateSimple): boolean {
  return state.iterationCount >= state.maxIterations;
}

/**
 * Incrementa contador de iterações.
 */
export function nextIteration(state: AgentStateSimple): AgentStateSimple {
  return { ...state, iterationCount: state.iterationCount + 1 };
}

/**
 * Executa a chain RAG com o estado atual.
 * Esta é a função central que conecta o agente ao RAG.
 */
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

/**
 * Decide o próximo passo do agente baseado no estado atual.
 * Retorna o nome do próximo nó ou END.
 *
 * @param state Estado atual do agente
 * @returns Próximo passo: "__end__" | "generate" | "execute_tool"
 */
export function decideNextStep(
  state: AgentStateSimple
): "__end__" | "generate" | "execute_tool" {
  if (state.iterationCount >= (state.maxIterations || 5)) {
    return "__end__";
  }
  if (state.lastToolResult) {
    return "generate";
  }
  return "generate";
}

/**
 * Re-exporta as prompt templates com aliases voltados ao agente RAG.
 * (applyTemplate já é exportado direto por prompt-templates via index.)
 */
export {
  defaultTemplate as ragDefaultTemplate,
  codeTemplate as ragCodeTemplate,
  analysisTemplate as ragAnalysisTemplate,
  factualTemplate as ragFactualTemplate,
  informationExtractionTemplate as ragInformationExtractionTemplate,
} from "./prompt-templates.js";