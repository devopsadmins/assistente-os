import { test } from "node:test";
import assert from "node:assert/strict";
import { rerank, rerankConfig, type RerankConfig } from "../rerank.js";

interface Doc { body: string; score: number; id: string }
const d = (id: string, body: string, score: number): Doc => ({ id, body, score });

const OFF: RerankConfig = { mode: "off", topN: 20, topK: 3 };

test("rerankConfig: default off; lê env", () => {
  const prev = process.env.RAG_RERANK;
  delete process.env.RAG_RERANK;
  assert.equal(rerankConfig().mode, "off");
  process.env.RAG_RERANK = "cross-encoder";
  assert.equal(rerankConfig().mode, "cross-encoder");
  process.env.RAG_RERANK = "lixo";
  assert.equal(rerankConfig().mode, "off");
  if (prev === undefined) delete process.env.RAG_RERANK;
  else process.env.RAG_RERANK = prev;
});

test("rerank off: só ordena pelo score existente e corta no topK", async () => {
  const docs = [d("a", "irrelevante", 0.9), d("b", "resposta certa", 0.4), d("c", "meio", 0.6)];
  const out = await rerank("q", docs, OFF);
  assert.deepEqual(out.map((x) => x.id), ["a", "c", "b"]);
  assert.equal(out.length, 3);
});

test("rerank cross-encoder (scorer injetado): tira a isca lexical que a busca deixou no topo", async () => {
  // "isca": lexicalmente próxima da query mas irrelevante — score de busca alto.
  const docs = [
    d("isca", "instalar o pacote no sistema operacional", 0.95),
    d("bom", "para reiniciar o serviço rode systemctl restart", 0.55),
    d("ok", "logs ficam em /var/log", 0.5),
    d("ruim", "história do projeto", 0.3),
  ];
  // scorer que entende a intenção real ("como reiniciar o serviço")
  const scorer = (_q: string, body: string) => (body.includes("systemctl restart") ? 3 : body.includes("log") ? 1 : 0);
  const out = await rerank("como reiniciar o serviço", docs, { mode: "cross-encoder", topN: 20, topK: 2 }, scorer);
  assert.deepEqual(out.map((x) => x.id), ["bom", "ok"], "a isca sai do topo; o doc útil sobe");
});

test("rerank: scorer que devolve -1 (não pontuado) preserva a ordem por score original", async () => {
  const docs = [d("a", "x", 0.2), d("b", "y", 0.8), d("c", "z", 0.5)];
  const out = await rerank("q", docs, { mode: "llm", topN: 20, topK: 3 }, () => -1);
  assert.deepEqual(out.map((x) => x.id), ["b", "c", "a"]);
});
