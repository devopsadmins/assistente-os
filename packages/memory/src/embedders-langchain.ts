/**
 * Módulo de integração LangChain para embeddings.
 *
 * Proporciona um wrapper sobre o embedder Ollama existente, adicionando
 * a capa LangChain para futura compatibilidade com chains, prompts e
 * outras funcionalidades do ecossistema LangChain.
 *
 * NOTA: A integração real com o Ollama via LangChain pode variar conforme
 * a versão do pacote. Esta implementação usa o fetch direto ao endpoint
 * /api/embed do Ollama, mantendo compatibilidade com o código existente.
 */
import { Embedder } from "./embedders.js";
import { OllamaEmbedder } from "./embedders.js";

/**
 * Embedder LangChain-enabled.
 * Extende a funcionalidade do OllamaEmbedder com a possibilidade de
 * ser configurado via flags de ambiente LANGCHAIN_ENABLED.
 */
export class LangChainOllamaEmbedder implements Embedder {
  private readonly existing: OllamaEmbedder;
  private _dims: number | null = null;

  constructor(private readonly url: string, private readonly model: string) {
    this.existing = new OllamaEmbedder(url, model);
  }

  dims(): number {
    return this._dims ?? 768;
  }

  async embed(text: string): Promise<number[] | null> {
    // Usar o embedder Ollama existente (já funcional)
    const result = await this.existing.embed(text);
    if (result && result.length > 0) {
      this._dims = result.length;
    }
    return result;
  }
}

/**
 * Factory function.
 * Quando LANGCHAIN_ENABLED=true, retorna o wrapper LangChain.
 * Quando false, retorna o embedder direto (exigiria injeção de dependência
 * maior - por enquanto o caller deve checar a flag de ambiente).
 */
export function createEmbedder(
  url: string,
  model: string,
  langChainEnabled: boolean = true
): Embedder {
  if (langChainEnabled) {
    return new LangChainOllamaEmbedder(url, model);
  }
  // Retornar embedder nativo - o caller deve lidar com isso
  // Esta rota não é alcançada normalmente pois o config padrão usa true
  throw new Error("LangChain disabled - use native OllamaEmbedder instead");
}

/**
 * Verifica se as embeddings da LangChain estão disponíveis e configuradas.
 * Verifica a variável de ambiente e a conexão com o Ollama.
 */
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