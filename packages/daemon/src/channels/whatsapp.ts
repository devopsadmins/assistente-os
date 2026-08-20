/**
 * Canal WhatsApp via Baileys (100% local).
 *
 * Conecta ao WhatsApp via WebSocket multi-device (sem browser).
 * Mensagens recebidas entram no pipeline de eventos do daemon.
 * Respostas são enviadas de volta via Baileys.
 *
 * Suporta dois modos de pareamento:
 *   - QR code (scan via Aparelhos Conectados)
 *   - Código numérico (8 dígitos, via WHATSAPP_PHONE env var)
 *
 * Requer: WHATSAPP_ENABLED=true no .env
 * Auth state persistido em ~/.assistant-os/sessions/whatsapp/
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  type WASocket,
  type proto,
} from "baileys";
import { Boom } from "@hapi/boom";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { WsHub } from "../server.js";
import type { EventRecord, Pool } from "@assistente-os/core";
import { buscarFamiliaPorTelefone } from "@assistente-os/core";

const QR_TERMINAL_MODULE = "qrcode-terminal" as string;
const MAX_CONSECUTIVE_FAILURES = 5;
const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;

export interface WhatsAppChannelConfig {
  home: string;
  hub: WsHub;
  pool: Pool;
  defaultSoul?: string;
  soulMap?: Record<string, string>;
  /** Quando true, resolve famílias por telefone via DB. Quando false, usa soulMap/defaultSoul. */
  familiasEnabled?: boolean;
  addEvent: (input: {
    type: string;
    payload: unknown;
    soul: string;
    signature?: string;
  }) => Promise<EventRecord>;
  onResponse?: (jid: string, text: string) => Promise<void>;
  /** Se informado, usa pareamento por código numérico em vez de QR */
  phoneNumber?: string;
}

export interface WhatsAppChannelStatus {
  connected: boolean;
  phone: string | null;
  qr: string | null;
  jid: string | null;
  pairingCode: string | null;
}

export class WhatsAppChannel extends EventEmitter {
  private sock: WASocket | null = null;
  private config: WhatsAppChannelConfig;
  private status: WhatsAppChannelStatus = {
    connected: false,
    phone: null,
    qr: null,
    jid: null,
    pairingCode: null,
  };
  private authDir: string;
  private mediaDir: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private reconnectAttempts = 0;

  constructor(config: WhatsAppChannelConfig) {
    super();
    this.config = config;
    this.authDir = join(config.home, "sessions", "whatsapp");
    this.mediaDir = join(config.home, "media", "whatsapp");
  }

  async start(): Promise<void> {
    if (this.sock) return;

    mkdirSync(this.authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys),
      },
      version,
      printQRInTerminal: false,
      browser: ["Assistente OS", "Safari", "17.0"],
      generateHighQualityLinkPreview: false,
    });

    this.sock.ev.on("creds.update", () => {
      void saveCreds();
    });

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status.qr = qr;
        this.status.connected = false;
        this.status.pairingCode = null;
        this.consecutiveFailures = 0;
        this.config.hub.broadcast({ type: "whatsapp.qr", qr });
        this.emit("qr", qr);
        this.printQR(qr);

        if (this.config.phoneNumber && this.sock) {
          void this.sock
            .requestPairingCode(this.config.phoneNumber)
            .then((code) => {
              this.status.pairingCode = code;
              this.config.hub.broadcast({ type: "whatsapp.pairing_code", code });
              console.log(`[whatsapp] Código de pareamento: ${code}`);
            })
            .catch((err) => {
              console.error("[whatsapp] Erro ao solicitar código:", err);
            });
        }
      }

      if (connection === "close") {
        this.status.connected = false;
        this.status.phone = null;
        this.status.jid = null;
        this.stopPing();

        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : undefined;

        this.consecutiveFailures++;

        if (statusCode === 515) {
          console.log("[whatsapp] Pairing stream reiniciado (515) — aguardando reconexão");
          this.scheduleReconnect(5000);
          return;
        }

        if (statusCode === 401 && this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.log(`[whatsapp] ${this.consecutiveFailures} falhas 401 — limpando auth state`);
          this.cleanAuthState();
          this.consecutiveFailures = 0;
          this.reconnectAttempts = 0;
          this.config.hub.broadcast({
            type: "whatsapp.disconnected",
            reason: statusCode,
            reconnect: false,
          });
          this.emit("disconnected", statusCode);
          this.scheduleReconnect(5000);
          return;
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (!shouldReconnect) {
          this.config.hub.broadcast({
            type: "whatsapp.disconnected",
            reason: statusCode,
            reconnect: false,
          });
          this.emit("disconnected", statusCode);
          return;
        }

        if (this.consecutiveFailures >= 2) {
          this.config.hub.broadcast({
            type: "whatsapp.disconnected",
            reason: statusCode,
            reconnect: true,
          });
        }

        this.emit("disconnected", statusCode);
        this.scheduleReconnect();
      }

      if (connection === "open") {
        this.status.connected = true;
        this.status.qr = null;
        this.status.pairingCode = null;
        this.consecutiveFailures = 0;
        this.reconnectAttempts = 0;
        this.status.jid = this.sock?.user?.id ?? null;
        this.status.phone = this.sock?.user?.id?.replace(/:.*@/, "@") ?? null;

        this.startPing();
        this.config.hub.broadcast({
          type: "whatsapp.connected",
          phone: this.status.phone,
          jid: this.status.jid,
        });
        this.emit("connected", this.status);
      }
    });

    this.sock.ev.on("messages.upsert", (upsert) => {
      if (upsert.type !== "notify") return;

      for (const msg of upsert.messages) {
        void this.handleMessage(msg);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.status = { connected: false, phone: null, qr: null, jid: null, pairingCode: null };
    this.consecutiveFailures = 0;
    this.reconnectAttempts = 0;
  }

  getStatus(): WhatsAppChannelStatus {
    return { ...this.status };
  }

  async sendMessage(jid: string, text: string): Promise<boolean> {
    if (!this.sock || !this.status.connected) return false;
    try {
      await this.sock.sendMessage(jid, { text });
      return true;
    } catch {
      return false;
    }
  }

  private async handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (msg.key?.fromMe) return;
    if (!msg.message || !msg.key?.remoteJid) return;

    const jid = msg.key.remoteJid;
    if (jid === "status@broadcast") return;

    const m = msg.message;
    const body =
      m.conversation ??
      m.extendedTextMessage?.text ??
      m.buttonsResponseMessage?.selectedButtonId ??
      m.listResponseMessage?.singleSelectReply?.selectedRowId ??
      "";

    const soulId = await this.resolveSoul(jid);
    const from = msg.pushName ?? jid;
    const mediaInfo = this.extractMedia(m);
    const eventBody = body || mediaInfo?.caption || `[${mediaInfo?.type ?? "mensagem"}]`;

    this.config.hub.broadcast({
      type: "whatsapp.message",
      from,
      jid,
      body: eventBody.slice(0, 500),
      soul: soulId,
      mediaType: mediaInfo?.type ?? null,
    });

    try {
      const payload: Record<string, unknown> = { from, jid, body: eventBody, timestamp: msg.messageTimestamp };
      if (mediaInfo) {
        const saved = await this.saveMedia(msg, mediaInfo);
        if (saved) {
          payload.mediaType = mediaInfo.type;
          payload.mediaFile = saved;
          payload.mediaMime = mediaInfo.mimetype;
          if (mediaInfo.caption) payload.caption = mediaInfo.caption;
        }
      }

      const event = await this.config.addEvent({
        type: "whatsapp.message",
        payload,
        soul: soulId,
      });

      if (this.config.onResponse) {
        this.pendingResponses.set(event.id, jid);
      }
    } catch (err) {
      this.config.hub.broadcast({
        type: "whatsapp.error",
        error: err instanceof Error ? err.message : String(err),
        jid,
      });
    }
  }

  private extractMedia(m: proto.IMessage): { type: string; mimetype: string; caption?: string } | null {
    if (m.imageMessage) return { type: "image", mimetype: m.imageMessage.mimetype ?? "image/jpeg", caption: m.imageMessage.caption ?? undefined };
    if (m.audioMessage) return { type: "audio", mimetype: m.audioMessage.mimetype ?? "audio/ogg" };
    if (m.videoMessage) return { type: "video", mimetype: m.videoMessage.mimetype ?? "video/mp4", caption: m.videoMessage.caption ?? undefined };
    if (m.documentMessage) return { type: "document", mimetype: m.documentMessage.mimetype ?? "application/octet-stream", caption: m.documentMessage.fileName ?? undefined };
    return null;
  }

  private async saveMedia(msg: proto.IWebMessageInfo, info: { type: string; mimetype: string }): Promise<string | null> {
    try {
      mkdirSync(this.mediaDir, { recursive: true });
      const ext = this.extFromMime(info.mimetype);
      const filename = `${msg.key?.id ?? Date.now()}${ext}`;
      const filePath = join(this.mediaDir, filename);
      const buffer = await downloadMediaMessage(msg as any, "buffer", {});
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, buffer);
      return filename;
    } catch (err) {
      console.error("[whatsapp] Erro ao salvar mídia:", err);
      return null;
    }
  }

  private extFromMime(mime: string): string {
    if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
    if (mime.includes("png")) return ".png";
    if (mime.includes("gif")) return ".gif";
    if (mime.includes("webp")) return ".webp";
    if (mime.includes("ogg")) return ".ogg";
    if (mime.includes("opus")) return ".opus";
    if (mime.includes("mp4")) return ".mp4";
    if (mime.includes("pdf")) return ".pdf";
    if (mime.includes("zip")) return ".zip";
    return "";
  }

  private pendingResponses = new Map<number, string>();

  async processResponse(eventId: number, stdout: string): Promise<void> {
    const jid = this.pendingResponses.get(eventId);
    if (!jid) return;
    this.pendingResponses.delete(eventId);
    if (stdout.trim()) {
      await this.sendMessage(jid, stdout);
    }
  }

  private async resolveSoul(jid: string): Promise<string> {
    const telefone = jid.replace(/@.*$/, "");

    if (this.config.familiasEnabled) {
      const familia = await buscarFamiliaPorTelefone(this.config.pool, telefone);
      if (familia) return familia.soulId;
    }

    const map = this.config.soulMap ?? {};
    if (map[jid]) return map[jid];
    if (map[telefone]) return map[telefone];

    return this.config.defaultSoul ?? "main";
  }

  private printQR(qr: string): void {
    try {
      const qrt = require(QR_TERMINAL_MODULE) as {
        generate: (qr: string, opts: { small: boolean }, cb: (code: string) => void) => void;
      };
      qrt.generate(qr, { small: true }, (code: string) => {
        console.log("\n" + code);
      });
    } catch {
      console.log(`\n[whatsapp] QR code recebido. Escaneie com o WhatsApp.`);
      console.log(`[whatsapp] QR (raw): ${qr.slice(0, 50)}...`);
    }
  }

  private cleanAuthState(): void {
    try {
      if (existsSync(this.authDir)) {
        rmSync(this.authDir, { recursive: true, force: true });
        mkdirSync(this.authDir, { recursive: true });
        console.log("[whatsapp] Auth state limpo com sucesso");
      }
    } catch (err) {
      console.error("[whatsapp] Erro ao limpar auth state:", err);
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer) return;
    const delay = delayMs ?? Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    console.log(`[whatsapp] reconectando em ${delay}ms (tentativa ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.sock = null;
      void this.start().catch(() => {});
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.sock && this.status.connected) {
        try { (this.sock.ws as any).ping?.(); } catch { /* ignora */ }
      }
    }, PING_INTERVAL_MS);
    if (this.pingTimer.unref) this.pingTimer.unref();
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
