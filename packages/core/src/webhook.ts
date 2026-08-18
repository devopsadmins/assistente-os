import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookVerify {
  ok: boolean;
  reason?: string;
}

/** Assina um corpo usando HMAC-SHA256 sobre "ts.corpo" (antienvelhecimento). */
export function signRequest(secret: string, body: Buffer | string, ts: string): string {
  const raw = typeof body === "string" ? body : body.toString("utf8");
  return createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
}

/**
 * Verifica um webhook: exige X-Aos-Signature (sha256=<hex>) e X-Aos-Timestamp
 * dentro da janela. Comparação em tempo constante evita timing attacks.
 */
export function verifyRequest(
  secret: string,
  body: Buffer | string,
  signature: string | undefined,
  ts: string | undefined,
  windowMs = 300_000,
): WebhookVerify {
  if (!signature || !ts) {
    return { ok: false, reason: "cabeçalhos X-Aos-Signature e X-Aos-Timestamp são obrigatórios" };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > windowMs) {
    return { ok: false, reason: "X-Aos-Timestamp fora da janela de validade" };
  }
  const [algo, hex] = signature.split("=", 2);
  if (algo !== "sha256" || !hex || !/^[0-9a-f]{64}$/.test(hex)) {
    return { ok: false, reason: "formato de assinatura inválido (esperado sha256=<hex>)" };
  }
  const expected = signRequest(secret, body, ts);
  const a = Buffer.from(hex, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "assinatura inválida" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}
