export interface SttConfig {
  model?: string;
  language?: string;
}

/**
 * Speech-to-Text usando Whisper (local via @xenova/transformers).
 * Roda 100% local, sem API keys.
 */
export class SpeechToText {
  private model: any = null;
  private modelName: string;
  private language: string;
  private loading = false;
  private ready = false;

  constructor(config: SttConfig = {}) {
    this.modelName = config.model ?? "base";
    this.language = config.language ?? "pt";
  }

  /**
   * Carrega o modelo Whisper (lazy loading).
   */
  async load(): Promise<void> {
    if (this.ready || this.loading) return;
    this.loading = true;

    try {
      const transformers = await import("@xenova/transformers");
      transformers.env.allowLocalModels = true;
      this.model = await transformers.pipeline(
        "automatic-speech-recognition",
        `Xenova/whisper-${this.modelName}`,
        {
          quantized: false,
        },
      );
      this.ready = true;
    } catch (err) {
      this.loading = false;
      throw new Error(`Falha ao carregar modelo Whisper: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Transcreve áudio PCM para texto.
   * @param audioBuffer - Buffer de áudio PCM (Float32Array ou Buffer)
   * @param sampleRate - Taxa de amostragem do áudio
   * @returns Texto transcrito
   */
  async transcribe(audioBuffer: Buffer | Float32Array, sampleRate = 16000): Promise<string> {
    if (!this.ready) {
      await this.load();
    }

    const input = audioBuffer instanceof Float32Array
      ? audioBuffer
      : new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / 4);

    const result = await this.model(input, {
      sampling_rate: sampleRate,
      language: this.language,
    });

    return typeof result.text === "string" ? result.text.trim() : "";
  }

  get isReady(): boolean {
    return this.ready;
  }
}
