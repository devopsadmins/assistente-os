import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAnswerFaithfulness } from "../rag-faithfulness-score.js";

const SRC = [
  "Para reiniciar o serviço no servidor, rode pm2 restart assistente-os.",
  "Os logs ficam em pm2 logs assistente-os. O daemon escuta na porta 4310.",
];

test("scoreAnswerFaithfulness: resposta ancorada nas fontes → supported alto, sem unsupported", () => {
  const r = scoreAnswerFaithfulness(
    "Para reiniciar o serviço, rode pm2 restart assistente-os. Os logs ficam em pm2 logs assistente-os.",
    SRC,
  );
  assert.equal(r.method, "heuristic");
  assert.ok(r.claims >= 2);
  assert.equal(r.unsupported.length, 0);
  assert.equal(r.supported, 1);
});

test("scoreAnswerFaithfulness: frase inventada (fora do contexto) entra em unsupported e derruba o supported", () => {
  const r = scoreAnswerFaithfulness(
    "Para reiniciar rode pm2 restart assistente-os. O sistema também envia um email de confirmação para o administrador financeiro cadastrado.",
    SRC,
  );
  assert.equal(r.claims, 2);
  assert.equal(r.unsupported.length, 1);
  assert.match(r.unsupported[0]!.sentence, /email de confirmação/);
  assert.equal(r.supported, 0.5);
});

test("scoreAnswerFaithfulness: sem fontes → nada é sustentado", () => {
  const r = scoreAnswerFaithfulness("A capital da Mongólia é Ulan Bator.", []);
  assert.equal(r.claims, 1);
  assert.equal(r.supported, 0);
});

test("scoreAnswerFaithfulness: resposta curta / não-afirmação não conta como claim", () => {
  const r = scoreAnswerFaithfulness("Sim. Não sei.", SRC);
  assert.equal(r.claims, 0);
  assert.equal(r.supported, 1, "sem afirmações = nada pra desmentir");
});

test("scoreAnswerFaithfulness: minOverlap ajustável", () => {
  const answer = "O daemon escuta na porta 4310 conforme documentado no manual interno.";
  const lax = scoreAnswerFaithfulness(answer, SRC, { minOverlap: 0.2 });
  const strict = scoreAnswerFaithfulness(answer, SRC, { minOverlap: 0.9 });
  assert.equal(lax.unsupported.length, 0);
  assert.equal(strict.unsupported.length, 1);
});
