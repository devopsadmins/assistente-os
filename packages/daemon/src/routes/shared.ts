import type { IncomingMessage, ServerResponse } from "node:http";
import { z, type ZodType } from "zod";
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

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * SPEC-EP2 Frente 2 (2026-09-05): lê o body (limite de 1 MB de `readJson`) e
 * valida contra um schema Zod num só lugar — antes, cada rota reimplementava
 * `typeof body.x === "string" ? ... : default` à mão, sem validação real (só
 * coerção silenciosa pra um fallback). Em caso de falha devolve 400/413 com
 * mensagem PT-BR já pronta pra `sendJson`; em caso de sucesso devolve `data`
 * já tipado e validado pelo schema (com `.trim()`/`.default()` etc. do
 * schema aplicados).
 */
export async function parseBody<T>(req: IncomingMessage, schema: ZodType<T, z.ZodTypeDef, unknown>): Promise<ParsedBody<T>> {
  const { body, error } = await readJson(req);
  if (error === "too_large") return { ok: false, status: 413, error: "body excede 1 MB" };
  if (error === "invalid") return { ok: false, status: 400, error: "JSON inválido" };
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { ok: false, status: 400, error: `corpo inválido — ${detail}` };
  }
  return { ok: true, data: result.data };
}

/**
 * String obrigatória, aparada (trim); em branco ou de outro tipo → erro de
 * validação (400 via `parseBody`). Espelha o padrão que já era o de fato do
 * daemon (`typeof x === "string" && x.trim()`), só que agora rejeitado em vez
 * de silenciosamente virar `""`.
 */
export function requiredTrimmedString(message = "obrigatório"): ZodType<string, z.ZodTypeDef, unknown> {
  return z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, message));
}

/**
 * String opcional, aparada; ausente/`null`/string em branco → `null` (não
 * `undefined`) — os call sites downstream (`addAgendaItem` etc.) já esperam
 * `string | null`. Um tipo errado (número, array, objeto) ainda é rejeitado
 * como erro de validação — antes virava `null` silenciosamente.
 */
export function optionalTrimmedString(): ZodType<string | null, z.ZodTypeDef, unknown> {
  return z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().nullish())
    .transform((v) => v ?? null);
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
