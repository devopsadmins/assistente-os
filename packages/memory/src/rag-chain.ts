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
  semanticCacheConfig,
  ragSemanticCacheGet,
  ragSemanticCacheSet,
  logSemanticCacheHit,
} from "./rag-semantic-cache.js";
import {
  screenRetrievedChunks,
  ragInjectionMode,
  type ScreenableChunk,
  type RagInjectionFinding,
} from "./rag-injection.js";
import { createHash } from "node:crypto";
import { loadConfig, cache, logger, nextZenApiKey, type Pool } from "@assistente-os/core";

export interface RagChunk {
  doc: string;
  path: string;
  score: number;
  method: "semantic" | "literal" | "hybrid";
  snippet: string;
  /** true quando o chunk passou pelo estágio de reranking (E10 / RAG_RERANK != off). */
  reranked?: boolean;
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
  /** Modo do reranker que rodou nesta recuperação ("off" quando não rodou). */
  rerankMode: "off" | "cross-encoder" | "llm";
  /** Latência do estágio de rerank em ms (undefined quando rerankMode === "off"). */
  rerankMs?: number;
  /** Origem do resultado: "exact"/"semantic" quando veio de cache; undefined quando recuperado agora. */
  cacheHit?: "exact" | "semantic";
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
  // Rodízio entre as chaves Zen registradas (round-robin por chamada).
  const apiKey = useZen ? nextZenApiKey(config)! : process.env.OPENAI_API_KEY || "ollama";
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
  limit = 5,
  opts: { semanticCache?: boolean; embedder?: Embedder } = {},
): Promise<RagContext> {
  // Cache em camadas (E4): dois chats idênticos em janela curta (voz, retries de
  // UI) não repetem embedding + query vetorial. TTL curto — a memória da soul
  // muda com reindex. Degrada em silêncio.
  const poolTag = createHash("sha1")
    .update((pool as unknown as { options?: { connectionString?: string } }).options?.connectionString ?? "")
    .digest("hex")
    .slice(0, 8);
  const discriminants = `${limit}\n${process.env.RAG_RERANK ?? "off"}\n${ragInjectionMode()}`;
  const cacheKey = `rag:${poolTag}:${soul}:${createHash("sha1").update(`${discriminants}\n${query}`).digest("hex")}`;
  try {
    const hit = await cache.get(cacheKey);
    if (hit) return { ...(JSON.parse(hit) as RagContext), cacheHit: "exact" };
  } catch {
    /* cache opcional */
  }

  // `opts.embedder` só é injetado por testes de integração determinísticos
  // (cache semântico, screening×rerank); em produção é sempre `getEmbedder()`.
  const embedder: Embedder = opts.embedder ?? getEmbedder();

  // T2.2: cache semântico (desligado por default). Embeda a query uma vez e a
  // reaproveita — hit se um embedding recente do mesmo bucket estiver a
  // >= threshold de cosseno. `opts.semanticCache === false` opta fora (geração
  // determinística: AIIA/família, e o runner do `os rag eval`).
  const scfg = semanticCacheConfig();
  const useSemantic = scfg.enabled && opts.semanticCache !== false;
  const semanticBucket = useSemantic
    ? createHash("sha1").update(`${poolTag}\n${soul}\n${discriminants}`).digest("hex")
    : "";
  let queryVec: number[] | null | undefined;
  if (useSemantic) {
    queryVec = await embedder.embed(query);
    if (queryVec) {
      const semHit = await ragSemanticCacheGet(semanticBucket, queryVec, scfg.threshold);
      if (semHit) {
        logSemanticCacheHit(semanticBucket, semHit.similarity);
        return { ...(JSON.parse(semHit.payload) as RagContext), cacheHit: "semantic" };
      }
    }
  }

  // E10: com rerank ativo, busca um top-N amplo e reordena par (query, trecho)
  // antes de cortar no `limit`. Com RAG_RERANK=off (default), fetchN == limit.
  const rcfg = rerankConfig(limit);
  const fetchN = rcfg.mode === "off" ? limit : Math.max(rcfg.topN, limit);
  const results = await search(pool, soul, query, embedder, fetchN, queryVec);

  // Epic F: screening de indirect prompt injection ANTES do rerank. No modo
  // rerank=llm o body dos chunks é enviado ao Ollama para pontuar — rodar a
  // triagem depois deixaria conteúdo não-triado chegar a um modelo. Em modo
  // `recusar`, chunks de severidade alta já saem aqui.
  const screenable: ScreenableChunk[] =
    results.length > 0 ? toScreenable(results) : await literalSearchFallback(pool, soul, query, limit);
  const { chunks: screened, findings: injectionFindings } = screenRetrievedChunks(screenable, ragInjectionMode());

  // Rerank sobre o que passou na triagem. `rerank` precisa do body — re-anexa
  // via doc_key a partir do `screenable`.
  const bodyByDoc = new Map(screenable.map((s) => [s.chunk.doc, s.body]));
  let chunks: RagChunk[];
  let rerankMs: number | undefined;
  if (rcfg.mode !== "off" && results.length > 0 && screened.length > 0) {
    const withBody = screened.map((c) => ({ ...c, body: bodyByDoc.get(c.doc) ?? c.snippet }));
    const r0 = Date.now();
    const out = await rerank(query, withBody, { ...rcfg, topK: limit });
    rerankMs = Date.now() - r0;
    chunks = out.map(({ body: _body, ...c }) => ({ ...c, reranked: true }));
  } else {
    chunks = screened.slice(0, limit);
  }

  const context = formatContext(chunks);
  const result: RagContext = {
    context,
    sources: chunks,
    // >= (não >): literalSearchFallback atribui score exatamente 0.5 de propósito
    // (o mesmo valor do gate) — com > estrito, o fallback literal nunca passava.
    hasRelevantDocs: chunks.length > 0 && chunks[0].score >= 0.5,
    injectionFindings,
    rerankMode: rcfg.mode,
    ...(rerankMs !== undefined ? { rerankMs } : {}),
  };
  const serialized = JSON.stringify(result);
  try {
    await cache.set(cacheKey, serialized, 60);
  } catch {
    /* cache opcional */
  }
  if (useSemantic && queryVec) {
    await ragSemanticCacheSet(semanticBucket, queryVec, serialized, scfg.ttlSec);
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
