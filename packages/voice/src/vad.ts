import { EventEmitter } from "node:events";

export interface VadConfig {
  /** Threshold de energia RMS para considerar fala (0-1). Default: 0.015 */
  threshold?: number;
  sampleRate?: number;
  /** Frames consecutivos com energia acima do threshold para disparar speech-start. Default: 6 (~190ms) */
  positiveSpeechFrames?: number;
  /** Frames consecutivos com energia abaixo do threshold para disparar speech-end. Default: 20 (~625ms) */
  negativeSpeechFrames?: number;
  /** @deprecated use threshold */
  positiveSpeechThreshold?: number;
  /** @deprecated use threshold */
  negativeSpeechThreshold?: number;
}

export interface VadEvents {
  "speech-start": [];
  "speech-end": [];
  "error": [Error];
}

/**
 * Voice Activity Detection (VAD) com histerese.
 * Usa contagem de frames consecutivos para evitar disparos falsos por ruído.
 */
export class VoiceActivityDetector extends EventEmitter {
  private running = false;
  private speaking = false;
  private threshold: number;
  private sampleRate: number;
  private positiveSpeechFrames: number;
  private negativeSpeechFrames: number;
  private positiveCounter = 0;
  private negativeCounter = 0;

  constructor(config: VadConfig = {}) {
    super();
    // Threshold mais baixo que 0.5 original — PCM 16-bit normalizado tem valores pequenos
    this.threshold = config.threshold
      ?? config.positiveSpeechThreshold  // compat legado
      ?? 0.015;
    this.sampleRate = config.sampleRate ?? 16000;
    // ~190ms de fala contínua para disparar (a 16kHz com chunks de ~512 samples ≈ 32ms/chunk = 6 frames)
    this.positiveSpeechFrames = config.positiveSpeechFrames ?? 6;
    // ~625ms de silêncio contínuo para declarar fim de fala
    this.negativeSpeechFrames = config.negativeSpeechFrames ?? 20;
  }

  /**
   * Processa um chunk de áudio PCM e detecta fala com histerese.
   * Retorna true se há fala ativa.
   */
  processAudio(chunk: Float32Array): boolean {
    if (!this.running) return false;

    // Calcula energia RMS do chunk
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) {
      sumSquares += chunk[i]! * chunk[i]!;
    }
    const rms = Math.sqrt(sumSquares / chunk.length);

    if (rms > this.threshold) {
      this.positiveCounter++;
      this.negativeCounter = 0;

      if (!this.speaking && this.positiveCounter >= this.positiveSpeechFrames) {
        this.speaking = true;
        this.positiveCounter = 0;
        this.emit("speech-start");
      }
    } else {
      this.negativeCounter++;
      this.positiveCounter = 0;

      if (this.speaking && this.negativeCounter >= this.negativeSpeechFrames) {
        this.speaking = false;
        this.negativeCounter = 0;
        this.emit("speech-end");
      }
    }

    return this.speaking;
  }

  start(): void {
    this.running = true;
    this.speaking = false;
    this.positiveCounter = 0;
    this.negativeCounter = 0;
  }

  stop(): void {
    this.running = false;
    if (this.speaking) {
      this.speaking = false;
      this.emit("speech-end");
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}
