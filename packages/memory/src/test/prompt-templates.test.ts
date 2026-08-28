/**
 * Etapa 5 do refino: `prompt-templates.ts` passa a montar as palavras do Prompt
 * Garden (`ragAnswer` + `RAG_ANSWER_SUFFIXES`). Este teste trava as duas formas
 * consumidas hoje contra o texto anterior — byte a byte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  langchainTemplates,
  defaultTemplate,
  codeTemplate,
  analysisTemplate,
  factualTemplate,
  informationExtractionTemplate,
  applyTemplate,
} from "../prompt-templates.js";

const SYSTEM = "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.";

test("langchainTemplates: system + human message byte-idênticos ao formato anterior", async () => {
  const cases: Array<[keyof typeof langchainTemplates, string]> = [
    ["default", "Resposta:"],
    ["code", "Resposta detalhada:"],
    ["analysis", "Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:"],
    ["factual", "Resposta direta:"],
    ["information-extraction", "Informação solicitada:"],
  ];
  for (const [name, suffix] of cases) {
    const msgs = await langchainTemplates[name].formatMessages({ context: "CTX", question: "Q" });
    assert.equal(msgs[0]?.content, SYSTEM, `${name}: system`);
    assert.equal(msgs[1]?.content, `Contexto:\nCTX\n\nPergunta: Q\n\n${suffix}`, `${name}: human`);
  }
});

test("*Template / applyTemplate: forma-string legada byte-idêntica", () => {
  const leg = (suffix: string) =>
    `${SYSTEM}\n\nContexto: CTX\n\nPergunta: Q\n\n${suffix}`;
  assert.equal(defaultTemplate("CTX", "Q"), leg("Resposta:"));
  assert.equal(codeTemplate("CTX", "Q"), leg("Resposta detalhada:"));
  assert.equal(analysisTemplate("CTX", "Q"), leg("Análise:\n- Pontos principais:\n- Conclusões:\n- Incertezas:"));
  assert.equal(factualTemplate("CTX", "Q"), leg("Resposta direta:"));
  assert.equal(informationExtractionTemplate("CTX", "Q"), leg("Informação solicitada:"));
  assert.equal(applyTemplate("default", "CTX", "Q"), leg("Resposta:"));
  assert.throws(() => applyTemplate("inexistente" as "default", "CTX", "Q"), /não encontrado/);
});
