import { definePrompt } from "./types.js";

/**
 * Prompt de resposta do RAG (`packages/memory/src/prompt-templates.ts` →
 * `langchainTemplates` / `applyTemplate`; consumido por `rag-chain.ts`).
 *
 * `papel` é a instrução de sistema (mensagem `system` do `ChatPromptTemplate`);
 * `template` é o corpo da mensagem `human` — `{context}` e `{question}` são
 * placeholders do LangChain (NÃO renderizados aqui), `{suffix}` seleciona o
 * estilo da resposta (ver `RAG_ANSWER_SUFFIXES`).
 */
export const ragAnswer = definePrompt<{ context: string; question: string; suffix: string }>({
  id: "rag-answer",
  papel: "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.",
  objetivo: "Responder ancorado só no contexto recuperado, no estilo pedido pelo sufixo.",
  regras: [
    "Não usar conhecimento fora do contexto fornecido.",
    "O sufixo define o formato: resposta direta, detalhada ou análise estruturada.",
  ],
  formatoSaida: "Texto; o sufixo indica o estilo.",
  versao: 1,
  template: "Contexto:\n{context}\n\nPergunta: {question}\n\n{suffix}",
});

/** Estilos de resposta do RAG — o valor vai em `{suffix}`. */
export const RAG_ANSWER_SUFFIXES = {
  default: "Resposta:",
  code: "Resposta detalhada:",
  analysis: "Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:",
  factual: "Resposta direta:",
  "information-extraction": "Informação solicitada:",
} as const;

export type RagAnswerStyle = keyof typeof RAG_ANSWER_SUFFIXES;
