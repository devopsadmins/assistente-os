import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig, getPool, addEvent, verifyRequest, eventStats, recentEvents, type EventRecord } from "@assistente-os/core";
import { processPendingEvents } from "../events.js";
import { sendJson, readRawBody, type RequestContext } from "./shared.js";

/** Webhooks assinados: fila de eventos processados em background. POST/GET /events */
export async function handleEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  context: RequestContext,
): Promise<boolean> {
  const { home, run, hub, onEventDone } = context;

  if (req.method === "POST" && path === "/events") {
    const config = loadConfig({ home });
    if (!config.webhookSecret) {
      sendJson(res, 503, { error: "ASSISTENTE_OS_WEBHOOK_SECRET não configurado; HMAC é obrigatório" });
      return true;
    }
    const raw = await readRawBody(req);
    if (raw.error === "too_large") {
      sendJson(res, 413, { error: "body excede 1 MB" });
      return true;
    }
    if (raw.error === "invalid") {
      sendJson(res, 400, { error: "leitura do body falhou" });
      return true;
    }
    const bodyBuffer = raw.body ?? Buffer.alloc(0);
    const signature = req.headers["x-aos-signature"];
    const ts = req.headers["x-aos-timestamp"];
    const verified = verifyRequest(config.webhookSecret, bodyBuffer, signature as string | undefined, ts as string | undefined);
    if (!verified.ok) {
      sendJson(res, 401, { error: verified.reason });
      return true;
    }
    let body: { type?: unknown; payload?: unknown; soul?: unknown };
    try {
      body = JSON.parse(bodyBuffer.toString("utf8")) as { type?: unknown; payload?: unknown; soul?: unknown };
    } catch {
      sendJson(res, 400, { error: "JSON inválido" });
      return true;
    }
    const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "";
    if (!type) {
      sendJson(res, 400, { error: "type é obrigatório" });
      return true;
    }
    const soul = typeof body.soul === "string" ? body.soul : null;
    const pool = getPool(config.databaseUrl);
    const ev: EventRecord = await addEvent(pool, { type, payload: body.payload, soul, signature: String(signature) });
    // Consumo imediato em background; o loop periódico cobre reinícios/atrasos.
    setImmediate(() => {
      void processPendingEvents({ home, run, onDone: onEventDone }).catch(() => {});
    });
    try {
      hub.broadcast({ type: "event.received", event: ev });
    } catch {
      /* ws opcional */
    }
    sendJson(res, 202, { id: ev.id, status: ev.status, type: ev.type, soul: ev.soul });
    return true;
  }

  if (req.method === "GET" && path === "/events") {
    const config = loadConfig({ home });
    const pool = getPool(config.databaseUrl);
    sendJson(res, 200, { stats: await eventStats(pool), recent: await recentEvents(pool, 20) });
    return true;
  }

  return false;
}
