import { definePrompt } from "./types.js";

/**
 * Juiz de confiança do escalonamento do roteador (Etapa 8 do refino —
 * `packages/daemon/src/orchestrator/escalation.ts`). Uma chamada SIM/NÃO curta
 * ao modelo local: a resposta do tier `local` respondeu de fato à pergunta?
 */
export const routerEscalationJudge = definePrompt<{ pergunta: string; contexto: string; resposta: string }>({
  id: "router-escalation-judge",
  papel: "Avaliador binário de suficiência de resposta",
  objetivo: "Dizer se a RESPOSTA responde à PERGUNTA de forma útil (usando o CONTEXTO quando há).",
  regras: [
    "Responda com uma única palavra: SIM ou NÃO.",
    'NÃO quando a resposta é evasiva, "não sei", genérica demais, ou não endereça a pergunta.',
    "SIM quando a resposta é concreta e pertinente, mesmo que curta.",
  ],
  formatoSaida: "Uma palavra: SIM ou NÃO.",
  versao: 1,
  template: [
    "PERGUNTA: {pergunta}",
    "",
    "CONTEXTO (pode estar vazio): {contexto}",
    "",
    "RESPOSTA DADA: {resposta}",
    "",
    "A RESPOSTA responde à PERGUNTA de forma útil? Responda só SIM ou NÃO.",
  ].join("\n"),
});
