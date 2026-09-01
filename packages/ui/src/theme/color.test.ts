import { expect, test } from "vitest";
import {
  formatOklch,
  parseColor,
  relativeLuminance,
  srgbToOklch,
  oklchToSrgb,
} from "./color";
import { InvalidBrandColorError } from "./types";

test("parses 6-digit hex", () => {
  const c = parseColor("#3b82f6");
  expect(c.l).toBeGreaterThan(0.5);
  expect(c.l).toBeLessThan(0.72);
  expect(c.c).toBeGreaterThan(0.1);
  expect(c.h).toBeGreaterThan(240);
  expect(c.h).toBeLessThan(275);
});

test("parses 3-digit hex, rgb(), hsl(), oklch(), and named colors equivalently for white", () => {
  for (const s of ["#fff", "#ffffff", "rgb(255,255,255)", "hsl(0 0% 100%)", "oklch(1 0 0)", "white", "  WHITE "]) {
    const c = parseColor(s);
    expect(c.l).toBeCloseTo(1, 2);
    expect(c.c).toBeCloseTo(0, 2);
  }
});

test("parses black to l≈0", () => {
  expect(parseColor("#000000").l).toBeCloseTo(0, 2);
  expect(parseColor("black").l).toBeCloseTo(0, 2);
});

test("discards alpha", () => {
  expect(parseColor("#3b82f680").h).toBeCloseTo(parseColor("#3b82f6").h, 1);
  expect(parseColor("rgba(59,130,246,0.5)").h).toBeCloseTo(parseColor("#3b82f6").h, 1);
});

test("throws InvalidBrandColorError on garbage", () => {
  for (const s of ["potato", "", "#12", "rgb(300)", "not a color", "#gggggg"]) {
    expect(() => parseColor(s)).toThrow(InvalidBrandColorError);
  }
});

test("srgb → oklch → srgb round-trips within tolerance", () => {
  for (const hex of ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#111827"]) {
    const start = parseColor(hex);
    const rgb = oklchToSrgb(start);
    const back = srgbToOklch(rgb);
    expect(back.l).toBeCloseTo(start.l, 2);
    expect(back.c).toBeCloseTo(start.c, 2);
    if (start.c > 0.02) expect(Math.abs(back.h - start.h)).toBeLessThan(2);
  }
});

test("relativeLuminance: white is 1, black is 0, mid-grey ~0.21", () => {
  expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5);
  expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  expect(relativeLuminance({ r: 0.5, g: 0.5, b: 0.5 })).toBeCloseTo(0.214, 2);
});

test("formatOklch emits three space-separated numbers", () => {
  expect(formatOklch({ l: 0.5512, c: 0.1837, h: 264.123 })).toBe("0.5512 0.1837 264.12");
  expect(formatOklch({ l: 1, c: 0, h: 0 })).toBe("1 0 0");
});
