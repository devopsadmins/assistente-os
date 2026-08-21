import { LocalXenovaEmbedder } from "./embedder-local.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

export class FallbackEmbedder {
  private xenova: LocalXenovaEmbedder;
  private xenovaFailed: boolean = false;
  private xenovaFailCount: number = 0;
  private readonly MAX_XENOVA_RETRIES = 3;
  private _dims: number = 768;

  constructor() { this.xenova = new LocalXenovaEmbedder(); }

  dims(): number {
    return this._dims;
  }

  /** Retorna null se Xenova E Ollama falharem — caller degrada p/ busca literal. */
  async embed(text: string): Promise<number[] | null> {
    if (!this.xenovaFailed) {
      try {
        return await this.xenova.embed(text);
      } catch (err) {
        this.xenovaFailCount++;
        if (this.xenovaFailCount >= this.MAX_XENOVA_RETRIES) {
          this.xenovaFailed = true;
          console.error("Xenova desativado após falhas consecutivas");
        }
      }
    }
    try {
      return await this.embedWithOllama(text);
    } catch (err) {
      console.error("embedWithOllama falhou (non-fatal, degrada p/ busca literal):", (err as Error).message);
      return null;
    }
  }

  private async embedWithOllama(text: string): Promise<number[]> {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
    });
    if (!response.ok) throw new Error(`Ollama Error: ${response.status}`);
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }
}