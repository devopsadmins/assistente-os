/**
 * Integração Sentry do daemon (E6) — opcional e no-op sem `SENTRY_DSN`.
 *
 * `beforeSend` roda o content-filter para não vazar segredo em mensagem de erro.
 * Sem DSN, `initSentry()` não faz nada e `captureError()` só loga.
 */
import * as Sentry from "@sentry/node";
import { logger, sanitizeLLMResponse } from "@assistente-os/core";

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    beforeSend(event) {
      // Mascara segredos em message e exception values.
      if (event.message) event.message = sanitizeLLMResponse(event.message, { taskId: "sentry", soulId: "-" }).sanitized;
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = sanitizeLLMResponse(ex.value, { taskId: "sentry", soulId: "-" }).sanitized;
      }
      return event;
    },
  });
  enabled = true;
  logger.info("[sentry] inicializado");
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const e = err instanceof Error ? err : new Error(String(err));
  if (enabled) {
    Sentry.captureException(e, context ? { extra: context } : undefined);
  } else {
    logger.error({ err: e.message, ...context }, "[error]");
  }
}

export function isSentryEnabled(): boolean {
  return enabled;
}
