import { InvalidBrandColorError, type Oklch } from "./types";

type Rgb = { r: number; g: number; b: number };

// ── Curated CSS named colors (lowercase → hex). Enough for brand primaries. ──
const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080",
  gray: "#808080", grey: "#808080", teal: "#008080", cyan: "#00ffff",
  magenta: "#ff00ff", pink: "#ffc0cb", indigo: "#4b0082", violet: "#ee82ee",
  navy: "#000080", maroon: "#800000", lime: "#00ff00", olive: "#808000",
  silver: "#c0c0c0", gold: "#ffd700", coral: "#ff7f50", crimson: "#dc143c",
};

// ── sRGB companding ──
function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// ── WCAG 2.1 relative luminance ──
export function relativeLuminance(rgb: Rgb): number {
  const r = srgbToLinear(clamp01(rgb.r));
  const g = srgbToLinear(clamp01(rgb.g));
  const b = srgbToLinear(clamp01(rgb.b));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ── linear sRGB ↔ OKLab (Björn Ottosson's matrices) ──
function linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
function oklabToLinearSrgb(L: number, a: number, bb: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function srgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(clamp01(rgb.r));
  const g = srgbToLinear(clamp01(rgb.g));
  const b = srgbToLinear(clamp01(rgb.b));
  const lab = linearSrgbToOklab(r, g, b);
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = c < 1e-6 ? 0 : (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.L, c, h };
}

export function oklchToSrgb(color: Oklch): Rgb {
  const hr = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hr);
  const b = color.c * Math.sin(hr);
  const lin = oklabToLinearSrgb(color.l, a, b);
  return {
    r: clamp01(linearToSrgb(lin.r)),
    g: clamp01(linearToSrgb(lin.g)),
    b: clamp01(linearToSrgb(lin.b)),
  };
}

// ── Parsing ──
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function nums(body: string): number[] {
  return body
    .replace(/,/g, " ")
    .replace(/\//g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t)));
}
function hexToRgb(hex: string): Rgb | null {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split("").map((ch) => ch + ch).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}
function hslToRgb(hDeg: number, s: number, l: number): Rgb {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3), g: hue(h), b: hue(h - 1 / 3) };
}

export function parseColor(input: string): Oklch {
  if (typeof input !== "string") throw new InvalidBrandColorError(`not a string: ${String(input)}`);
  const raw = input.trim().toLowerCase();
  if (raw === "") throw new InvalidBrandColorError("empty color string");

  const named = NAMED[raw];
  const s = named ?? raw;

  try {
    if (s.startsWith("#")) {
      const rgb = hexToRgb(s);
      if (!rgb) throw new Error("bad hex");
      return srgbToOklch(rgb);
    }
    const fn = s.match(/^(rgb|rgba|hsl|hsla|oklch)\((.*)\)$/);
    if (fn) {
      const kind = fn[1]!;
      const parts = nums(fn[2]!);
      if (kind === "rgb" || kind === "rgba") {
        if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) throw new Error("bad rgb");
        // rgb() values may be 0–255 or 0–1 (if given as %, nums() already scaled to 0–1)
        const scale = (n: number) => (n > 1 ? n / 255 : n);
        return srgbToOklch({ r: scale(parts[0]!), g: scale(parts[1]!), b: scale(parts[2]!) });
      }
      if (kind === "hsl" || kind === "hsla") {
        if (parts.length < 3 || parts.some((n, i) => i < 3 && Number.isNaN(n))) throw new Error("bad hsl");
        // nums() scaled the % on s/l to 0–1; hue stays as degrees
        return srgbToOklch(hslToRgb(parts[0]!, parts[1]!, parts[2]!));
      }
      // oklch(L C H)
      if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) throw new Error("bad oklch");
      let h = parts[2]!;
      h = ((h % 360) + 360) % 360;
      return { l: clamp01(parts[0]!), c: Math.max(0, parts[1]!), h };
    }
    throw new Error("unrecognized format");
  } catch {
    throw new InvalidBrandColorError(`could not parse color: ${JSON.stringify(input)}`);
  }
}

export function formatOklch(color: Oklch): string {
  const l = round(color.l, 4);
  const c = round(color.c, 4);
  const h = color.c < 1e-6 ? 0 : round(color.h, 2);
  return `${l} ${c} ${h}`;
}
function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
