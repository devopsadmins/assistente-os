import { expect, test } from "vitest";
import { deriveTheme, DEFAULT_DERIVED } from "./derive";
import { DERIVED_VAR_KEYS, InvalidBrandColorError, type BrandInput } from "./types";
import { parseColor } from "./color";
import { contrastRatio } from "./ramp";

const brand = (primaryColor: string): BrandInput => ({
  productName: "Acme Assist",
  logo: { light: "https://x/logo.svg" },
  primaryColor,
});

function parseTriplet(v: string) {
  const [l, c, h] = v.split(/\s+/).map(Number);
  return { l: l!, c: c!, h: h! };
}

test("emits exactly the whitelisted keys — no more, no fewer", () => {
  const { cssVars } = deriveTheme(brand("#3b82f6"));
  expect(Object.keys(cssVars).sort()).toEqual([...DERIVED_VAR_KEYS].sort());
});

test("every value is an 'L C H' triplet of finite numbers", () => {
  const { cssVars } = deriveTheme(brand("#a855f7"));
  for (const v of Object.values(cssVars)) {
    const t = parseTriplet(v);
    expect(Number.isFinite(t.l) && Number.isFinite(t.c) && Number.isFinite(t.h)).toBe(true);
    expect(t.l).toBeGreaterThanOrEqual(0);
    expect(t.l).toBeLessThanOrEqual(1);
  }
});

test("primary/primary-foreground pass AA; ring & bubble pairs pass AA", () => {
  for (const hex of ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#0ea5e9", "#f59e0b", "#111827"]) {
    const { cssVars } = deriveTheme(brand(hex));
    const primary = parseTriplet(cssVars["--primary"]);
    const primaryFg = parseTriplet(cssVars["--primary-foreground"]);
    const bubble = parseTriplet(cssVars["--chat-user-bubble"]);
    const bubbleFg = parseTriplet(cssVars["--chat-user-bubble-foreground"]);
    const accent = parseTriplet(cssVars["--accent"]);
    const accentFg = parseTriplet(cssVars["--accent-foreground"]);
    expect(contrastRatio(primaryFg, primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(bubbleFg, bubble)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accentFg, accent)).toBeGreaterThanOrEqual(4.5);
  }
});

test("throws InvalidBrandColorError on an unparseable primaryColor", () => {
  expect(() => deriveTheme(brand("banana"))).toThrow(InvalidBrandColorError);
});

test("passes productName and logo straight through", () => {
  const b = brand("#3b82f6");
  const out = deriveTheme(b);
  expect(out.productName).toBe(b.productName);
  expect(out.logo).toEqual(b.logo);
});

test("known seed produces a stable snapshot", () => {
  expect(deriveTheme(brand("#3b82f6")).cssVars).toMatchSnapshot();
});

test("DEFAULT_DERIVED has every whitelisted key", () => {
  expect(Object.keys(DEFAULT_DERIVED).sort()).toEqual([...DERIVED_VAR_KEYS].sort());
});

test("fallback seeds populate `nudged` with the whole primary cluster", () => {
  for (const hex of ["#26dde5", "#0ba529", "#3ae0df"]) {
    const { cssVars, nudged } = deriveTheme(brand(hex));
    expect(nudged, hex).toContain("--primary");
    expect(nudged, hex).toContain("--primary-foreground");
    expect(nudged, hex).toContain("--primary-hover");
    expect(nudged, hex).toContain("--ring");
    for (const key of nudged) {
      expect(cssVars[key], `${hex} ${key}`).toBe(DEFAULT_DERIVED[key]);
    }
  }
});

test("primary cluster is coherent after the AA fallback (Critical #1 regression lock)", () => {
  const { cssVars } = deriveTheme(brand("#26dde5"));
  expect(cssVars["--primary"]).toBe(DEFAULT_DERIVED["--primary"]);
  expect(cssVars["--primary-hover"]).toBe(DEFAULT_DERIVED["--primary-hover"]);
  expect(cssVars["--ring"]).toBe(DEFAULT_DERIVED["--ring"]);
});

test("the shipped default --primary clears AA against the fixed white --background", () => {
  expect(contrastRatio(parseTriplet(DEFAULT_DERIVED["--primary"]), { l: 1, c: 0, h: 0 })).toBeGreaterThanOrEqual(
    4.5,
  );
});

test("fuzz: 200 random seeds never violate AA on the emitted pairs", () => {
  let rng = 123456789;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 200; i++) {
    const hex =
      "#" +
      Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, "0");
    const { cssVars, nudged } = deriveTheme(brand(hex));
    const pairs: [string, string][] = [
      ["--primary-foreground", "--primary"],
      ["--accent-foreground", "--accent"],
      ["--chat-user-bubble-foreground", "--chat-user-bubble"],
    ];
    for (const [fgKey, bgKey] of pairs) {
      const ratio = contrastRatio(parseTriplet(cssVars[fgKey as never]), parseTriplet(cssVars[bgKey as never]));
      expect(ratio, `${hex} ${fgKey}/${bgKey} (nudged: ${nudged.join(",")})`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
