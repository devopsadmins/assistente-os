import { EventEmitter } from "node:events";
import { VoiceActivityDetector, type VadConfig } from "./vad.js";
import { AudioRecorder, type RecorderConfig } from "./recorder.js";
import { SpeechToText, type SttConfig } from "./stt.js";
import { TextToSpeech, type TtsConfig } from "./tts.js";

export interface VoicePipelineConfig {
  vad?: VadConfig;
  recorder?: RecorderConfig;
  stt?: SttConfig;
  tts?: TtsConfig;
  silenceTimeoutMs?: number;
  maxRecordingMs?: number;
}

export interface VoicePipelineEvents {
  "ready": [];
  "listening": [];
  "speech-detected": [];
  "speech-ended": [];
  "transcribing": [];
  "transcribed": [string];
  "responding": [string];
  "spoken": [];
  "error": [Error];
  "stopped": [];
}

/**
 * Pipeline completo de voz: VAD → Recorder → STT → TTS.
 * Orquestra todos os componentes para experiência tipo JARVIS.
 */
export class VoicePipeline extends EventEmitter {
  private vad: VoiceActivityDetector;
  private recorder: AudioRecorder;
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private silenceTimeoutMs: number;
  private maxRecordingMs: number;
  private running = false;
  private speaking = false;    // TTS falando (não gravar)
  private recording = false;   // Voz detectada, acumulando áudio
  private silenceTimer: NodeJS.Timeout | null = null;
  private recordingTimer: NodeJS.Timeout | null = null;
  private onPrompt?: (prompt: string) => Promise<string>;
  private audioChunks: Buffer[] = [];
  private frameCount = 0; // para log periódico de RMS

  constructor(config: VoicePipelineConfig = {}) {
    super();
    this.vad = new VoiceActivityDetector(config.vad);
    this.recorder = new AudioRecorder(config.recorder);
    this.stt = new SpeechToText(config.stt);
    this.tts = new TextToSpeech(config.tts);
    this.silenceTimeoutMs = config.silenceTimeoutMs ?? 2000;
    this.maxRecordingMs = config.maxRecordingMs ?? 30000;
  }

  /**
   * Define o callback para processar prompts transcritos.
   */
  setPromptHandler(handler: (prompt: string) => Promise<string>): void {
    this.onPrompt = handler;
  }

  /**
   * Inicia o pipeline de voz.
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log("🎤 Carregando modelo Whisper...");
    await this.stt.load();

    this.setupVadListeners();
    this.setupRecorderListeners();

    this.vad.start();
    this.recorder.start();
    this.running = true;

    console.log("✅ Pipeline de voz iniciado. Fale algo...");
    this.emit("ready");
  }

  private setupVadListeners(): void {
    this.vad.on("speech-start", () => {
      console.log("🔊 Fala detectada!");
      this.emit("speech-detected");
      this.startRecording();
    });

    this.vad.on("speech-end", () => {
      console.log("🔇 Fim da fala detectado.");
      this.emit("speech-ended");
      this.stopRecording();
    });
  }

  private setupRecorderListeners(): void {
    this.recorder.on("data", (chunk: Buffer) => {
      // Processa VAD em todos os frames
      this.processAudioForVad(chunk);

      // Só acumula áudio enquanto está em modo de gravação ativa (após speech-start)
      if (this.recording) {
        this.audioChunks.push(chunk);
      }
    });

    this.recorder.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private processAudioForVad(chunk: Buffer): void {
    // Converte Buffer para Float32Array (PCM 16-bit LE → float normalizado)
    const float32 = new Float32Array(chunk.length / 2);
    for (let i = 0; i < chunk.length; i += 2) {
      float32[i / 2] = chunk.readInt16LE(i) / 32768;
    }

    // Log periódico de RMS para calibração do threshold (a cada 100 frames)
    this.frameCount++;
    if (this.frameCount % 100 === 0) {
      let ss = 0;
      for (let i = 0; i < float32.length; i++) ss += float32[i]! * float32[i]!;
      const rms = Math.sqrt(ss / float32.length);
      console.log(`[VAD] RMS=${rms.toFixed(5)} recording=${this.recording} speaking=${this.speaking}`);
    }

    // Envia para VAD processar
    this.vad.processAudio(float32);
  }

  private startRecording(): void {
    if (this.recording || this.speaking) return;

    this.recording = true;
    this.audioChunks = [];
    this.clearTimers();

    // Timeout máximo de gravação
    this.recordingTimer = setTimeout(() => {
      console.log("⏰ Timeout máximo de gravação atingido.");
      this.stopRecording();
    }, this.maxRecordingMs);
  }

  private stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    this.clearTimers();

    const audioBuffer = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    // Ignora áudio muito curto (~250ms mínimo a 16kHz, 16-bit mono)
    if (audioBuffer.length < 8000) {
      console.log(`⚠️ Áudio muito curto (${audioBuffer.length} bytes), ignorado.`);
      return;
    }

    this.processTranscription(audioBuffer);
  }

  private async processTranscription(audioBuffer: Buffer): Promise<void> {
    try {
      console.log("📝 Transcrevendo áudio...");
      this.emit("transcribing");

      // audioBuffer é PCM 16-bit LE bruto (mesmo formato de processAudioForVad) —
      // stt.transcribe() espera Float32Array normalizado; passar o Buffer direto
      // faz reinterpretar os bytes como float32 sem converter (ruído/tamanho errado).
      const float32 = new Float32Array(audioBuffer.length / 2);
      for (let i = 0; i < audioBuffer.length; i += 2) {
        float32[i / 2] = audioBuffer.readInt16LE(i) / 32768;
      }

      const text = await this.stt.transcribe(float32, 16000);

      if (!text.trim()) {
        console.log("⚠️ Nenhum texto detectado na transcrição.");
        return;
      }

      console.log(`💬 Transcrito: "${text}"`);
      this.emit("transcribed", text);

      if (this.onPrompt) {
        // Não awaita aqui para não bloquear o pipeline durante a resposta
        this.handleResponse(text).catch((err) => {
          console.error("[pipeline] Erro em handleResponse:", err);
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      console.error("[pipeline] Erro em processTranscription:", err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async handleResponse(prompt: string): Promise<void> {
    try {
      console.log("🤖 Gerando resposta...");
      this.emit("responding", prompt);

      const response = await this.onPrompt!(prompt);

      console.log(`🔊 Falando resposta: "${response.slice(0, 100)}..."`);
      this.speaking = true;
      await this.tts.speak(response);
      this.speaking = false;

      console.log("✅ Resposta falada com sucesso.");
      this.emit("spoken");
    } catch (err) {
      this.speaking = false;
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private clearTimers(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  /**
   * Para o pipeline de voz.
   */
  stop(): void {
    if (!this.running) return;

    this.vad.stop();
    this.recorder.stop();
    this.tts.stop();
    this.clearTimers();
    this.running = false;

    console.log("🛑 Pipeline de voz parado.");
    this.emit("stopped");
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}
