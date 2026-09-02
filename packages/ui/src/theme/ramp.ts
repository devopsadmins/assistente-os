import { oklchToSrgb, relativeLuminance } from "./color";
import type { Oklch } from "./types";

export const RAMP_LIGHTNESS: readonly number[] = [
  0.98, 0.95, 0.9, 0.82, 0.72, 0.62, 0.54, 0.46, 0.38, 0.3, 0.22,
];
export const RAMP_STOPS: readonly number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Hard ceiling on chroma so a hyper-saturated seed can't produce neon surfaces. */
const CHROMA_CAP = 0.22;

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
  return RAMP_LIGHTNESS.map((l, i) => ({
    l,
    c: bellCurve(i) * chromaBudget,
    h: seed.h,
  }));
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
