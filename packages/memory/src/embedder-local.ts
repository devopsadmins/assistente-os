import { pipeline } from "@xenova/transformers";

const XENOVA_MODEL = "Xenova/multilingual-e5-base";
const XENOVA_DIMENSIONS = 768;

export class LocalXenovaEmbedder {
  private extractor: any;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    await this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      console.info({ model: XENOVA_MODEL }, "Inicializando embedder Xenova local");
      this.extractor = await pipeline("feature-extraction", XENOVA_MODEL);
      this.initialized = true;
      console.info({ model: XENOVA_MODEL, dimensions: XENOVA_DIMENSIONS }, "Embedder Xenova pronto");
    } catch (err) {
      console.error({ err, model: XENOVA_MODEL }, "Falha ao inicializar embedder Xenova");
      throw err;
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    const output = await this.extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();
    const outputs = await this.extractor(texts, { pooling: "mean", normalize: true });
    const data = outputs.data as Float32Array;
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * XENOVA_DIMENSIONS;
      const end = start + XENOVA_DIMENSIONS;
      results.push(Array.from(data.slice(start, end)));
    }
    return results;
  }

  isReady(): boolean { return this.initialized; }
  getDimensions(): number { return XENOVA_DIMENSIONS; }
}