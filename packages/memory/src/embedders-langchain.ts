/**
 * Re-export do adapter LangChain de embeddings.
 * Mantido para retrocompatibilidade com imports existentes.
 */
export { AssistenteOSEmbeddings, getLangChainEmbeddings } from "./embedder-langchain.js";

import { getLangChainEmbeddings } from "./embedder-langchain.js";
import type { Embedder } from "./embedders.js";

/**
 * Embedder compatível com a interface local que delega ao adapter LangChain.
 */
export class LangChainOllamaEmbedder implements Embedder {
  private lc = getLangChainEmbeddings();

  constructor(_url: string, _model: string) {}

  dims(): number {
    return 768;
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      return await this.lc.embedQuery(text);
    } catch {
      return null;
    }
  }
}

export function createEmbedder(
  url: string,
  model: string,
  langChainEnabled: boolean = true
): Embedder {
  if (langChainEnabled) {
    return new LangChainOllamaEmbedder(url, model);
  }
  throw new Error("LangChain disabled - use native OllamaEmbedder instead");
}

export async function checkLangChainAvailability(): Promise<{
  enabled: boolean;
  ollamaReachable: boolean;
  model: string;
}> {
  const langChainEnabled = process.env.LANGCHAIN_ENABLED !== "false";
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "nomic-embed-text";

  let ollamaReachable = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    ollamaReachable = res.ok;
  } catch {
    // Ollama não reachable
  }

  return {
    enabled: langChainEnabled,
    ollamaReachable,
    model,
  };
}
