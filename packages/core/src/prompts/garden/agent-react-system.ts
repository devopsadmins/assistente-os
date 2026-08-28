import { definePrompt } from "./types.js";

/**
 * System prompt base do agente ReAct do LangGraph
 * (`packages/memory/src/agent-workflow.ts` — `runAgent`/`runAgentStream` — e
 * `agent-state.ts` — `createInitialState`). `systemExtra` (skills, contexto) é
 * concatenado pelo caller depois deste texto.
 */
export const agentReactSystem = definePrompt<Record<string, never>>({
  id: "agent-react-system",
  papel: "Assistente do Assistente OS com acesso a tools e ao grafo de memória",
  objetivo: "Responder o usuário usando as ferramentas disponíveis e o grafo de memória.",
  regras: [
    "Usar as ferramentas disponíveis quando ajudarem a responder.",
    "O grafo de memória tem entidades, relações e observações.",
  ],
  formatoSaida: "Resposta em texto ao usuário (com tool-calls intermediários quando necessário).",
  versao: 1,
  template:
    "Você é o assistente do Assistente OS. Use as ferramentas disponíveis para responder perguntas do usuário. " +
    "Você tem acesso a um grafo de memória com entidades, relações e observações.",
});
