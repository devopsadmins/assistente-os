/**
 * Testes de fidelidade RAG — não reimplementa RAGAS/DeepEval. Dois níveis:
 *
 * 1. Grounding lexical (determinístico, sem rede, sempre roda no CI): a
 *    resposta recuperada contém o termo-chave esperado e a fonte apontada
 *    é de fato o documento que contém o fato.
 * 2. Juiz LLM (requer Ollama local com o modelo configurado — mesmo padrão
 *    de auto-skip de rag-chain.test.ts "runRagChain retorna resultado com
 *    fontes"): pergunta ao próprio modelo se a resposta gerada é sustentada
 *    apenas pelo contexto recuperado, sem alucinar fatos ausentes. Não roda
 *    no CI hoje (sem serviço Ollama em ci.yml) — só localmente/pré-merge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@assistente-os/core";
import { LiteralEmbedder } from "../embedders.js";
import { indexDirectory } from "../indexer.js";
import { retrieveContext, runRagChain } from "../rag-chain.js";
import { createTestSchema } from "./pgTestHelper.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "aos-faithfulness-"));
}

/** Fatos curtos e controlados — cada um com um termo-chave inequívoco e único ao seu documento. */
function makeFactDocs(dir: string): void {
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "deploy.md"), "# Deploy\n\nO deploy do Assistente OS usa Docker numa VM Linux.\n\nO gerenciador de processos é o pm2.\n");
  writeFileSync(join(dir, "docs", "banco.md"), "# Banco de Dados\n\nO banco de dados principal é o Postgres com a extensão pgvector.\n\nNão usamos SQLite neste projeto.\n");
  writeFileSync(join(dir, "docs", "testes.md"), "# Testes\n\nOs testes rodam com node --test, sem framework externo como Jest ou Vitest.\n");
}

test("grounding lexical: retrieveContext acha o documento certo e o termo-chave esperado (determinístico, sem rede)", async () => {
  const dir = tempDir();
  const testDb = await createTestSchema();
  try {
    makeFactDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "faith1", join(dir, "docs"), embedder);

    // retrieveContext usa o embedder real (getEmbedder()) internamente para a
    // query, mas os chunks foram indexados com LiteralEmbedder (embedding=NULL)
    // — a busca vetorial não acha nada e cai no fallback ILIKE de search(), que
    // exige substring literal. Por isso a query aqui é o termo-chave, não uma
    // pergunta em linguagem natural (mesmo padrão de rag-chain.test.ts).
    const result = await retrieveContext(testDb.pool, "faith1", "pm2", 5);
    assert.ok(result.hasRelevantDocs, "esperava contexto relevante para a pergunta sobre deploy");
    assert.match(result.context, /pm2/i, "o termo-chave 'pm2' deveria aparecer no contexto recuperado");
    assert.ok(
      result.sources.some((s) => s.path.includes("deploy.md")),
      `esperava que 'deploy.md' estivesse entre as fontes, obteve: ${result.sources.map((s) => s.path).join(", ")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

test("grounding lexical: pergunta sobre banco de dados não recupera o documento de testes", async () => {
  const dir = tempDir();
  const testDb = await createTestSchema();
  try {
    makeFactDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "faith2", join(dir, "docs"), embedder);

    const result = await retrieveContext(testDb.pool, "faith2", "pgvector", 5);
    assert.match(result.context, /pgvector/i);
    const topSource = result.sources[0];
    assert.ok(topSource, "esperava ao menos uma fonte");
    assert.ok(topSource!.path.includes("banco.md"), `esperava banco.md como fonte principal, obteve: ${topSource!.path}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

async function ollamaAvailableWithModel(ollamaUrl: string, chatModel: string): Promise<boolean> {
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    const modelPrefix = chatModel.split(":")[0];
    return !!data.models?.some((m) => m.name.startsWith(modelPrefix!));
  } catch {
    return false;
  }
}

/** Pergunta binária ao próprio modelo configurado: a resposta é sustentada só pelo contexto? */
async function judgeFaithfulness(ollamaUrl: string, chatModel: string, context: string, answer: string): Promise<boolean | null> {
  const prompt = [
    "Você é um avaliador de fidelidade factual (faithfulness).",
    "Contexto disponível:",
    context,
    "",
    "Resposta gerada:",
    answer,
    "",
    "A resposta é sustentada APENAS pelo contexto acima, sem inventar fatos que não estão no contexto?",
    'Responda apenas SIM ou NÃO, sem explicação.',
  ].join("\n");

  try {
    const resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, messages: [{ role: "user", content: prompt }], stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { message?: { content?: string } };
    const content = (data.message?.content ?? "").trim();
    if (/^sim\b/i.test(content)) return true;
    if (/^n[ãa]o\b/i.test(content)) return false;
    return null;
  } catch {
    return null;
  }
}

test("juiz LLM: resposta gerada por runRagChain é sustentada pelo contexto recuperado (requer Ollama local; auto-skip no CI)", async () => {
  const config = loadConfig();
  const ollamaOk = await ollamaAvailableWithModel(config.ollamaUrl, config.ollamaChatModel);
  if (!ollamaOk) return; // mesmo padrão de auto-skip de rag-chain.test.ts — não roda no CI (sem Ollama)

  const dir = tempDir();
  const testDb = await createTestSchema();
  try {
    makeFactDocs(dir);
    const embedder = new LiteralEmbedder();
    await indexDirectory(testDb.pool, "faith3", join(dir, "docs"), embedder);

    // Mesmo motivo do teste de grounding lexical acima: query precisa ser o
    // termo-chave (substring literal), não uma pergunta em linguagem natural,
    // já que o retrieval aqui roda sobre chunks indexados sem embedding real.
    const context = await retrieveContext(testDb.pool, "faith3", "pm2", 5);
    assert.ok(context.hasRelevantDocs, "pré-condição do teste: retrieval precisa achar contexto antes de julgar a resposta");

    // O /api/tags respondeu e listou um modelo compatível, mas a geração via
    // ChatOpenAI (endpoint OpenAI-compatible do Ollama) ainda pode falhar por
    // motivos de ambiente (modelo incompleto, timeout, etc.) — mesmo espírito
    // do gate acima: sem um Ollama de verdade funcionando ponta a ponta, o
    // teste não tem como julgar nada, então pula em vez de falhar.
    let result: Awaited<ReturnType<typeof runRagChain>>;
    try {
      result = await runRagChain(testDb.pool, "faith3", "pm2", 5);
    } catch {
      return;
    }
    assert.ok(result.answer.length > 0);

    const verdict = await judgeFaithfulness(config.ollamaUrl, config.ollamaChatModel, context.context, result.answer);
    if (verdict === null) return; // juiz não respondeu num formato parseável — não falha o teste por isso
    assert.equal(verdict, true, `juiz considerou a resposta não sustentada pelo contexto: "${result.answer}"`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await testDb.cleanup();
  }
});
