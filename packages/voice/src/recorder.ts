import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

export interface RecorderConfig {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  device?: string;
}

export interface RecorderEvents {
  "data": [Buffer];
  "error": [Error];
  "end": [];
}

/**
 * Gravador de áudio PCM do microfone.
 * Usa sox ou similar para capturar áudio em formato raw PCM.
 */
export class AudioRecorder extends EventEmitter {
  private process: ChildProcess | null = null;
  private sampleRate: number;
  private channels: number;
  private bitDepth: number;
  private device?: string;
  private recording = false;

  constructor(config: RecorderConfig = {}) {
    super();
    this.sampleRate = config.sampleRate ?? 16000;
    this.channels = config.channels ?? 1;
    this.bitDepth = config.bitDepth ?? 16;
    this.device = config.device;
  }

  start(): void {
    if (this.recording) return;
    this.recording = true;

    const isWindows = process.platform === "win32";

    // Windows usa -t waveaudio; Linux/macOS usa --default-device
    const inputArgs: string[] = isWindows
      ? ["-t", "waveaudio", this.device ?? "default"]
      : [this.device ?? "--default-device"];

    const args = [
      ...inputArgs,
      "-t", "raw",
      "-r", String(this.sampleRate),
      "-c", String(this.channels),
      "-b", String(this.bitDepth),
      "-e", "signed-integer",
      "-",
    ];

    this.process = spawn("sox", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.emit("data", chunk);
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      // sox escreve progresso no stderr, ignorar mensagens de input info
    });

    this.process.on("error", (err) => {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });

    this.process.on("close", (code) => {
      this.recording = false;
      this.process = null;
      this.emit("end");
    });
  }

  stop(): void {
    if (!this.process) return;
    // Windows não suporta SIGTERM nativamente — usa SIGKILL
    this.process.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
    this.process = null;
    this.recording = false;
  }

  get isRecording(): boolean {
    return this.recording;
  }
}
