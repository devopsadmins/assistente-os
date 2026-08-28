import { definePrompt } from "./types.js";

/**
 * Julgamento de uma execução de agente pelo Guardian
 * (`packages/core/src/governance/golden-rules.ts::auditExecution`).
 * `testResultsLine` já vem pronta do caller: `""` ou `"Resultado dos testes: ...\n"`.
 */
export const guardianAudit = definePrompt<{
  taskId: string;
  targetAgent: string;
  changesSummary: string;
  testResultsLine: string;
}>({
  id: "guardian-audit",
  papel: "Guardian — supervisor de qualidade e conformidade ISO/IEC 42001",
  objetivo: "Dar uma nota 0–100 de qualidade para uma execução de agente.",
  regras: [
    "Só o JSON na resposta.",
    "Falha segura: na dúvida, nota baixa (o caller só aprova score >= 95).",
  ],
  formatoSaida: '{"score": number, "feedback": string}',
  versao: 1,
  template: [
    "Você é o Guardian, supervisor de qualidade e conformidade ISO/IEC 42001.",
    "Tarefa: {taskId}",
    "Agente avaliado: {targetAgent}",
    "Resumo das mudanças: {changesSummary}",
    '{testResultsLine}Avalie a qualidade de 0 a 100 e responda apenas em JSON: {{"score": number, "feedback": string}}.',
  ].join("\n"),
});
