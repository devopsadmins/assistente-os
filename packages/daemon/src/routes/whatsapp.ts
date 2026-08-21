import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { loadConfig, getPool } from "@assistente-os/core";
import { sendJson, readJson, type RequestContext } from "./shared.js";

/**
 * Rotas do canal WhatsApp: histórico, status, envio, mídia, transcrição,
 * e webhooks de aprovação humana (/api/webhooks/whatsapp[/approve]).
 */
export async function handleWhatsapp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home } = context;

  // ── WhatsApp: histórico de mensagens ─────────────────────────────────
  if (req.method === "GET" && path === "/api/whatsapp/messages") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    const limit = Math.min(Number(new URL(req.url!, `http://${req.headers.host}`).searchParams.get("limit")) || 100, 500);
    const { rows } = await pool.query(
      "SELECT id, ts, payload, soul, status FROM events WHERE type = 'whatsapp.message' ORDER BY id DESC LIMIT $1",
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

  // ── WhatsApp: status do canal ────────────────────────────────────────
  if (req.method === "GET" && path === "/api/whatsapp/status") {
    if (!context.whatsappChannel) {
      sendJson(res, 200, { connected: false, phone: null, jid: null });
      return true;
    }
    sendJson(res, 200, context.whatsappChannel.getStatus());
    return true;
  }

  // ── WhatsApp: enviar mensagem ────────────────────────────────────────
  if (req.method === "POST" && path === "/api/whatsapp/send") {
    if (!context.whatsappChannel) {
      sendJson(res, 503, { error: "canal WhatsApp não habilitado" });
      return true;
    }
    const { body } = await readJson(req);
    const jid = body?.jid as string | undefined;
    const text = body?.text as string | undefined;
    if (!jid || !text) {
      sendJson(res, 400, { error: "jid e text obrigatórios" });
      return true;
    }
    const ok = await context.whatsappChannel.sendMessage(jid, text);
    sendJson(res, ok ? 200 : 500, { ok });
    return true;
  }

  // ── WhatsApp: servir mídia ──────────────────────────────────────────
  if (req.method === "GET" && path.startsWith("/api/whatsapp/media/")) {
    const filename = path.slice("/api/whatsapp/media/".length);
    if (!filename || filename.includes("..")) {
      sendJson(res, 400, { error: "filename inválido" });
      return true;
    }
    const config = loadConfig({ home });
    const mediaPath = join(config.home, "media", "whatsapp", normalize(filename));
    if (!existsSync(mediaPath)) {
      sendJson(res, 404, { error: "mídia não encontrada" });
      return true;
    }
    const s = statSync(mediaPath);
    const ext = extname(mediaPath).toLowerCase();
    const types: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".gif": "image/gif", ".webp": "image/webp", ".ogg": "audio/ogg",
      ".opus": "audio/ogg", ".mp4": "video/mp4", ".pdf": "application/pdf",
    };
    res.writeHead(200, {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Content-Length": s.size,
      "Cache-Control": "public, max-age=3600",
    });
    const { createReadStream } = await import("node:fs");
    createReadStream(mediaPath).pipe(res);
    return true;
  }

  // ── WhatsApp: transcrever áudio ────────────────────────────────────
  if (req.method === "POST" && path === "/api/whatsapp/transcribe") {
    const { body } = await readJson(req);
    const eventId = body?.eventId as number | undefined;
    if (!eventId) {
      sendJson(res, 400, { error: "eventId obrigatório" });
      return true;
    }
    try {
      const { execSync } = await import("node:child_process");
      try { execSync("which ffmpeg", { stdio: "ignore" }); } catch {
        try { execSync("/home/support/bin/ffmpeg -version", { stdio: "ignore" }); } catch {
          sendJson(res, 501, { error: "ffmpeg não instalado — apt install ffmpeg" });
          return true;
        }
      }
    } catch {
      sendJson(res, 501, { error: "ffmpeg não instalado — apt install ffmpeg" });
      return true;
    }
    try {
      const { execSync } = await import("node:child_process");
      const config = loadConfig({ home });
      const pool = getPool(config.databaseUrl);
      const { rows } = await pool.query(
        "SELECT payload FROM events WHERE id = $1",
        [eventId],
      );
      if (!rows.length) {
        sendJson(res, 404, { error: "evento não encontrado" });
        return true;
      }
      const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload as string) : rows[0].payload as Record<string, unknown>;
      if (payload.mediaType !== "audio" || !payload.mediaFile) {
        sendJson(res, 400, { error: "evento não é áudio" });
        return true;
      }
      const oggPath = join(config.home, "media", "whatsapp", payload.mediaFile as string);
      const wavPath = oggPath.replace(/\.\w+$/, ".wav");
      let ffmpegCmd = "ffmpeg";
      try { require("node:child_process").execSync("which ffmpeg", { stdio: "ignore" }); } catch {
        ffmpegCmd = "/home/support/bin/ffmpeg";
      }
      execSync(`${ffmpegCmd} -y -i "${oggPath}" -ar 16000 -ac 1 -f f32le "${wavPath}" 2>/dev/null`);
      const { readFileSync, unlinkSync } = await import("node:fs");
      const pcm = readFileSync(wavPath);
      const { SpeechToText } = await import("@assistente-os/voice");
      const stt = new SpeechToText({ model: "base", language: "pt" });
      await stt.load();
      const result = await stt.transcribe(pcm, 16000);
      try { unlinkSync(wavPath); } catch {}
      payload.transcription = result;
      if (!payload.body || payload.body === "[audio]") payload.body = result;
      await pool.query("UPDATE events SET payload = $1 WHERE id = $2", [JSON.stringify(payload), eventId]);
      sendJson(res, 200, { transcription: result });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // ── WhatsApp Webhook Human-in-the-Loop ──────────────────────────────
  if (req.method === "POST" && path === "/api/webhooks/whatsapp") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") {
      sendJson(res, 413, { error: "body excede 1 MB" });
      return true;
    }
    if (parsed.error === "invalid") {
      sendJson(res, 400, { error: "JSON inválido" });
      return true;
    }
    try {
      const { processWhatsAppPayload } = await import("../adapters/whatsapp.js");
      const result = await processWhatsAppPayload(parsed.body);
      if (result.requires_approval) {
        sendJson(res, 200, {
          status: "pending_approval",
          requires_approval: true,
          draft: result.draft,
          session_path: result.session_path,
        });
      } else {
        // Auto-approve: already persisted by processWhatsAppPayload
        sendJson(res, 200, {
          status: "approved",
          message: "Resposta disparada automaticamente",
          session_path: result.session_path,
        });
      }
    } catch (err) {
      console.error("WhatsApp webhook error:", err);
      sendJson(res, 500, { error: "Internal processing error" });
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/webhooks/whatsapp/approve") {
    const parsed = await readJson(req);
    if (parsed.error === "too_large") {
      sendJson(res, 413, { error: "body excede 1 MB" });
      return true;
    }
    if (parsed.error === "invalid") {
      sendJson(res, 400, { error: "JSON inválido" });
      return true;
    }
    try {
      const { anotar } = await import("@assistente-os/core");
      const payload = (parsed.body ?? {}) as { session_path?: string; draft?: string; contato?: string };
      const { session_path, draft, contato } = payload;
      if (!session_path) {
        sendJson(res, 400, { error: "session_path é obrigatório" });
        return true;
      }
      const approvalEntry = `🟢 Aprovação humana confirmada em ${new Date().toISOString()}\nContato: ${contato || "desconhecido"}\nRascunho aprovado:\n${draft || ""}`;
      const soulDirFromSessionPath = session_path.split("/sessoes/")[0] ?? session_path;
      const file = anotar(soulDirFromSessionPath, approvalEntry);
      sendJson(res, 200, { ok: true, arquivo: file, message: "Aprovação registrada" });
    } catch (err) {
      console.error("WhatsApp approve error:", err);
      sendJson(res, 500, { error: "Internal processing error" });
    }
    return true;
  }

  return false;
}
