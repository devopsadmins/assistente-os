import { oklchToSrgb, relativeLuminance } from "./color";
import type { Oklch } from "./types";

export const RAMP_LIGHTNESS: readonly number[] = [
  0.98, 0.95, 0.9, 0.82, 0.72, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22,
];
export const RAMP_STOPS: readonly number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Hard ceiling on chroma so a hyper-saturated seed can't produce neon surfaces. */
const CHROMA_CAP = 0.22;

/**
 * DS5: additional, lower chroma ceiling for the ramp's 3 lightest steps
 * (indices 0-2 — RAMP_STOPS 50/100/200, the light "tint" surfaces used by
 * `--accent`/`--chat-user-bubble` in derive.ts). `bellCurve`'s 0.35 floor
 * keeps far more chroma than a "baixo chroma" tint should show for a
 * saturated seed: at a maxed-out `CHROMA_CAP`, index 1 (accent) came out at
 * `bellCurve(1) * CHROMA_CAP ≈ 0.647 * 0.22 ≈ 0.1425` — ~7x more saturated
 * than the spec's own default (`--accent: 0.96 0.02 264`, chroma 0.02) and,
 * combined with that step's high lightness (0.95), outside the sRGB gamut.
 * `Math.min` only ever pulls chroma *down* — a genuinely low-chroma seed is
 * never clamped up to this ceiling, so brand differentiation on subtler
 * seeds is unaffected.
 */
const TINT_CHROMA_CAP = 0.05;
const TINT_INDICES = new Set([0, 1, 2]);

/** Bell over indices 0..10, peak 1.0 at index 5, ~0.35 at the ends. */
function bellCurve(i: number): number {
  const peak = 5;
  const sigma = 3.2;
  const base = Math.exp(-((i - peak) ** 2) / (2 * sigma * sigma));
  const floor = 0.35;
  return floor + (1 - floor) * base;
}

export function buildRamp(seed: Oklch): Oklch[] {
  const chromaBudget = Math.min(seed.c, CHROMA_CAP);
  return RAMP_LIGHTNESS.map((l, i) => {
    const raw = bellCurve(i) * chromaBudget;
    return { l, c: TINT_INDICES.has(i) ? Math.min(raw, TINT_CHROMA_CAP) : raw, h: seed.h };
  });
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(oklchToSrgb(a));
  const lb = relativeLuminance(oklchToSrgb(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function passesAA(fg: Oklch, bg: Oklch): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

export function pickForeground(bg: Oklch, candidates: Oklch[]): Oklch {
  for (const c of candidates) {
    if (passesAA(c, bg)) return c;
  }
  return [...candidates].sort((x, y) => contrastRatio(y, bg) - contrastRatio(x, bg))[0]!;
}
