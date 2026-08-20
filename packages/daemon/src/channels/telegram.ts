/**
 * Canal Telegram via Bot API (fetch direto).
 *
 * Conecta ao Telegram usando Bot API - requer token de bot (getBotFather).
 * Mensagens recebidas via polling entram no pipeline de eventos do daemon.
 * Respostas são enviadas de volta via Bot API.
 *
 * Requer: TELEGRAM_ENABLED=true e TELEGRAM_BOT_TOKEN no .env
 * Auth state persistido em ~/.assistant-os/sessions/telegram/
 */
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type WsHub } from "../server.js";
import type { EventRecord, Pool } from "@assistente-os/core";
import { todayISODate } from "@assistente-os/core";
import { addEvent } from "@assistente-os/core";

const POLLING_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 5;

export interface TelegramChannelConfig {
  home: string;
  hub: WsHub;
  pool: Pool;
  defaultSoul?: string;
  soulMap?: Record<string, string>;
  onResponse?: (jid: string, text: string) => Promise<void>;
}

export interface TelegramChannelStatus {
  connected: boolean;
  username?: string;
  jid?: string;
}

export class TelegramChannel extends EventEmitter {
  private config: TelegramChannelConfig;
  private connected = false;
  private username: string | undefined = undefined;
  private jid: string | undefined = undefined;
  private lastUpdateId = 0;
  private consecutiveFailures = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TelegramChannelConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.pollTimer) return;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error("[telegram] TELEGRAM_BOT_TOKEN não definido no .env");
      return;
    }

    this.connected = true;
    this.username = "bot-telegram";
    this.jid = botToken;
    this.consecutiveFailures = 0;

    this.config.hub.broadcast({
      type: "telegram.connected",
      username: this.username,
      jid: this.jid,
    });
    console.log("[telegram] Conectado");

    this.pollTimer = setTimeout(() => this.doPoll(), POLLING_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
    this.username = undefined;
    this.jid = undefined;
    this.config.hub.broadcast({ type: "telegram.disconnected" });
    console.log("[telegram] Desconectado");
  }

  getStatus(): TelegramChannelStatus {
    return { connected: this.connected, username: this.username, jid: this.jid };
  }

  async sendMessage(chatId: string | number, text: string): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
        }),
      });

      if (!resp.ok) {
        const errTxt = await resp.text();
        console.error("[telegram] Erro HTTP sending message:", resp.status, errTxt);
        return false;
      }

      const data: any = await resp.json();
      if (!data.ok) {
        console.error("[telegram] Erro na resposta da API:", data.description);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[telegram] Exceção sending message:", err);
      return false;
    }
  }

  private async doPoll(): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`;
      const params = new URLSearchParams({
        offset: String(this.lastUpdateId + 1),
        limit: "100",
        timeout: "30",
      });
      const fullUrl = `${url}?${params.toString()}`;

      const resp = await fetch(fullUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data: any = await resp.json();
      if (data.ok && data.result && data.result.length > 0) {
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          await this.handleUpdate(update);
        }
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error("[telegram] Muitas falhas de polling, reiniciando...");
          this.stop();
          this.start();
        }
      }

      this.pollTimer = setTimeout(() => this.doPoll(), POLLING_INTERVAL_MS);
    } catch (err) {
      console.error("[telegram] Erro no polling:", err);
      this.consecutiveFailures++;
      this.pollTimer = setTimeout(() => this.doPoll(), POLLING_INTERVAL_MS * 2);
    }
  }

  private async handleUpdate(update: any): Promise<void> {
    try {
      const message = update.message;
      if (!message) return;

      const chatId = String(message.chat.id);
      const from = message.from?.first_name || "unknown";
      const text = message.text || "";
      const isFromBot = message.from?.is_bot === true;

      if (isFromBot || !text || text.startsWith("/")) return;

      let soulId = this.config.defaultSoul ?? "main";
      const map = this.config.soulMap ?? {};
      if (map[chatId]) soulId = map[chatId];

      this.config.hub.broadcast({
        type: "telegram.message",
        from,
        jid: chatId,
        body: text,
        soul: soulId,
        mediaType: null,
        fromMe: false,
      });

      await addEvent(this.config.pool, {
        type: "telegram.message",
        payload: { from, jid: chatId, body: text },
        soul: soulId,
      });

      if (this.config.onResponse) {
        try {
          await this.config.onResponse(chatId, text);
        } catch (err) {
          console.error("[telegram] Erro no onResponse:", err);
        }
      }
    } catch (err) {
      console.error("[telegram] Erro ao processar update:", err);
    }
  }

  async processResponse(eventId: number, stdout: string): Promise<void> {
    // Para Telegram, o stdout é a mensagem de resposta
    // Precisamos saber o chatId - mas como não temos persistência de evento
    // simples, enviamos para o chatId último recebido ou definimos como null
    // Por enquanto, tentamos enviar para o jid configurado
    if (this.jid && this.connected) {
      await this.sendMessage(this.jid, stdout.trim());
    }
  }
}