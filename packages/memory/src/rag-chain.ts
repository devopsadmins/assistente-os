/**
 * Chain RAG padronizada usando LCEL do LangChain.
 *
 * Fluxo: pergunta → retrieve → format context → ChatPromptTemplate → LLM → resposta.
 *
 * A chain é declarativa via RunnableSequence e pode ser composta com
 * outros runnables do LangChain (ex.: memória, tools, agentes LangGraph).
 */
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { Embedder } from "./embedders.js";
import { search } from "./indexer.js";
import { langchainTemplates } from "./prompt-templates.js";
import { getEmbedder } from "./embedder-provider.js";
import { rerank, rerankConfig } from "./rerank.js";
import {
  screenRetrievedChunks,
  ragInjectionMode,
  type ScreenableChunk,
  type RagInjectionFinding,
} from "./rag-injection.js";
import { createHash } from "node:crypto";
import { loadConfig, cache, logger, type Pool } from "@assistente-os/core";

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
  /** Chunks recuperados que casaram a heurística de prompt injection (E: RAG injection screening). */
  injectionFindings: RagInjectionFinding[];
}

export interface RagContext {
  context: string;
  sources: RagChunk[];
  hasRelevantDocs: boolean;
  /** Chunks recuperados que casaram a heurística de prompt injection (E: RAG injection screening). */
  injectionFindings: RagInjectionFinding[];
}

/**
 * Antes lia process.env.OLLAMA_URL/OLLAMA_MODEL direto com um default
 * ("qwen2.5:latest") que não existe no Ollama local — usa a config
 * canônica (mesma do resto do sistema) em vez de reinventar env vars.
 *
 * Prefere o OpenCode Zen (cloud) quando ZEN_API_KEY estiver configurada,
 * pelo mesmo motivo de agent-workflow.ts — mantém o pipeline retrieve+
 * generate do LangGraph consistente no mesmo provider em vez de misturar
 * Ollama local (retrieve) com Zen (generate).
 */
function createLLM() {
  const config = loadConfig({});
  const useZen = Boolean(config.zenApiKey);
  const baseUrl = useZen ? config.zenBaseUrl : `${config.ollamaUrl.replace(/\/$/, "")}/v1`;
  const modelName = useZen ? config.zenChatModel : config.ollamaChatModel;
  const apiKey = useZen ? config.zenApiKey! : process.env.OPENAI_API_KEY || "ollama";
  return new ChatOpenAI({
    modelName,
    apiKey,
    configuration: { baseURL: baseUrl },
    temperature: 0,
    maxTokens: 1024,
  });
}

/** Monta os `ScreenableChunk` (chunk + body bruto) a partir do resultado do indexer. */
function toScreenable(results: Awaited<ReturnType<typeof search>>): ScreenableChunk[] {
  return results.map((r) => ({
    chunk: {
      doc: r.docKey,
      path: r.path,
      score: r.score,
      method: r.method === "vector" ? "semantic" : "literal",
      snippet: r.body.slice(0, 200),
    } satisfies RagChunk,
    body: r.body,
  }));
}

function createRetriever(pool: Pool, soul: string, embedder: Embedder, limit: number) {
  return RunnableLambda.from(async (input: string): Promise<{ context: string; question: string; sources: RagChunk[] }> => {
    const results = await search(pool, soul, input, embedder, limit);
    const screenable = results.length > 0 ? toScreenable(results) : await literalSearchFallback(pool, soul, input, limit);
    const { chunks } = screenRetrievedChunks(screenable, ragInjectionMode());

    const context = formatContext(chunks);
    return { context, question: input, sources: chunks };
  });
}

async function literalSearchFallback(
  pool: Pool,
  soul: string,
  query: string,
  limit: number
): Promise<ScreenableChunk[]> {
  const { rows } = await pool.query(
    `SELECT entity_name AS doc, body, ts AS path
     FROM observations
     WHERE soul = $1 AND (entity_name ILIKE $2 OR body ILIKE $2)
     ORDER BY ts DESC LIMIT $3`,
    [soul, `%${query}%`, limit]
  );

  return rows.map((r: any): ScreenableChunk => ({
    chunk: {
      doc: r.doc,
      path: r.path,
      score: 0.5,
      method: "literal",
      snippet: r.body?.slice(0, 200) ?? "",
    },
    body: r.body ?? "",
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
  // Cache em camadas (E4): dois chats idênticos em janela curta (voz, retries de
  // UI) não repetem embedding + query vetorial. TTL curto — a memória da soul
  // muda com reindex. Degrada em silêncio.
  const poolTag = createHash("sha1")
    .update((pool as unknown as { options?: { connectionString?: string } }).options?.connectionString ?? "")
    .digest("hex")
    .slice(0, 8);
  const cacheKey = `rag:${poolTag}:${soul}:${createHash("sha1").update(`${limit}\n${process.env.RAG_RERANK ?? "off"}\n${ragInjectionMode()}\n${query}`).digest("hex")}`;
  try {
    const hit = await cache.get(cacheKey);
    if (hit) return JSON.parse(hit) as RagContext;
  } catch {
    /* cache opcional */
  }

  const embedder: Embedder = getEmbedder();
  // E10: com rerank ativo, busca um top-N amplo e reordena par (query, trecho)
  // antes de cortar no `limit`. Com RAG_RERANK=off (default), fetchN == limit.
  const rcfg = rerankConfig(limit);
  const fetchN = rcfg.mode === "off" ? limit : Math.max(rcfg.topN, limit);
  let results = await search(pool, soul, query, embedder, fetchN);
  if (rcfg.mode !== "off" && results.length > 0) {
    results = await rerank(query, results, { ...rcfg, topK: limit });
  }

  const screenable: ScreenableChunk[] =
    results.length > 0 ? toScreenable(results) : await literalSearchFallback(pool, soul, query, limit);

  // Screening de indirect prompt injection sobre o body bruto de cada chunk,
  // antes do assembly do prompt. Em modo `recusar`, chunks de severidade alta
  // são descartados aqui (não abortam a chamada).
  const { chunks, findings: injectionFindings } = screenRetrievedChunks(screenable, ragInjectionMode());

  const context = formatContext(chunks);
  const result: RagContext = {
    context,
    sources: chunks,
    // >= (não >): literalSearchFallback atribui score exatamente 0.5 de propósito
    // (o mesmo valor do gate) — com > estrito, o fallback literal nunca passava.
    hasRelevantDocs: chunks.length > 0 && chunks[0].score >= 0.5,
    injectionFindings,
  };
  try {
    await cache.set(cacheKey, JSON.stringify(result), 60);
  } catch {
    /* cache opcional */
  }
  return result;
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
  const prompt = langchainTemplates.default;
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
 *
 * Mantém a interface existente para retrocompatibilidade com advanced-rag.ts
 * e agent-workflow.ts.
 */
export async function runRagChain(
  pool: Pool,
  soul: string,
  query: string,
  limit = 5
): Promise<RagResult> {
  const embedder: Embedder = getEmbedder();

  const results = await search(pool, soul, query, embedder, limit);
  const screenable: ScreenableChunk[] =
    results.length > 0 ? toScreenable(results) : await literalSearchFallback(pool, soul, query, limit);
  const { chunks: documents, findings: injectionFindings } = screenRetrievedChunks(screenable, ragInjectionMode());
  if (injectionFindings.length > 0) {
    // Sem sessionId aqui para o audit trail — o backstop deste caminho (agente
    // LangGraph) é authorizeExecution() antes de qualquer tool. Só registra o sinal.
    logger.warn(
      `[prompt-injection] ${injectionFindings.length} chunk(s) de RAG com padrão de injection na soul ${soul} (runRagChain)`,
    );
  }

  if (documents.length === 0) {
    return {
      answer: "Não encontrei informações relevantes sobre isso na base de conhecimento.",
      sources: [],
      model: "hybrid-embedder",
      query,
      injectionFindings,
    };
  }

  const context = formatContext(documents);
  const prompt = langchainTemplates.default;
  const llm = createLLM();

  const chain = RunnableSequence.from([
    async () => ({ context, question: query }),
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  const answer = await chain.invoke({});
  const usedConfig = loadConfig({});

  return {
    answer,
    sources: documents,
    model: usedConfig.zenApiKey ? usedConfig.zenChatModel : usedConfig.ollamaChatModel,
    query,
    injectionFindings,
  };
}
