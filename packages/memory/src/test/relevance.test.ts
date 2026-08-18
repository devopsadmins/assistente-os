import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, usefulTerms, relevancia, STOPWORDS_PT } from "../relevance.js";
import type { SearchResult } from "../indexer.js";

function result(body: string, score: number): SearchResult {
  return { docKey: "x::0", path: "/x", title: null, body, score, method: "vector" };
}

test("tokenize remove pontuação e acentos", () => {
  assert.deepEqual(tokenize("Everton., dimastec, participação!"), ["everton", "dimastec", "participacao"]);
});

test("STOPWORDS_PT contém stop comuns em PT", () => {
  assert.ok(STOPWORDS_PT.has("o"));
  assert.ok(STOPWORDS_PT.has("como"));
  assert.ok(STOPWORDS_PT.has("com"));
  assert.ok(STOPWORDS_PT.has("sobre") === false);
  assert.ok(!STOPWORDS_PT.has("everton"));
});

test("usefulTerms descarta stopwords e tokens <3 (sem stemming)", () => {
  const u = usefulTerms("como fui na última reunião com o everton");
  assert.deepEqual(u, ["fui", "ultima", "reuniao", "everton"]);
});

test("relevancia: nenhum resultado -> ok false", () => {
  const v = relevancia("qualquer coisa", []);
  assert.equal(v.ok, false);
  assert.equal(v.score, 0);
  assert.match(v.motivo, /Nenhum resultado/i);
});

test("relevancia: score baixo -> ok false (modo recusar default)", () => {
  const results = [result("nada relacionado com a pergunta", 0.1)];
  const v = relevancia("area de atuacao do areauu", results);
  assert.equal(v.ok, false);
  assert.match(v.motivo, /Semelhança/i);
});

test("relevancia: termos abaixo do minimo -> ok false", () => {
  // score alto mas nenhum termo útil aparece no corpus
  const results = [result("assunto completamente distinto sobre fincas rurais", 0.9)];
  const v = relevancia("qual o nome do areauu aqui", results);
  assert.equal(v.ok, false);
  assert.match(v.motivo, /Nenhuma? termo/i);
});

test("relevancia: score alto e termos presentes -> ok true", () => {
  const corpus = "O areauu é uma unidade de contexto chamada alma que persiste entre sessões. areauu usa RAG.";
  const results = [result(corpus, 0.9)];
  const v = relevancia("como funciona o areauu e seu RAG", results);
  assert.equal(v.ok, true);
  assert.equal(v.motivo, "");
});

test("relevancia: modo libre ainda reporta ok false, mas modo=libre (caller decide ignorar)", () => {
  const results = [result("nada", 0.05)];
  const v = relevancia("qual algo", results, { modo: "libre" });
  assert.equal(v.modo, "libre");
  assert.equal(v.ok, false); // o gate falha; em libre o caller ignora a recusa
  assert.match(v.motivo, /Semelhança/i);
});

test("relevancia: aviso mantém ok true quando passa (caller avisa se false)", () => {
  const results = [result("contexto sobre areauu e RAG aqui", 0.8)];
  const v = relevancia("areauu RAG", results, { modo: "aviso" });
  assert.equal(v.ok, true);
  assert.equal(v.modo, "aviso");
  assert.equal(v.motivo, "");
});

test("relevancia: threshold customizado", () => {
  const results = [result("algo", 0.5)];
  const v = relevancia("algo relevante", results, { min_score: 0.6 });
  assert.equal(v.ok, false);
});
