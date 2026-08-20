/**
 * Adapter LangChain para embeddings do Assistente OS.
 *
 * Bridge entre a interface local Embedder e a interface Embeddings do LangChain.
 * Permite usar os embedders existentes (Ollama, Xenova, Fallback) com
 * retrievers, vector stores e chains do ecossistema LangChain.
 */
import { Embeddings } from "@langchain/core/embeddings";
import type { Embedder } from "./embedders.js";
import { getEmbedder } from "./embedder-provider.js";

/**
 * Adapter que adapta o Embedder local para a interface Embeddings do LangChain.
 * As chamadas são delegadas ao FallbackEmbedder configurado (Xenova + Ollama).
 */
export class AssistenteOSEmbeddings extends Embeddings {
  private inner: Embedder;
  private _dims: number = 768;

  constructor() {
    super({});
    this.inner = getEmbedder();
    this._dims = this.inner.dims();
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.inner.embed(text);
      results.push(vec ?? new Array(this._dims).fill(0));
    }
    return results;
  }

  override async embedQuery(text: string): Promise<number[]> {
    const vec = await this.inner.embed(text);
    return vec ?? new Array(this._dims).fill(0);
  }
}

let instance: AssistenteOSEmbeddings | null = null;

export function getLangChainEmbeddings(): AssistenteOSEmbeddings {
  if (!instance) {
    instance = new AssistenteOSEmbeddings();
  }
  return instance;
}
