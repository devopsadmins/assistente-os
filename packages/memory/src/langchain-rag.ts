/**
 * Integração RAG com LangChain para o Assistente OS.
 *
 * Fornece funções para:
 * - Buscar contexto relevante via LangChain RAG
 * - Construir prompts com templates LangChain
 * - Executar chains RAG completas
 *
 * Substitui a implementação manual em context.ts do daemon.
 */
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { Embedder } from "./embedders.js";
import { search } from "./indexer.js";
import { getEmbedder } from "./embedder-provider.js";
import type { Pool } from "@assistente-os/core";

export interface RagChunk {
  doc: string;
  path: string;
  score: number;
  method: "semantic" | "literal" | "hybrid";
  snippet: string;
}

export interface RagResult {
  answer: string;
  sources: RagChunk[];
  model: string;
  query: string;
  tokensUsed?: number;
}

export interface RagContext {
  context: string;
  sources: RagChunk[];
  hasRelevantDocs: boolean;
}

function createLLM() {
  const baseUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1";
  const modelName = process.env.OLLAMA_MODEL || "qwen2.5:latest";
  return new ChatOpenAI({
    modelName,
    apiKey: process.env.OPENAI_API_KEY || "ollama",
    configuration: { baseURL: baseUrl },
    temperature: 0,
    maxTokens: 1024,
  });
}

function createRetriever(pool: Pool, soul: string, embedder: Embedder, limit: number) {
  return RunnableLambda.from(async (input: string): Promise<{ context: string; question: string; sources: RagChunk[] }> => {
    const results = await search(pool, soul, input, embedder, limit);

    let chunks: RagChunk[];
    if (results.length > 0) {
      chunks = results.map((r): RagChunk => ({
        doc: r.docKey,
        path: r.path,
        score: r.score,
        method: r.method === "vector" ? "semantic" : "literal",
        snippet: r.body.slice(0, 200),
      }));
    } else {
      chunks = await literalSearchFallback(pool, soul, input, limit);
    }

    const context = formatContext(chunks);
    return { context, question: input, sources: chunks };
  });
}

async function literalSearchFallback(
  pool: Pool,
  soul: string,
  query: string,
  limit: number
): Promise<RagChunk[]> {
  const { rows } = await pool.query(
    `SELECT entity_name AS doc, body, ts AS path
     FROM observations
     WHERE soul = $1 AND (entity_name ILIKE $2 OR body ILIKE $2)
     ORDER BY ts DESC LIMIT $3`,
    [soul, `%${query}%`, limit]
  );

  return rows.map((r: any): RagChunk => ({
    doc: r.doc,
    path: r.path,
    score: 0.5,
    method: "literal",
    snippet: r.body?.slice(0, 200) ?? "",
  }));
}

function formatContext(chunks: RagChunk[]): string {
  if (chunks.length === 0) {
    return "Não foram encontrados documentos relevantes para esta pergunta.";
  }

  const parts: string[] = [];
  chunks.forEach((chunk, i) => {
    parts.push(`--- Documento ${i + 1} (score: ${chunk.score.toFixed(3)}) ---`);
    parts.push(chunk.snippet);
    parts.push("");
  });
  return parts.join("\n");
}

/**
 * Busca contexto relevante para uma pergunta.
 * Retorna o contexto formatado e as fontes encontradas.
 */
export async function retrieveContext(
  pool: Pool,
  soul: string,
  query: string,
  limit = 5
): Promise<RagContext> {
  const embedder: Embedder = getEmbedder();
  const results = await search(pool, soul, query, embedder, limit);

  let chunks: RagChunk[];
  if (results.length > 0) {
    chunks = results.map((r): RagChunk => ({
      doc: r.docKey,
      path: r.path,
      score: r.score,
      method: r.method === "vector" ? "semantic" : "literal",
      snippet: r.body.slice(0, 200),
    }));
  } else {
    chunks = await literalSearchFallback(pool, soul, query, limit);
  }

  const context = formatContext(chunks);
  return {
    context,
    sources: chunks,
    // >= (não >): literalSearchFallback atribui score exatamente 0.5 de propósito
    // (o mesmo valor do gate) — com > estrito, o fallback literal nunca passava.
    hasRelevantDocs: chunks.length > 0 && chunks[0].score >= 0.5,
  };
}

/**
 * Monta e retorna a LCEL chain RAG.
 *
 * A chain pode ser chamada com `.invoke(question)` ou composta com
 * outros runnables do LangChain.
 */
export function buildRagChain(
  pool: Pool,
  soul: string,
  limit = 5
) {
  const embedder: Embedder = getEmbedder();
  const llm = createLLM();
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo."],
    [
      "human",
      `Contexto:\n{context}\n\nPergunta: {question}\n\nResposta:`,
    ],
  ]);
  const retriever = createRetriever(pool, soul, embedder, limit);

  return RunnableSequence.from([
    retriever,
    prompt,
    llm,
    new StringOutputParser(),
  ]);
}

/**
 * Executa a chain RAG completa.
 */
export async function runRagChain(
  pool: Pool,
  soul: string,
  query: string,
  limit = 5
): Promise<RagResult> {
  const embedder: Embedder = getEmbedder();

  const documents = await (async () => {
    const results = await search(pool, soul, query, embedder, limit);
    if (results.length > 0) {
      return results.map((r): RagChunk => ({
        doc: r.docKey,
        path: r.path,
        score: r.score,
        method: r.method === "vector" ? "semantic" : "literal",
        snippet: r.body.slice(0, 200),
      }));
    }
    return await literalSearchFallback(pool, soul, query, limit);
  })();

  if (documents.length === 0) {
    return {
      answer: "Não encontrei informações relevantes sobre isso na base de conhecimento.",
      sources: [],
      model: "hybrid-embedder",
      query,
    };
  }

  const context = formatContext(documents);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Responda à pergunta do usuário com base exclusivamente nas informações fornecidas abaixo."],
    [
      "human",
      `Contexto:\n{context}\n\nPergunta: {question}\n\nResposta:`,
    ],
  ]);
  const llm = createLLM();

  const chain = RunnableSequence.from([
    async () => ({ context, question: query }),
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  const answer = await chain.invoke({});

  return {
    answer: extractAnswer(answer),
    sources: documents,
    model: process.env.OLLAMA_MODEL || "qwen2.5:latest",
    query,
  };
}

function extractAnswer(raw: string): string {
  const marker = "AIMessage: ";
  const idx = raw.indexOf(marker);
  if (idx !== -1) {
    const start = idx + marker.length;
    const end = raw.indexOf("]", start);
    if (end !== -1) {
      return raw.slice(start, end);
    }
  }
  return raw;
}
