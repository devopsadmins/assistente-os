import { VoicePipeline, type VoicePipelineConfig } from "@assistente-os/voice";
import type { WsHub } from "./server.js";

export interface VoiceHandlerConfig {
  home: string;
  hub: WsHub;
  pipeline?: VoicePipelineConfig;
  onChat?: (prompt: string) => Promise<string>;
}

/**
 * Handler de voz para o daemon.
 * Integra o VoicePipeline com o WebSocket hub.
 */
export class VoiceHandler {
  private pipeline: VoicePipeline;
  private hub: WsHub;
  private onChat?: (prompt: string) => Promise<string>;
  private running = false;

  constructor(config: VoiceHandlerConfig) {
    this.hub = config.hub;
    this.onChat = config.onChat;

    this.pipeline = new VoicePipeline(config.pipeline);

    this.pipeline.on("ready", () => {
      this.hub.broadcast({ type: "voice.ready" });
    });

    this.pipeline.on("speech-detected", () => {
      this.hub.broadcast({ type: "voice.speech-detected" });
    });

    this.pipeline.on("speech-ended", () => {
      this.hub.broadcast({ type: "voice.speech-ended" });
    });

    this.pipeline.on("transcribing", () => {
      this.hub.broadcast({ type: "voice.transcribing" });
    });

    this.pipeline.on("transcribed", (text: string) => {
      this.hub.broadcast({ type: "voice.transcribed", text });
    });

    this.pipeline.on("responding", (prompt: string) => {
      this.hub.broadcast({ type: "voice.responding", prompt });
    });

    this.pipeline.on("spoken", () => {
      this.hub.broadcast({ type: "voice.spoken" });
    });

    this.pipeline.on("error", (err: Error) => {
      this.hub.broadcast({ type: "voice.error", error: err.message });
    });

    this.pipeline.on("stopped", () => {
      this.hub.broadcast({ type: "voice.stopped" });
      this.running = false;
    });
  }

  /**
   * Atualiza o handler de chat dinamicamente (ex: por soul do request).
   */
  setOnChat(onChat: (prompt: string) => Promise<string>): void {
    this.onChat = onChat;
  }

  /**
   * Inicia o pipeline de voz.
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (this.onChat) {
      this.pipeline.setPromptHandler(this.onChat);
    }

    await this.pipeline.start();
    this.running = true;
  }

  /**
   * Para o pipeline de voz.
   */
  stop(): void {
    if (!this.running) return;
    this.pipeline.stop();
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
