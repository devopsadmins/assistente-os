import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gerarPerguntasGrill, persistirPerguntasGrill, finalizarPlanoGrill } from "../orchestrator/spec-grill.js";

const CATEGORIAS_VALIDAS = new Set(["regra-negocio", "edge-case", "dependencia-banco-api"]);

test("gerarPerguntasGrill: fallback offline gera 3-5 perguntas categorizadas", async () => {
  const prevUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:1"; // porta sem listener: força o fallback
  try {
    const questions = await gerarPerguntasGrill("Adicionar exportação de relatórios em PDF");
    assert.ok(questions.length >= 3 && questions.length <= 5);
    for (const q of questions) {
      assert.ok(CATEGORIAS_VALIDAS.has(q.categoria), `categoria inválida: ${q.categoria}`);
      assert.ok(q.pergunta.trim().length > 0);
    }
  } finally {
    if (prevUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevUrl;
  }
});

test("persistirPerguntasGrill: persiste bloco pending em contexto.md", () => {
  const soulDir = mkdtempSync(join(tmpdir(), "aos-spec-grill-"));
  try {
    const featureDraft = "Adicionar modo escuro na UI";
    const questions = [
      { id: 1, categoria: "regra-negocio" as const, pergunta: "Pergunta 1?" },
      { id: 2, categoria: "edge-case" as const, pergunta: "Pergunta 2?" },
      { id: 3, categoria: "dependencia-banco-api" as const, pergunta: "Pergunta 3?" },
    ];
    const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
    assert.equal(arquivo, join(soulDir, "contexto.md"));
    const body = readFileSync(arquivo, "utf8");
    assert.ok(body.includes("(status: pending)"));
    assert.ok(body.includes(`**Feature:** ${featureDraft}`));
    assert.ok(body.includes("1. [regra-negocio] Pergunta 1?"));
    assert.match(body, /<!-- spec-grill:[0-9a-f-]+ -->/);
  } finally {
    rmSync(soulDir, { recursive: true, force: true });
  }
});

test("finalizarPlanoGrill: menos de 3 respostas falha e mantém pending", () => {
  const soulDir = mkdtempSync(join(tmpdir(), "aos-spec-grill-"));
  try {
    const featureDraft = "Adicionar busca por voz";
    const questions = [
      { id: 1, categoria: "regra-negocio" as const, pergunta: "P1?" },
      { id: 2, categoria: "edge-case" as const, pergunta: "P2?" },
      { id: 3, categoria: "dependencia-banco-api" as const, pergunta: "P3?" },
    ];
    const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
    assert.throws(() => finalizarPlanoGrill(soulDir, featureDraft, ["só uma resposta"]), /insuficientes/);
    const body = readFileSync(arquivo, "utf8");
    assert.ok(body.includes("(status: pending)"));
    assert.ok(!body.includes("(status: authorized)"));
  } finally {
    rmSync(soulDir, { recursive: true, force: true });
  }
});

test("finalizarPlanoGrill: com >= 3 respostas reescreve pra authorized", () => {
  const soulDir = mkdtempSync(join(tmpdir(), "aos-spec-grill-"));
  try {
    const featureDraft = "Adicionar notificações push";
    const questions = [
      { id: 1, categoria: "regra-negocio" as const, pergunta: "P1?" },
      { id: 2, categoria: "edge-case" as const, pergunta: "P2?" },
      { id: 3, categoria: "dependencia-banco-api" as const, pergunta: "P3?" },
    ];
    const arquivo = persistirPerguntasGrill(soulDir, featureDraft, questions);
    const { arquivo: arquivo2 } = finalizarPlanoGrill(soulDir, featureDraft, ["resp 1", "resp 2", "resp 3"]);
    assert.equal(arquivo2, arquivo);
    const body = readFileSync(arquivo, "utf8");
    assert.ok(body.includes("(status: authorized)"));
    assert.ok(!body.includes("(status: pending)"));
    assert.ok(body.includes("resp 1"));
    assert.ok(body.includes("**Autorizado em:**"));
  } finally {
    rmSync(soulDir, { recursive: true, force: true });
  }
});
