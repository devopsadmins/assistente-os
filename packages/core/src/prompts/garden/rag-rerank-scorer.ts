import { definePrompt } from "./types.js";

/**
 * Prompt do scorer LLM do reranker de RAG (`packages/memory/src/rerank.ts`, modo
 * `RAG_RERANK=llm`). O caller trunca o trecho antes de passar.
 */
export const ragRerankScorer = definePrompt<{ pergunta: string; trecho: string }>({
  id: "rag-rerank-scorer",
  papel: "Juiz de relevância de trecho para RAG",
  objetivo: "Pontuar o quão útil um trecho é para responder a pergunta.",
  regras: ["Responder só o número, sem texto."],
  formatoSaida: "Um inteiro de 0 a 3.",
  versao: 1,
  template: [
    "Numa escala 0-3, quão útil é o TRECHO para responder a PERGUNTA? Responda só o número.",
    "",
    "PERGUNTA: {pergunta}",
    "",
    "TRECHO: {trecho}",
  ].join("\n"),
});
