import { test } from "node:test";
import assert from "node:assert/strict";
import {
  definePrompt,
  promptHash,
  GARDEN,
  gardenManifest,
  emailIngestExtraction,
  guardianAudit,
  specGrillAnalyst,
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
  ]) {
    assert.ok(ids.has(id), `faltou ${id} no gardenManifest`);
  }
});

test("todos os ids do jardim são kebab-case únicos", () => {
  const ids = GARDEN.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids duplicados");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});
