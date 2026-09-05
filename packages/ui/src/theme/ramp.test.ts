import { expect, test } from "vitest";
import { parseColor } from "./color";
import {
  RAMP_LIGHTNESS,
  RAMP_STOPS,
  buildRamp,
  contrastRatio,
  passesAA,
  pickForeground,
} from "./ramp";

const SEEDS = ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#64748b", "#000000", "#f59e0b"];

test("RAMP_LIGHTNESS and RAMP_STOPS are 11 and index-aligned", () => {
  expect(RAMP_LIGHTNESS).toHaveLength(11);
  expect(RAMP_STOPS).toHaveLength(11);
  expect(RAMP_STOPS[0]).toBe(50);
  expect(RAMP_STOPS[10]).toBe(950);
});

test("buildRamp: 11 steps, lightness matches targets exactly", () => {
  for (const hex of SEEDS) {
    const ramp = buildRamp(parseColor(hex));
    expect(ramp).toHaveLength(11);
    ramp.forEach((step, i) => expect(step.l).toBeCloseTo(RAMP_LIGHTNESS[i]!, 6));
  }
});

test("buildRamp: lightness strictly decreases", () => {
  const ramp = buildRamp(parseColor("#3b82f6"));
  for (let i = 1; i < ramp.length; i++) {
    expect(ramp[i]!.l).toBeLessThan(ramp[i - 1]!.l);
  }
});

test("buildRamp: hue is held from the seed on every step (for chromatic seeds)", () => {
  const seed = parseColor("#3b82f6");
  for (const step of buildRamp(seed)) {
    if (step.c > 0.02) expect(step.h).toBeCloseTo(seed.h, 4);
  }
});

test("buildRamp: chroma peaks mid-ramp and tapers at the ends", () => {
  const ramp = buildRamp(parseColor("#3b82f6"));
  const mid = ramp[5]!.c;
  expect(mid).toBeGreaterThan(ramp[0]!.c);
  expect(mid).toBeGreaterThan(ramp[10]!.c);
});

// DS5: spec A1 §3.4 wants --accent/--chat-user-bubble (ramp indices 1/2) as
// low-chroma tints (~step 100). Before this fix, a saturated seed at
// CHROMA_CAP produced index 1 at bellCurve(1)*CHROMA_CAP ≈ 0.1425 — ~7x the
// spec's own default (--accent chroma 0.02) and outside the sRGB gamut at
// that lightness. Verifies the ceiling actually holds for the worst case
// (a maximally saturated seed) without flattening lower-chroma seeds.
test("DS5: the 3 lightest ramp steps (indices 0-2) stay low-chroma even for a maximally saturated seed", () => {
  const saturated = parseColor("#3b82f6"); // real seed with high-ish chroma, not synthetic
  const ramp = buildRamp({ ...saturated, c: 0.22 }); // force to CHROMA_CAP — the worst case
  for (const i of [0, 1, 2]) {
    expect(ramp[i]!.c).toBeLessThanOrEqual(0.05);
  }
  // sanity: the fix doesn't touch mid/dark steps — they should still carry
  // meaningfully more chroma than the capped light steps.
  expect(ramp[5]!.c).toBeGreaterThan(ramp[1]!.c);
});

test("DS5: a genuinely low-chroma seed is never clamped up by the tint ceiling", () => {
  const subtle = { l: 0.7, c: 0.01, h: 264 };
  const ramp = buildRamp(subtle);
  // bellCurve(1) * 0.01 is far below TINT_CHROMA_CAP — the cap must not raise it.
  expect(ramp[1]!.c).toBeCloseTo(0.01 * 0.6476, 3);
});

test("buildRamp: near-grey seed produces a near-grey ramp (no injected color)", () => {
  const ramp = buildRamp(parseColor("#808080"));
  for (const step of ramp) expect(step.c).toBeLessThan(0.03);
});

test("contrastRatio: white on black is 21, identical colors is 1", () => {
  expect(contrastRatio(parseColor("white"), parseColor("black"))).toBeCloseTo(21, 0);
  expect(contrastRatio(parseColor("#3b82f6"), parseColor("#3b82f6"))).toBeCloseTo(1, 5);
});

test("passesAA matches the 4.5 threshold", () => {
  expect(passesAA(parseColor("#ffffff"), parseColor("#1d4ed8"))).toBe(true);
  expect(passesAA(parseColor("#93c5fd"), parseColor("#ffffff"))).toBe(false);
});

test("pickForeground returns an AA-passing candidate when one exists", () => {
  const bg = parseColor("#1d4ed8");
  const fg = pickForeground(bg, [parseColor("black"), parseColor("white")]);
  expect(passesAA(fg, bg)).toBe(true);
});
