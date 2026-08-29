import { test } from "node:test";
import assert from "node:assert/strict";
import {
  definePrompt,
  promptHash,
  promptCanonical,
  GARDEN,
  gardenManifest,
  emailIngestExtraction,
  guardianAudit,
  specGrillAnalyst,
  entityExtraction,
  agentReactSystem,
  ragAnswer,
  RAG_ANSWER_SUFFIXES,
} from "../prompts/garden/index.js";

test("definePrompt: render substitui {chave} e escapa {{ }}", () => {
  const p = definePrompt<{ nome: string }>({
    id: "t",
    papel: "x",
    objetivo: "y",
    regras: [],
    formatoSaida: "z",
    versao: 1,
    template: "Olá {nome}, use {{chave}} literal.",
  });
  assert.equal(p.render({ nome: "Ana" }), "Olá Ana, use {chave} literal.");
});

test("definePrompt: variável ausente lança com o id do prompt", () => {
  const p = definePrompt<{ a: string }>({
    id: "meu-prompt",
    papel: "x",
    objetivo: "y",
    regras: [],
    formatoSaida: "z",
    versao: 1,
    template: "{a} {b}",
  });
  assert.throws(() => p.render({ a: "1" } as { a: string; b: string }), /meu-prompt.*\{b\}/);
});

test("emailIngestExtraction: interpola o corpo e mantém o cabeçalho de chaves", () => {
  const out = emailIngestExtraction.render({ emailBody: "corpo do email" });
  assert.match(out, /Extraia JSON com chaves: topicos/);
  assert.match(out, /EMAIL BODY:\ncorpo do email$/);
});

test("guardianAudit: com e sem linha de testes", () => {
  const comum = { taskId: "T1", targetAgent: "ag", changesSummary: "mudou X" };
  const semTestes = guardianAudit.render({ ...comum, testResultsLine: "" });
  assert.match(semTestes, /Resumo das mudanças: mudou X\nAvalie a qualidade/);
  const comTestes = guardianAudit.render({ ...comum, testResultsLine: "Resultado dos testes: 10 ok\n" });
  assert.match(comTestes, /Resumo das mudanças: mudou X\nResultado dos testes: 10 ok\nAvalie a qualidade/);
  assert.match(comTestes, /\{"score": number, "feedback": string\}\.$/);
});

test("specGrillAnalyst: render sem variáveis produz o JSON literal desescapado", () => {
  const out = specGrillAnalyst.render({});
  assert.match(out, /\{"questions": \[\{"categoria": "\.\.\.", "pergunta": "\.\.\."\}\]\}/);
  assert.doesNotMatch(out, /\{\{|\}\}/);
});

test("outputSchema: {outputSchema} é injetado no render; ausência lança", () => {
  const p = definePrompt<Record<string, never>>({
    id: "os-t",
    papel: "x",
    objetivo: "y",
    regras: [],
    formatoSaida: "z",
    outputSchema: '{"a": 1}',
    versao: 1,
    template: "responda como {outputSchema}.",
  });
  assert.equal(p.render({}), 'responda como {"a": 1}.');

  const semSchema = definePrompt<Record<string, never>>({
    id: "os-t2",
    papel: "x",
    objetivo: "y",
    regras: [],
    formatoSaida: "z",
    versao: 1,
    template: "quero {outputSchema}",
  });
  assert.throws(() => semSchema.render({}), /não define outputSchema/);
});

test("outputSchema entra na forma canônica / no hash", () => {
  const base = { id: "h2", papel: "p", objetivo: "o", regras: [] as const, formatoSaida: "f", versao: 1, template: "t" };
  assert.notEqual(promptHash(base), promptHash({ ...base, outputSchema: '{"x":1}' }));
  assert.match(promptCanonical({ ...base, outputSchema: '{"x":1}' }), /"outputSchema":"\{\\"x\\":1\}"/);
});

test("migrados p/ outputSchema: entity-extraction e guardian-audit renderizam o JSON literal (sem {{ }})", () => {
  const ent = entityExtraction.render({ entityKinds: "pessoa", text: "abc" });
  assert.match(ent, /\{"entities": \[\{"name": "string"/);
  assert.doesNotMatch(ent, /\{\{|\}\}/);
  const g = guardianAudit.render({ taskId: "T", targetAgent: "a", changesSummary: "c", testResultsLine: "" });
  assert.match(g, /apenas em JSON: \{"score": number, "feedback": string\}\.$/);
});

test("agentReactSystem: render sem vars é o system prompt do ReAct", () => {
  assert.equal(
    agentReactSystem.render({}),
    "Você é o assistente do Assistente OS. Use as ferramentas disponíveis para responder perguntas do usuário. " +
      "Você tem acesso a um grafo de memória com entidades, relações e observações.",
  );
});

test("ragAnswer: template preserva {context}/{question}, resolve {suffix}", () => {
  const human = ragAnswer.template.replace("{suffix}", RAG_ANSWER_SUFFIXES.default);
  assert.equal(human, "Contexto:\n{context}\n\nPergunta: {question}\n\nResposta:");
  assert.equal(Object.keys(RAG_ANSWER_SUFFIXES).length, 5);
  assert.equal(ragAnswer.papel, "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo.");
});

test("promptHash: estável para o mesmo spec, muda com o template", () => {
  const base = {
    id: "h",
    papel: "p",
    objetivo: "o",
    regras: ["r"] as const,
    formatoSaida: "f",
    versao: 1,
    template: "abc {x}",
  };
  assert.equal(promptHash(base), promptHash({ ...base }));
  assert.notEqual(promptHash(base), promptHash({ ...base, template: "abd {x}" }));
  assert.notEqual(promptHash(base), promptHash({ ...base, versao: 2 }));
});

test("gardenManifest: uma entrada por prompt, ordenada por id, hash de 64 hex", () => {
  const m = gardenManifest();
  assert.equal(m.length, GARDEN.length);
  assert.deepEqual(
    m.map((e) => e.id),
    [...m.map((e) => e.id)].sort((a, b) => a.localeCompare(b)),
  );
  for (const e of m) {
    assert.match(e.hash, /^[0-9a-f]{64}$/);
    assert.equal(typeof e.versao, "number");
  }
  // ids esperados presentes
  const ids = new Set(m.map((e) => e.id));
  for (const id of [
    "concise-output",
    "email-ingest-extraction",
    "meeting-ingest-extraction",
    "spec-grill-analyst",
    "entity-extraction",
    "guardian-audit",
    "rag-rerank-scorer",
    "agent-react-system",
    "rag-answer",
    "router-escalation-judge",
  ]) {
    assert.ok(ids.has(id), `faltou ${id} no gardenManifest`);
  }
});

test("todos os ids do jardim são kebab-case únicos", () => {
  const ids = GARDEN.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids duplicados");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});
