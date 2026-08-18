export interface TtsConfig {
  voice?: string;
  speed?: number;
  volume?: number;
}

/**
 * Text-to-Speech usando say.js.
 * Conversão de texto para áudio no sistema.
 */
export class TextToSpeech {
  private voice: string;
  private speed: number;
  private volume: number;
  private speaking = false;
  private sayModule: any = null;

  constructor(config: TtsConfig = {}) {
    this.voice = config.voice ?? "";
    this.speed = config.speed ?? 1.0;
    this.volume = config.volume ?? 1.0;
  }

  private async loadSay(): Promise<void> {
    if (!this.sayModule) {
      const mod = await import("say");
      // dynamic import() de CJS envolve exports em .default
      this.sayModule = mod.default ?? mod;
    }
  }

  /**
   * Fala o texto fornecido.
   * @param text - Texto para converter em fala
   * @returns Promise que resolve quando terminar de falar
   */
  async speak(text: string): Promise<void> {
    await this.loadSay();
    
    return new Promise((resolve, reject) => {
      if (this.speaking) {
        this.stop();
      }

      this.speaking = true;

      this.sayModule.speak(text, this.voice, this.speed, (err?: Error | null) => {
        this.speaking = false;
        if (err) {
          reject(new Error(`TTS falhou: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Para a fala atual.
   */
  stop(): void {
    if (this.speaking && this.sayModule) {
      this.sayModule.stop();
      this.speaking = false;
    }
  }

  /**
   * Lista vozes disponíveis no sistema.
   */
  async listVoices(): Promise<string[]> {
    await this.loadSay();
    
    return new Promise((resolve) => {
      this.sayModule.getVoices((voices: string[]) => {
        resolve(voices);
      });
    });
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}
