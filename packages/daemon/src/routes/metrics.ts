/**
 * GET /metrics — exposição Prometheus (E6). Autenticada por Bearer como as demais
 * rotas (o dispatcher já barra sem token quando ASSISTENTE_OS_DAEMON_TOKEN está setado).
 *
 * Antes de responder, atualiza os gauges de fila (agenda/eventos) com uma
 * consulta barata ao kernel.db.
 */
import type { RouteHandler } from "./shared.js";
import { loadConfig, getPool } from "@assistente-os/core";
import { renderMetrics, agendaQueueDepth, eventsPending } from "../observability/metrics.js";

export const handleMetrics: RouteHandler = async (req, res, url, path, context) => {
  if (path !== "/metrics" || req.method !== "GET") return false;

  try {
    const pool = getPool(loadConfig({ home: context.home }).databaseUrl);
    const [{ rows: a }, { rows: e }] = await Promise.all([
      pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM agenda WHERE status = 'pending'"),
      pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM events WHERE status = 'pending'"),
    ]);
    agendaQueueDepth.set(Number(a[0]?.n ?? 0));
    eventsPending.set(Number(e[0]?.n ?? 0));
  } catch {
    /* gauges ficam no último valor; /metrics não deve falhar por causa do DB */
  }

  const { contentType, body } = await renderMetrics();
  res.writeHead(200, { "content-type": contentType });
  res.end(body);
  return true;
};
