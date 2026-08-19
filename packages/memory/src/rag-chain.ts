/**
 * Chain RAG padronizada usando LangChain e o grafo de memória do Assistente OS.
 *
 * Fluxo: pergunta → retrieve (busca semântica no grafo de memória) →
 * format context → LLM generate → resposta.
 *
 * Esta chain pode ser chamada diretamente ou integrada com o LangGraph
 * como um dos nós do grafo de agentes.
 */
import { Embedder } from "./embedders.js";
import { search } from "./indexer.js";
import { applyTemplate } from "./prompt-templates.js";
import { getEmbedder } from "./embedder-provider.js";
import type { Pool } from "@assistente-os/core";

/**
 * Interface para o contexto recuperado na busca RAG.
 */
export interface RagChunk {
  doc: string; // chave do documento (soul ou path)
  path: string;
  score: number;
  method: "semantic" | "literal" | "hybrid";
  snippet: string;
}

/**
 * Interface de resultado da chain RAG.
 */
export interface RagResult {
  answer: string;
  sources: RagChunk[];
  model: string;
  query: string;
  tokensUsed?: number;
}

/**
 * Busca de documentos relevantes para a query.
 * Usa o embedder configurado (LangChain ou nativo) e busca no grafo de memória.
 */
async function retrieveDocuments(
  pool: Pool,
  soul: string,
  query: string,
  embedder: Embedder,
  limit = 5
): Promise<RagChunk[]> {
  // 1. Busca no índice real de chunks (pgvector via indexer.search; degrada
  //    para ILIKE internamente se o embedding falhar).
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

  // 2. Complemento: busca literal nas observações do grafo.
  return await literalSearch(pool, soul, query, limit);
}

/**
 * Busca literal como fallback ou complemento.
 */
async function literalSearch(
  pool: Pool,
  soul: string,
  query: string,
  limit: number
): Promise<RagChunk[]> {
  const { rows } = await pool.query(`
    SELECT entity_name AS doc, body, ts AS path
    FROM observations
    WHERE soul = $1
    AND (entity_name ILIKE $2 OR body ILIKE $2)
    ORDER BY ts DESC
    LIMIT $3
  `, [soul, `%${query}%`, limit]);

  return rows.map((r: any): RagChunk => ({
    doc: r.doc,
    path: r.path,
    score: 0.5, // score padrão para literal
    method: "literal",
    snippet: r.body?.slice(0, 200) ?? "",
  }));
}

/**
 * Formata o contexto a partir dos chunks recuperados.
 */
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
 * Executa a chain RAG completa.
 *
 * @param pool Conexão PostgreSQL
 * @param soul ID da soul/consultante
 * @param query Pergunta do usuário
 * @param limit Número máximo de chunks a recuperar
 * @returns Resultado da chain com resposta e fontes
 */
export async function runRagChain(
  pool: Pool,
  soul: string,
  query: string,
  limit = 5
): Promise<RagResult> {
  // 1. Verificar disponibilidade (usar embedder híbrido)
  const embedder: Embedder = getEmbedder();

  // 2. Recuperar documentos relevantes
  const documents = await retrieveDocuments(pool, soul, query, embedder, limit);

  // 3. Verificar se a busca retornou vazio (threshold de relevância)
  if (documents.length === 0) {
    return {
      answer: "Não encontrei informações relevantes sobre isso na base de conhecimento.",
      sources: [],
      model: "hybrid-embedder",
      query,
    };
  }

  // 4. Formatar contexto
  const context = formatContext(documents);

  // 5. Montar prompt para o LLM
  // Usar template padrão; pode ser substituído por outro template baseado em config ou tipo de query
  const systemPrompt = applyTemplate("default", context, query);

  // 6. Em um ambiente real, aqui chamaríamos o LLM (Ollama/OpenAI)
  // Por enquanto, retornamos o contexto formatado como "resposta"
  // e marcamos que precisaria de chamada LLM real

  return {
    answer: `=== CONTEXTO RECUPERADO ===${context}=== FIM DO CONTEXTO ===`,
    sources: documents,
    model: "hybrid-embedder",
    query,
  };
}