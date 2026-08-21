import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouterProbe } from "@assistente-os/core";
import type { WsHub, DaemonOptions } from "../server.js";
import type { VoiceHandler } from "../voice.js";
import type { WhatsAppChannel } from "../channels/whatsapp.js";
import type { TelegramChannel } from "../channels/telegram.js";

export interface RequestContext {
  home: string;
  token?: string;
  run: DaemonOptions["run"];
  hub: WsHub;
  webDir: string;
  onEventDone: (event: { id: number; type: string; soul: string | null; status: string }) => void;
  onAgendaDone: (item: { id: number; title: string; soul: string | null; status: string }) => void;
  voiceHandler?: VoiceHandler;
  whatsappChannel?: WhatsAppChannel;
  telegramChannel?: TelegramChannel;
}

/** Handler de rota: retorna true se a requisição foi tratada (resposta já enviada). */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
) => Promise<boolean>;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function readJson(req: IncomingMessage): Promise<{ body: Record<string, unknown> | null; error?: "invalid" | "too_large" }> {
  return new Promise((resolve) => {
    let raw = "";
    let bytes = 0;
    let settled = false;
    const finish = (value: { body: Record<string, unknown> | null; error?: "invalid" | "too_large" }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        req.resume();
        finish({ body: null, error: "too_large" });
        return;
      }
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (settled || !raw.trim()) return finish({ body: null });
      try {
        finish({ body: JSON.parse(raw) as Record<string, unknown> });
      } catch {
        finish({ body: null, error: "invalid" });
      }
    });
    req.on("error", () => finish({ body: null, error: "invalid" }));
  });
}

/** Lê o body cru (Buffer) para verificação de HMAC; respeita o limite de 1 MB. */
export function readRawBody(req: IncomingMessage): Promise<{ body?: Buffer; error?: "invalid" | "too_large" }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: { body?: Buffer; error?: "invalid" | "too_large" }) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        req.resume();
        finish({ error: "too_large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      finish({ body: Buffer.concat(chunks) });
    });
    req.on("error", () => finish({ error: "invalid" }));
  });
}

/**
 * Sonda barata e segura de repetir (não executa o prompt): só o degrau `local`
 * (provider "ollama") tem um jeito de checar disponibilidade sem custo —
 * `GET /api/tags` não roda inferência. Degraus `zen`/`soul` não têm um health
 * check equivalente pelo daemon (dependem do provider configurado no
 * opencode.json), então são considerados disponíveis; falhas reais neles só
 * aparecem na execução de fato (após route() já ter escolhido o degrau).
 */
export function makeLocalFallbackProbe(ollamaUrl: string): RouterProbe {
  return async (target) => {
    if (target.provider !== "ollama") return { ok: true };
    let baseUrl = ollamaUrl;
    if (baseUrl.includes("host.docker.internal")) {
      baseUrl = baseUrl.replace("host.docker.internal", "192.168.65.254");
    }
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? { ok: true } : { ok: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };
}
