/**
 * Métricas Prometheus do daemon (E6).
 *
 * Registry único, prefixo `aos_`. Exposto em `GET /metrics` (Bearer, como as
 * demais rotas). `collectDefaultMetrics` traz event-loop lag / heap / GC.
 *
 * As métricas de token (`aos_tokens_total`) são alimentadas pelo fluxo de chat
 * (E1); as demais por chat / agenda / roteador / segurança.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
registry.setDefaultLabels({ service: "assistente-os" });
collectDefaultMetrics({ register: registry, prefix: "aos_" });

export const chatRequests = new Counter({
  name: "aos_chat_requests_total",
  help: "Turnos de chat processados",
  labelNames: ["soul", "tier", "mode", "status"] as const,
  registers: [registry],
});

export const chatLatency = new Histogram({
  name: "aos_chat_latency_seconds",
  help: "Latência de execução de um turno de chat",
  labelNames: ["tier"] as const,
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 45, 90, 180],
  registers: [registry],
});

export const tokensTotal = new Counter({
  name: "aos_tokens_total",
  help: "Tokens consumidos por chat (prompt/completion)",
  labelNames: ["soul", "tier", "kind", "source"] as const,
  registers: [registry],
});

export const routerFallback = new Counter({
  name: "aos_router_fallback_total",
  help: "Quedas de degrau do roteador (sonda falhou, caiu para o próximo)",
  labelNames: ["from_tier", "to_tier"] as const,
  registers: [registry],
});

export const promptInjectionAlerts = new Counter({
  name: "aos_prompt_injection_alerts_total",
  help: "Alertas do detector de prompt injection",
  labelNames: ["severity"] as const,
  registers: [registry],
});

export const agendaQueueDepth = new Gauge({
  name: "aos_agenda_queue_depth",
  help: "Itens de agenda pendentes",
  registers: [registry],
});

export const eventsPending = new Gauge({
  name: "aos_events_pending",
  help: "Eventos na fila aguardando processamento",
  registers: [registry],
});

/** Corpo da resposta de `GET /metrics`. */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
