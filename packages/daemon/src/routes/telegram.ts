import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, getPool } from "@assistente-os/core";
import { sendJson, readJson, type RequestContext } from "./shared.js";

/** Rotas do canal Telegram: histórico, status, envio. */
export async function handleTelegram(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  // ── Telegram: histórico de mensagens ─────────────────────────────────
  if (req.method === "GET" && path === "/api/telegram/messages") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const limit = Math.min(Number(new URL(req.url!, `http://${req.headers.host}`).searchParams.get("limit")) || 100, 500);
    const { rows } = await pool.query(
      "SELECT id, ts, payload, soul, status FROM events WHERE type = 'telegram.message' ORDER BY id DESC LIMIT $1",
      [limit],
    );
    sendJson(res, 200, rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      payload: r.payload,
      soul: r.soul,
      status: r.status,
    })));
    return true;
  }

  // ── Telegram: status do canal ────────────────────────────────────────
  if (req.method === "GET" && path === "/api/telegram/status") {
    if (!context.telegramChannel) {
      sendJson(res, 200, { connected: false, username: null, jid: null });
      return true;
    }
    sendJson(res, 200, context.telegramChannel.getStatus());
    return true;
  }

  // ── Telegram: enviar mensagem ────────────────────────────────────────
  if (req.method === "POST" && path === "/api/telegram/send") {
    if (!context.telegramChannel) {
      sendJson(res, 503, { error: "canal Telegram não habilitado" });
      return true;
    }
    const { body } = await readJson(req);
    const chatId = body?.chatId as string | number | undefined;
    const text = body?.text as string | undefined;
    if (!chatId || !text) {
      sendJson(res, 400, { error: "chatId e text obrigatórios" });
      return true;
    }
    const ok = await context.telegramChannel.sendMessage(chatId, text);
    sendJson(res, ok ? 200 : 500, { ok });
    return true;
  }

  return false;
}
