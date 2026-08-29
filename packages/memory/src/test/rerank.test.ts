import { test } from "node:test";
import assert from "node:assert/strict";
import { rerank, rerankConfig, __resetRerankState, type RerankConfig } from "../rerank.js";

interface Doc { body: string; score: number; id: string }
const d = (id: string, body: string, score: number): Doc => ({ id, body, score });

const OFF: RerankConfig = { mode: "off", topN: 20, topK: 3, budgetMs: 30_000 };

test("rerankConfig: default off; lê env; budgetMs default 30s e override", () => {
  const prev = { ...process.env };
  try {
    delete process.env.RAG_RERANK;
    delete process.env.RAG_RERANK_BUDGET_MS;
    assert.equal(rerankConfig().mode, "off");
    assert.equal(rerankConfig().budgetMs, 30_000);
    process.env.RAG_RERANK = "cross-encoder";
    assert.equal(rerankConfig().mode, "cross-encoder");
    process.env.RAG_RERANK = "lixo";
    assert.equal(rerankConfig().mode, "off");
    process.env.RAG_RERANK_BUDGET_MS = "5000";
    assert.equal(rerankConfig().budgetMs, 5000);
    process.env.RAG_RERANK_BUDGET_MS = "0"; // 0 = sem teto
    assert.equal(rerankConfig().budgetMs, 0);
  } finally {
    process.env = prev;
  }
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
  const out = await rerank(
    "como reiniciar o serviço",
    docs,
    { mode: "cross-encoder", topN: 20, topK: 2, budgetMs: 30_000 },
    scorer,
  );
  assert.deepEqual(out.map((x) => x.id), ["bom", "ok"], "a isca sai do topo; o doc útil sobe");
});

test("rerank: scorer que devolve -1 (não pontuado) preserva a ordem por score original", async () => {
  const docs = [d("a", "x", 0.2), d("b", "y", 0.8), d("c", "z", 0.5)];
  const out = await rerank("q", docs, { mode: "llm", topN: 20, topK: 3, budgetMs: 30_000 }, () => -1);
  assert.deepEqual(out.map((x) => x.id), ["b", "c", "a"]);
});

test("rerank: orçamento estourado no meio → volta à ordem por score original", async () => {
  const docs = [
    d("isca", "lexical alto", 0.95),
    d("bom", "relevante de verdade", 0.4),
    d("meio", "ok", 0.6),
  ];
  // scorer lento: 20ms/par, orçamento 10ms → estoura já no 1º par.
  const slow = async (_q: string, _b: string) => {
    await new Promise((r) => setTimeout(r, 20));
    return 3;
  };
  const out = await rerank(
    "q",
    docs,
    { mode: "cross-encoder", topN: 20, topK: 2, budgetMs: 10 },
    slow,
  );
  // caiu no fallback: ordem por score original, cortado no topK
  assert.deepEqual(out.map((x) => x.id), ["isca", "meio"]);
});

test("rerank: budgetMs=0 desliga o teto (roda o scorer lento até o fim)", async () => {
  const docs = [d("a", "aa", 0.2), d("b", "bb", 0.8)];
  const slow = async (_q: string, body: string) => {
    await new Promise((r) => setTimeout(r, 15));
    return body === "aa" ? 9 : 1; // inverte a ordem original
  };
  const out = await rerank("q", docs, { mode: "cross-encoder", topN: 20, topK: 2, budgetMs: 0 }, slow);
  assert.deepEqual(out.map((x) => x.id), ["a", "b"], "sem teto: o rerank completa e reordena");
});

/**
 * Caminho tokenizer+model REAL do cross-encoder — o que não tinha teste e por
 * isso o bug do T1.4 passou (chamada com assinatura errada, erro engolido).
 * Skip por default (baixa ~90MB do HF + inferência em CPU). Rodar com:
 *   RAG_RERANK_TEST_MODEL=Xenova/ms-marco-MiniLM-L-6-v2 node --test .../rerank.test.js
 */
test("rerank cross-encoder REAL: score(relevante) > score(irrelevante)", async (t) => {
  const model = process.env.RAG_RERANK_TEST_MODEL;
  if (!model) {
    t.skip("defina RAG_RERANK_TEST_MODEL para rodar contra o modelo real");
    return;
  }
  __resetRerankState();
  process.env.RAG_RERANK_CE_MODEL = model;
  const query = "como reiniciar o serviço pm2";
  // O irrelevante entra em 1º com score de busca MAIOR — só um rerank que de fato
  // pontuou (query, body) consegue inverter. Se o modelo não carregar, o fallback
  // por score original mantém "irr" no topo e o teste falha (é o objetivo).
  const docs = [
    d("irr", "A história da culinária italiana remonta à Roma antiga e às trocas comerciais.", 0.92),
    d("rel", "Para reiniciar um app no pm2, rode: pm2 restart <nome>. Isso recarrega o processo.", 0.41),
  ];
  const out = await rerank(query, docs, { mode: "cross-encoder", topN: 20, topK: 2, budgetMs: 120_000 });
  assert.equal(out[0]!.id, "rel", "o doc relevante deve vir em 1º após o rerank real");
});
