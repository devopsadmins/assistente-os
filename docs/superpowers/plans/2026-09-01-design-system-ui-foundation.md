# Design System `packages/ui` — Foundation (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `@assistente-os/ui` package with its token architecture, the `deriveTheme` white-label engine, a `ThemeProvider`, a Ladle catalog, and the CI governance (ADR-UI-001 + per-zone dependency guard) — everything the component work (plan A2) and the app (sub-project B) build on.

**Architecture:** Source-only workspace package (no JS build; consumers run their own Tailwind/bundler over `src/`). Tokens are CSS custom properties holding OKLCH component triplets (`L C H`); a Tailwind preset maps utilities to them. `deriveTheme(BrandInput)` converts a single brand seed color to a whitelisted set of ~8 CSS-var overrides, each verified against WCAG AA. `ThemeProvider` writes those overrides onto `document.documentElement`.

**Tech Stack:** TypeScript (own tsconfig — DOM libs, `jsx: react-jsx`, `moduleResolution: bundler`), React 19 (peer), Vitest + Testing Library + jsdom, `@ladle/react`, Tailwind v3 preset (CommonJS), hand-rolled sRGB↔OKLab↔OKLCH math (no color dependency).

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` — read it alongside this plan. This plan implements sections 1, 2, 3, 5 (scaffold only), 6 (theme tests), and 7 of that spec. The component inventory (spec §4) and the full catalog (spec §5) are plan **A2**, written after this one lands.

## Global Constraints

- Node `>=22.16.0` (repo `engines`); CI uses Node 22.
- `packages/ui` is **source-only**: no JS emitted, `exports` point at `./src/**`, consumers compile it.
- `packages/ui` uses **Vitest** for tests — a deliberate exception to the repo-wide `node --test` convention, permitted only inside the frontend zone by ADR-UI-001 (Task 10).
- Components and theme code **never contain a raw color literal** (`#…`, `rgb(`, `hsl(`, `oklch(`) outside `src/theme/**` and `src/tokens.css`. `deriveTheme` output is the only runtime source of themed color values.
- CSS custom properties hold **OKLCH components as space-separated numbers** (`L C H`, e.g. `0.55 0.18 264`), never a full `oklch(...)` string. The Tailwind preset wraps them: `oklch(var(--primary) / <alpha-value>)`.
- `deriveTheme` may emit **only** the keys in `DerivedVarKey` (Task 3) — enforced by test, not convention.
- Every foreground/background pair `deriveTheme` emits must pass **WCAG 2.1 AA** (contrast ratio ≥ 4.5).
- Package name: `@assistente-os/ui`. Default product name string: `"Assistente OS"`.
- Commit after every task. Branch: `feat/ui-foundation` off current `docs/design-system-ui-spec` HEAD (which already carries the spec).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/package.json` | Package manifest: name, `exports` → `src`, scripts (`typecheck`, `test`, `catalog`), peer/dev deps |
| `packages/ui/tsconfig.json` | Own TS config — DOM libs, `react-jsx`, bundler resolution, `noEmit` |
| `packages/ui/vitest.config.ts` | Vitest: jsdom env, setup file, coverage off |
| `packages/ui/vitest.setup.ts` | `@testing-library/jest-dom` matchers + cleanup |
| `packages/ui/postcss.config.cjs` | PostCSS with `tailwindcss` + `autoprefixer` (for the catalog build) |
| `packages/ui/tailwind-preset.cjs` | CommonJS Tailwind preset: maps `colors`/`fontSize`/`spacing`/`borderRadius`/`boxShadow`/transitions to the token vars |
| `packages/ui/src/tokens.css` | The default product theme: every primitive + semantic CSS var on `:root` |
| `packages/ui/src/index.ts` | Barrel: re-exports the public API (`deriveTheme`, `ThemeProvider`, `useBrand`, `cn`, theme types) |
| `packages/ui/src/lib/cn.ts` | `cn(...classes)` = `clsx` + `tailwind-merge` |
| `packages/ui/src/theme/types.ts` | `BrandInput`, `DerivedTheme`, `DerivedVarKey`, `InvalidBrandColorError` |
| `packages/ui/src/theme/color.ts` | Parse a CSS color string → `Oklch`; sRGB↔OKLab↔OKLCH math; sRGB relative luminance |
| `packages/ui/src/theme/ramp.ts` | `buildRamp(seed)` → 11 `Oklch` steps; `contrastRatio(a, b)`; `passesAA(fg, bg)` |
| `packages/ui/src/theme/derive.ts` | `deriveTheme(BrandInput)` → `DerivedTheme` (whitelist + AA + nudge) |
| `packages/ui/src/theme/context.tsx` | `<ThemeProvider>`, `useBrand()` |
| `packages/ui/src/theme/*.test.ts(x)` | Vitest suites for the four theme modules + context |
| `packages/ui/src/tokens.test.ts` | Parses `tokens.css`, asserts every required var is defined |
| `packages/ui/.ladle/config.mjs` | Ladle config (title, defaultStory) |
| `packages/ui/.ladle/components.tsx` | Ladle `Provider` override — global "brand" control that wraps stories in `<ThemeProvider>` |
| `packages/ui/src/theme/theme.stories.tsx` | Story: renders the ramp + derived vars swatches under the selected brand preset |
| `docs/adr/ADR-UI-001.md` | The two-zone STDLIB_FIRST decision |
| `.github/scripts/deps-zones.mjs` | Per-zone dependency allowlist check |
| `.github/scripts/deps-zones.test.mjs` | Tests for the check (via `node --test`) |
| `.github/workflows/ci.yml` | Add a `Dependency zones` step to `build-and-test` |
| `package.json` (root) | Add `catalog` passthrough script (optional convenience) |

---

### Task 1: Package scaffold + workspace wiring

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/vitest.setup.ts`
- Create: `packages/ui/postcss.config.cjs`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/placeholder.test.ts` (removed in Task 2)
- Modify: none (root `package.json` already has `"workspaces": ["packages/*"]`)

**Interfaces:**
- Consumes: nothing.
- Produces: a workspace `@assistente-os/ui` whose `npm run typecheck -w @assistente-os/ui` and `npm test -w @assistente-os/ui` both exit 0.

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@assistente-os/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css",
    "./tailwind-preset": "./tailwind-preset.cjs",
    "./styles/*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "catalog": "ladle serve",
    "catalog:build": "ladle build"
  },
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19"
  },
  "dependencies": {
    "clsx": "2.1.1",
    "tailwind-merge": "2.5.4"
  },
  "devDependencies": {
    "@ladle/react": "4.1.2",
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.0.1",
    "@testing-library/user-event": "14.5.2",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    "autoprefixer": "10.4.20",
    "jsdom": "25.0.1",
    "postcss": "8.4.49",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3",
    "vitest": "2.1.5"
  }
}
```

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

Does **not** extend `tsconfig.base.json` (that config is `module: NodeNext`, no DOM libs — wrong for a bundler-consumed React package).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vitest.config.ts", "vitest.setup.ts", ".ladle/**/*.tsx"]
}
```

- [ ] **Step 3: Create `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Create `packages/ui/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Create `packages/ui/postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `packages/ui/src/index.ts`**

```ts
// Public API of @assistente-os/ui. Populated as modules land.
export {};
```

- [ ] **Step 7: Create `packages/ui/src/placeholder.test.ts`**

```ts
import { expect, test } from "vitest";

test("vitest runs in @assistente-os/ui", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 8: Install and verify**

Run: `npm install`
Expected: completes; `packages/ui` appears in `node_modules/@assistente-os/ui` (symlink).

Run: `npm test -w @assistente-os/ui`
Expected: PASS — 1 test (`vitest runs in @assistente-os/ui`).

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0, no output.

- [ ] **Step 9: Commit**

```bash
git checkout -b feat/ui-foundation
git add packages/ui package.json package-lock.json
git commit -m "feat(ui): scaffold @assistente-os/ui package (source-only, vitest, ladle)"
```

---

### Task 2: `cn` class-merge helper

**Files:**
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/lib/cn.test.ts`
- Delete: `packages/ui/src/placeholder.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `clsx`, `tailwind-merge` (Task 1 deps).
- Produces: `cn(...inputs: ClassValue[]): string` — every component in plan A2 uses this to compose class names.

- [ ] **Step 1: Write the failing test — `packages/ui/src/lib/cn.test.ts`**

```ts
import { expect, test } from "vitest";
import { cn } from "./cn";

test("joins truthy class names", () => {
  expect(cn("a", "b")).toBe("a b");
});

test("drops falsy values", () => {
  expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
});

test("last conflicting tailwind utility wins", () => {
  expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
});

test("merges conditional object syntax", () => {
  expect(cn("base", { active: true, hidden: false })).toBe("base active");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- cn`
Expected: FAIL — cannot resolve `./cn`.

- [ ] **Step 3: Write `packages/ui/src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose class names: clsx for conditionals, tailwind-merge to resolve utility conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Delete the placeholder test**

Run: `git rm packages/ui/src/placeholder.test.ts`

- [ ] **Step 5: Export from the barrel — `packages/ui/src/index.ts`**

```ts
// Public API of @assistente-os/ui. Populated as modules land.
export { cn } from "./lib/cn";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui`
Expected: PASS — 4 tests in `cn.test.ts`.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): cn() class-merge helper"
```

---

### Task 3: Theme types + `InvalidBrandColorError`

**Files:**
- Create: `packages/ui/src/theme/types.ts`
- Create: `packages/ui/src/theme/types.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface BrandInput { productName: string; logo: { light: string; dark?: string }; primaryColor: string }`
  - `type DerivedVarKey = "--primary" | "--primary-foreground" | "--primary-hover" | "--ring" | "--accent" | "--accent-foreground" | "--chat-user-bubble" | "--chat-user-bubble-foreground"`
  - `interface DerivedTheme { cssVars: Record<DerivedVarKey, string>; productName: string; logo: { light: string; dark?: string }; nudged: DerivedVarKey[] }`
  - `const DERIVED_VAR_KEYS: readonly DerivedVarKey[]` — the 8 keys, for iteration/validation
  - `class InvalidBrandColorError extends Error` — `name = "InvalidBrandColorError"`
  - `interface Oklch { l: number; c: number; h: number }` — `l` in `[0,1]`, `c` ≥ 0, `h` in `[0,360)` (h is `0` when `c === 0`)

- [ ] **Step 1: Write the failing test — `packages/ui/src/theme/types.test.ts`**

```ts
import { expect, test } from "vitest";
import { DERIVED_VAR_KEYS, InvalidBrandColorError } from "./types";

test("DERIVED_VAR_KEYS has exactly the 8 whitelisted keys", () => {
  expect([...DERIVED_VAR_KEYS].sort()).toEqual(
    [
      "--accent",
      "--accent-foreground",
      "--chat-user-bubble",
      "--chat-user-bubble-foreground",
      "--primary",
      "--primary-foreground",
      "--primary-hover",
      "--ring",
    ].sort(),
  );
});

test("InvalidBrandColorError is an Error with a stable name", () => {
  const err = new InvalidBrandColorError("bad color: potato");
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe("InvalidBrandColorError");
  expect(err.message).toContain("potato");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- types`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write `packages/ui/src/theme/types.ts`**

```ts
/** A color in the OKLCH space. `h` is undefined-of-meaning (set to 0) when `c === 0`. */
export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, ≥ 0 (unbounded in theory; ~0.37 max for sRGB). */
  c: number;
  /** Hue angle in degrees, 0–360. */
  h: number;
}

/** The only customization surface for white-label theming. */
export interface BrandInput {
  productName: string;
  /** URL or data URI. `dark` is reserved for v2; unused in v1. */
  logo: { light: string; dark?: string };
  /** Any CSS color string — the single seed the theme is derived from. */
  primaryColor: string;
}

/** The complete set of CSS vars `deriveTheme` is permitted to emit. Nothing else. */
export type DerivedVarKey =
  | "--primary"
  | "--primary-foreground"
  | "--primary-hover"
  | "--ring"
  | "--accent"
  | "--accent-foreground"
  | "--chat-user-bubble"
  | "--chat-user-bubble-foreground";

export const DERIVED_VAR_KEYS: readonly DerivedVarKey[] = [
  "--primary",
  "--primary-foreground",
  "--primary-hover",
  "--ring",
  "--accent",
  "--accent-foreground",
  "--chat-user-bubble",
  "--chat-user-bubble-foreground",
] as const;

export interface DerivedTheme {
  /** Values are OKLCH component triplets: `"L C H"` (e.g. `"0.55 0.18 264"`). */
  cssVars: Record<DerivedVarKey, string>;
  productName: string;
  logo: { light: string; dark?: string };
  /** Keys whose derived value failed AA and fell back to the token default. */
  nudged: DerivedVarKey[];
}

export class InvalidBrandColorError extends Error {
  override name = "InvalidBrandColorError";
  constructor(message: string) {
    super(message);
  }
}
```

- [ ] **Step 4: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export {
  DERIVED_VAR_KEYS,
  InvalidBrandColorError,
  type BrandInput,
  type DerivedTheme,
  type DerivedVarKey,
  type Oklch,
} from "./theme/types";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui -- types`
Expected: PASS — 2 tests.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): theme types + InvalidBrandColorError + DerivedVarKey whitelist"
```

---

### Task 4: Color parsing + OKLCH conversion

**Files:**
- Create: `packages/ui/src/theme/color.ts`
- Create: `packages/ui/src/theme/color.test.ts`

**Interfaces:**
- Consumes: `Oklch`, `InvalidBrandColorError` from `./types`.
- Produces:
  - `parseColor(input: string): Oklch` — accepts `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()/rgba()`, `hsl()/hsla()`, `oklch()`, and a curated set of ~20 CSS named colors (case-insensitive, whitespace-tolerant). Throws `InvalidBrandColorError` on anything else. Alpha is parsed but discarded (theme colors are opaque).
  - `oklchToSrgb(color: Oklch): { r: number; g: number; b: number }` — channels in `[0,1]`, gamut-clamped.
  - `srgbToOklch(rgb: { r: number; g: number; b: number }): Oklch` — inputs in `[0,1]`.
  - `relativeLuminance(rgb: { r: number; g: number; b: number }): number` — WCAG 2.1 sRGB relative luminance, `[0,1]`.
  - `formatOklch(color: Oklch): string` — `"L C H"` rounded (l,c to 4 dp; h to 2 dp; h omitted-as-0 when c≈0 → still emit `"L C 0"`).

- [ ] **Step 1: Write the failing test — `packages/ui/src/theme/color.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- color`
Expected: FAIL — cannot resolve `./color`.

- [ ] **Step 3: Write `packages/ui/src/theme/color.ts`**

```ts
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
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui -- color`
Expected: PASS — all `color.test.ts` cases.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/theme
git commit -m "feat(ui): color parsing + sRGB<->OKLab<->OKLCH + WCAG luminance (no deps)"
```

---

### Task 5: Brand ramp + contrast helpers

**Files:**
- Create: `packages/ui/src/theme/ramp.ts`
- Create: `packages/ui/src/theme/ramp.test.ts`

**Interfaces:**
- Consumes: `Oklch` from `./types`; `oklchToSrgb`, `relativeLuminance` from `./color`.
- Produces:
  - `const RAMP_LIGHTNESS: readonly number[]` — the 11 fixed L targets `[0.98,0.95,0.90,0.82,0.72,0.62,0.54,0.46,0.38,0.30,0.22]`.
  - `const RAMP_STOPS: readonly number[]` — `[50,100,200,300,400,500,600,700,800,900,950]` (index-aligned with `RAMP_LIGHTNESS`).
  - `buildRamp(seed: Oklch): Oklch[]` — 11 steps; lightness from `RAMP_LIGHTNESS`; hue = `seed.h` for every step; chroma = `bellCurve(i) * min(seed.c, CHROMA_CAP)` where `bellCurve` peaks at index 5 (~stop 500) and tapers to ~0.35 at the ends.
  - `contrastRatio(a: Oklch, b: Oklch): number` — WCAG ratio `(L1 + 0.05) / (L2 + 0.05)`, ≥ 1.
  - `passesAA(fg: Oklch, bg: Oklch): boolean` — `contrastRatio >= 4.5`.
  - `pickForeground(bg: Oklch, candidates: Oklch[]): Oklch` — returns the first candidate that passes AA against `bg`, else the highest-contrast one.

- [ ] **Step 1: Write the failing test — `packages/ui/src/theme/ramp.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- ramp`
Expected: FAIL — cannot resolve `./ramp`.

- [ ] **Step 3: Write `packages/ui/src/theme/ramp.ts`**

```ts
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
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui -- ramp`
Expected: PASS — all `ramp.test.ts` cases.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/theme
git commit -m "feat(ui): brand ramp generator + WCAG contrast/pickForeground helpers"
```

---

### Task 6: `deriveTheme`

**Files:**
- Create: `packages/ui/src/theme/derive.ts`
- Create: `packages/ui/src/theme/derive.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `BrandInput`, `DerivedTheme`, `DerivedVarKey`, `DERIVED_VAR_KEYS`, `InvalidBrandColorError`, `Oklch` from `./types`; `parseColor`, `formatOklch` from `./color`; `buildRamp`, `passesAA`, `pickForeground`, `contrastRatio` from `./ramp`.
- Produces: `deriveTheme(brand: BrandInput): DerivedTheme` — the public white-label entry point. Also `DEFAULT_DERIVED: Record<DerivedVarKey, string>` — the token defaults `deriveTheme` falls back to per-key (must match `tokens.css`, asserted in Task 8's test).

- [ ] **Step 1: Write the failing test — `packages/ui/src/theme/derive.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- derive`
Expected: FAIL — cannot resolve `./derive`.

- [ ] **Step 3: Write `packages/ui/src/theme/derive.ts`**

```ts
import { formatOklch, parseColor } from "./color";
import { buildRamp, contrastRatio, pickForeground } from "./ramp";
import {
  DERIVED_VAR_KEYS,
  InvalidBrandColorError,
  type BrandInput,
  type DerivedTheme,
  type DerivedVarKey,
  type Oklch,
} from "./types";

/** Token defaults — MUST equal the `:root` values in tokens.css (asserted in tokens.test.ts). */
export const DEFAULT_DERIVED: Record<DerivedVarKey, string> = {
  "--primary": "0.55 0.17 264",
  "--primary-foreground": "0.99 0 0",
  "--primary-hover": "0.48 0.17 264",
  "--ring": "0.55 0.1 264",
  "--accent": "0.96 0.02 264",
  "--accent-foreground": "0.32 0.05 264",
  "--chat-user-bubble": "0.94 0.03 264",
  "--chat-user-bubble-foreground": "0.28 0.04 264",
};

const WHITE: Oklch = { l: 0.99, c: 0, h: 0 };
const NEAR_BLACK: Oklch = { l: 0.22, c: 0, h: 0 };
const BACKGROUND: Oklch = { l: 1, c: 0, h: 0 }; // tokens.css --background

/** Nudge a colour's lightness toward `direction` until it clears AA against `against`, or give up. */
function nudgeToAA(start: Oklch, against: Oklch, direction: 1 | -1): Oklch | null {
  let candidate = { ...start };
  for (let i = 0; i < 20; i++) {
    if (contrastRatio(candidate, against) >= 4.5) return candidate;
    candidate = { ...candidate, l: clamp01(candidate.l + direction * 0.02) };
  }
  return contrastRatio(candidate, against) >= 4.5 ? candidate : null;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function deriveTheme(brand: BrandInput): DerivedTheme {
  const seed = parseColor(brand.primaryColor); // throws InvalidBrandColorError
  if (!(seed.l >= 0)) throw new InvalidBrandColorError(`degenerate color: ${brand.primaryColor}`);

  const ramp = buildRamp(seed);
  const nudged: DerivedVarKey[] = [];

  const out = { ...DEFAULT_DERIVED } as Record<DerivedVarKey, string>;
  const set = (key: DerivedVarKey, value: Oklch | null) => {
    if (value === null) {
      nudged.push(key);
      return; // keep the default already in `out`
    }
    out[key] = formatOklch(value);
  };

  // --primary: darkest ramp step (from index 5 down) that clears AA against the white background.
  let primary: Oklch | null = null;
  for (let i = 5; i <= 10; i++) {
    if (contrastRatio(ramp[i]!, BACKGROUND) >= 4.5) {
      primary = ramp[i]!;
      break;
    }
  }
  if (!primary) primary = nudgeToAA(ramp[6]!, BACKGROUND, -1);
  set("--primary", primary);
  const primaryResolved = primary ?? parseTripletToOklch(DEFAULT_DERIVED["--primary"]);

  // --primary-foreground: white or near-black, whichever clears AA against --primary.
  set("--primary-foreground", pickForeground(primaryResolved, [WHITE, NEAR_BLACK]));

  // --primary-hover: one ramp step darker than --primary (bounded).
  const hoverIdx = Math.min(10, ramp.indexOf(primaryResolved) + 1);
  const hover = ramp[hoverIdx] ?? { ...primaryResolved, l: clamp01(primaryResolved.l - 0.06) };
  set("--primary-hover", hover);

  // --ring: --primary at reduced chroma.
  set("--ring", { ...primaryResolved, c: primaryResolved.c * 0.6 });

  // --accent / --chat-user-bubble: light low-chroma tints (ramp steps 100 / 200), each with an AA fg.
  const accentBg = ramp[1]!;
  set("--accent", accentBg);
  set("--accent-foreground", nudgeToAA(pickForeground(accentBg, [NEAR_BLACK, WHITE]), accentBg, -1));

  const bubbleBg = ramp[2]!;
  set("--chat-user-bubble", bubbleBg);
  set("--chat-user-bubble-foreground", nudgeToAA(pickForeground(bubbleBg, [NEAR_BLACK, WHITE]), bubbleBg, -1));

  // Final guard: any key still failing AA against its pair -> fall back to default + mark nudged.
  const pairs: [DerivedVarKey, DerivedVarKey][] = [
    ["--primary-foreground", "--primary"],
    ["--accent-foreground", "--accent"],
    ["--chat-user-bubble-foreground", "--chat-user-bubble"],
  ];
  for (const [fgKey, bgKey] of pairs) {
    const ratio = contrastRatio(parseTripletToOklch(out[fgKey]), parseTripletToOklch(out[bgKey]));
    if (ratio < 4.5) {
      out[fgKey] = DEFAULT_DERIVED[fgKey];
      out[bgKey] = DEFAULT_DERIVED[bgKey];
      if (!nudged.includes(fgKey)) nudged.push(fgKey);
      if (!nudged.includes(bgKey)) nudged.push(bgKey);
    }
  }

  // Defensive: never emit a key outside the whitelist.
  for (const k of Object.keys(out)) {
    if (!DERIVED_VAR_KEYS.includes(k as DerivedVarKey)) delete (out as Record<string, string>)[k];
  }

  return { cssVars: out, productName: brand.productName, logo: brand.logo, nudged };
}

function parseTripletToOklch(triplet: string): Oklch {
  const [l, c, h] = triplet.split(/\s+/).map(Number);
  return { l: l ?? 0, c: c ?? 0, h: h ?? 0 };
}
```

- [ ] **Step 4: Run tests, update snapshot, typecheck**

Run: `npm test -w @assistente-os/ui -- derive`
Expected: first run writes the snapshot; suite PASSES. If any AA assertion fails, adjust `buildRamp` chroma cap / `nudgeToAA` iteration budget — do **not** loosen the 4.5 threshold.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 5: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { deriveTheme, DEFAULT_DERIVED } from "./theme/derive";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): deriveTheme() — whitelisted, AA-verified white-label token engine"
```

---

### Task 7: `ThemeProvider` + `useBrand`

**Files:**
- Create: `packages/ui/src/theme/context.tsx`
- Create: `packages/ui/src/theme/context.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `deriveTheme` from `./derive`; `BrandInput`, `DerivedVarKey`, `DERIVED_VAR_KEYS` from `./types`.
- Produces:
  - `<ThemeProvider brand={BrandInput | null | undefined}>{children}</ThemeProvider>` — on mount/update, if `brand` is set, calls `deriveTheme(brand)` (memoized on identity) and writes each `cssVars` entry via `document.documentElement.style.setProperty`; on unmount or when `brand` becomes nullish, removes those properties.
  - `useBrand(): { productName: string; logo: { light: string; dark?: string } }` — from context; defaults to `{ productName: "Assistente OS", logo: { light: "" } }` when no provider or nullish brand.
  - `DEFAULT_BRAND_CONTEXT` — the default value above, exported for reuse.

- [ ] **Step 1: Write the failing test — `packages/ui/src/theme/context.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, useBrand, DEFAULT_BRAND_CONTEXT } from "./context";
import { DERIVED_VAR_KEYS, type BrandInput } from "./types";

const brand: BrandInput = {
  productName: "Elebece Assist",
  logo: { light: "https://x/l.svg" },
  primaryColor: "#3b82f6",
};

function Probe() {
  const b = useBrand();
  return <span data-testid="name">{b.productName}</span>;
}

test("useBrand without a provider returns the default product identity", () => {
  render(<Probe />);
  expect(screen.getByTestId("name")).toHaveTextContent(DEFAULT_BRAND_CONTEXT.productName);
});

test("ThemeProvider with a brand writes all 8 derived vars to :root and exposes productName", () => {
  render(
    <ThemeProvider brand={brand}>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("name")).toHaveTextContent("Elebece Assist");
  for (const key of DERIVED_VAR_KEYS) {
    expect(document.documentElement.style.getPropertyValue(key).trim()).not.toBe("");
  }
});

test("ThemeProvider with brand=null writes nothing and uses defaults", () => {
  render(
    <ThemeProvider brand={null}>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("name")).toHaveTextContent(DEFAULT_BRAND_CONTEXT.productName);
  expect(document.documentElement.style.getPropertyValue("--primary").trim()).toBe("");
});

test("unmounting ThemeProvider removes the vars it set", () => {
  const { unmount } = render(<ThemeProvider brand={brand}>x</ThemeProvider>);
  expect(document.documentElement.style.getPropertyValue("--primary").trim()).not.toBe("");
  unmount();
  for (const key of DERIVED_VAR_KEYS) {
    expect(document.documentElement.style.getPropertyValue(key).trim()).toBe("");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- context`
Expected: FAIL — cannot resolve `./context`.

- [ ] **Step 3: Write `packages/ui/src/theme/context.tsx`**

```tsx
import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";
import { deriveTheme } from "./derive";
import { DERIVED_VAR_KEYS, type BrandInput } from "./types";

interface BrandContextValue {
  productName: string;
  logo: { light: string; dark?: string };
}

export const DEFAULT_BRAND_CONTEXT: BrandContextValue = {
  productName: "Assistente OS",
  logo: { light: "" },
};

const BrandContext = createContext<BrandContextValue>(DEFAULT_BRAND_CONTEXT);

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

export function ThemeProvider({
  brand,
  children,
}: {
  brand?: BrandInput | null;
  children: ReactNode;
}) {
  const derived = useMemo(() => (brand ? deriveTheme(brand) : null), [brand]);

  useLayoutEffect(() => {
    if (!derived) return;
    const root = document.documentElement;
    for (const key of DERIVED_VAR_KEYS) {
      root.style.setProperty(key, derived.cssVars[key]);
    }
    return () => {
      for (const key of DERIVED_VAR_KEYS) root.style.removeProperty(key);
    };
  }, [derived]);

  const value = useMemo<BrandContextValue>(
    () => (derived ? { productName: derived.productName, logo: derived.logo } : DEFAULT_BRAND_CONTEXT),
    [derived],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui -- context`
Expected: PASS — 4 tests.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 5: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { ThemeProvider, useBrand, DEFAULT_BRAND_CONTEXT } from "./theme/context";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): ThemeProvider + useBrand — injects derived vars onto :root"
```

---

### Task 8: `tokens.css` default theme + Tailwind preset + structure test

**Files:**
- Create: `packages/ui/src/tokens.css`
- Create: `packages/ui/tailwind-preset.cjs`
- Create: `packages/ui/src/tokens.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_DERIVED` from `./theme/derive`; `DERIVED_VAR_KEYS` from `./theme/types`.
- Produces:
  - `src/tokens.css` — `:root { … }` defining **every** primitive var, every shadcn semantic role, every product role, and the 8 derived-var defaults (values identical to `DEFAULT_DERIVED`).
  - `tailwind-preset.cjs` — `module.exports = { theme: { extend: { … } } }` mapping `colors`, `fontSize`, `spacing`, `borderRadius`, `boxShadow`, `transitionTimingFunction`, `transitionDuration` to `var(--…)`. No raw color values.

- [ ] **Step 1: Write the failing test — `packages/ui/src/tokens.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DERIVED_VAR_KEYS } from "./theme/types";
import { DEFAULT_DERIVED } from "./theme/derive";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const preset = require("../tailwind-preset.cjs");

/** Map of `--name` -> trimmed value, from the single :root block. */
function rootVars(source: string): Record<string, string> {
  const block = source.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error("no :root block in tokens.css");
  const map: Record<string, string> = {};
  for (const line of block[1]!.split(";")) {
    const m = line.match(/(--[\w-]+)\s*:\s*(.+)/);
    if (m) map[m[1]!] = m[2]!.trim();
  }
  return map;
}

const vars = rootVars(css);

const SEMANTIC_ROLES = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover",
  "--popover-foreground", "--primary", "--primary-foreground", "--secondary",
  "--secondary-foreground", "--muted", "--muted-foreground", "--accent",
  "--accent-foreground", "--destructive", "--destructive-foreground",
  "--border", "--input", "--ring", "--radius",
];
const PRODUCT_ROLES = [
  "--primary-hover", "--chat-user-bubble", "--chat-user-bubble-foreground",
  "--chat-assistant-bubble", "--chat-assistant-bubble-foreground",
  "--citation", "--citation-foreground", "--code-bg", "--code-fg",
  "--sidebar", "--sidebar-foreground", "--sidebar-accent",
];
const PRIMITIVE_SAMPLES = [
  "--brand-50", "--brand-500", "--brand-950", "--gray-50", "--gray-950",
  "--success", "--warning", "--danger", "--info",
  "--text-xs", "--text-4xl", "--leading-xs", "--leading-4xl",
  "--space-0", "--space-24", "--radius-sm", "--radius-full",
  "--shadow-xs", "--shadow-xl", "--ease-standard", "--dur-base",
];

test("tokens.css defines every shadcn semantic role", () => {
  for (const r of SEMANTIC_ROLES) expect(vars, `missing ${r}`).toHaveProperty(r);
});

test("tokens.css defines every product role", () => {
  for (const r of PRODUCT_ROLES) expect(vars, `missing ${r}`).toHaveProperty(r);
});

test("tokens.css defines the primitive scales", () => {
  for (const r of PRIMITIVE_SAMPLES) expect(vars, `missing ${r}`).toHaveProperty(r);
});

test("the 8 derived-var defaults in tokens.css match DEFAULT_DERIVED exactly", () => {
  for (const key of DERIVED_VAR_KEYS) {
    expect(vars[key], `${key} mismatch`).toBe(DEFAULT_DERIVED[key]);
  }
});

test("no raw color literal appears in the Tailwind preset", () => {
  const json = JSON.stringify(preset);
  expect(json).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(json).not.toMatch(/\brgb\(/);
  expect(json).not.toMatch(/\bhsl\(/);
});

test("preset maps primary/background/foreground colors to oklch(var(--…))", () => {
  const colors = preset.theme.extend.colors;
  expect(colors.primary.DEFAULT).toBe("oklch(var(--primary) / <alpha-value>)");
  expect(colors.background).toBe("oklch(var(--background) / <alpha-value>)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- tokens`
Expected: FAIL — cannot read `./tokens.css` / cannot find `../tailwind-preset.cjs`.

- [ ] **Step 3: Write `packages/ui/src/tokens.css`**

All colors are OKLCH component triplets (`L C H`). The derived-var block at the end must byte-match `DEFAULT_DERIVED` from Task 6.

```css
/*
 * @assistente-os/ui — default product theme.
 * Colors are OKLCH components "L C H"; the Tailwind preset wraps them as
 * oklch(var(--x) / <alpha-value>). deriveTheme() overrides only the 8 keys in
 * the "derived (white-label) defaults" block below.
 */
:root {
  /* ── primitive: brand ramp (default seed ≈ indigo #4f46e5) ── */
  --brand-50: 0.97 0.02 264;
  --brand-100: 0.94 0.04 264;
  --brand-200: 0.88 0.07 264;
  --brand-300: 0.8 0.1 264;
  --brand-400: 0.7 0.14 264;
  --brand-500: 0.62 0.17 264;
  --brand-600: 0.55 0.17 264;
  --brand-700: 0.47 0.15 264;
  --brand-800: 0.4 0.12 264;
  --brand-900: 0.34 0.09 264;
  --brand-950: 0.25 0.06 264;

  /* ── primitive: neutral grey ── */
  --gray-50: 0.985 0 0;
  --gray-100: 0.97 0 0;
  --gray-200: 0.92 0 0;
  --gray-300: 0.87 0 0;
  --gray-400: 0.71 0 0;
  --gray-500: 0.56 0 0;
  --gray-600: 0.44 0 0;
  --gray-700: 0.37 0 0;
  --gray-800: 0.27 0 0;
  --gray-900: 0.2 0 0;
  --gray-950: 0.14 0 0;

  /* ── primitive: status ── */
  --success: 0.62 0.17 150;
  --success-foreground: 0.99 0 0;
  --warning: 0.75 0.15 80;
  --warning-foreground: 0.24 0.03 80;
  --danger: 0.58 0.22 25;
  --danger-foreground: 0.99 0 0;
  --info: 0.6 0.14 240;
  --info-foreground: 0.99 0 0;

  /* ── primitive: typography (size / paired line-height) ── */
  --text-xs: 0.75rem;   --leading-xs: 1rem;
  --text-sm: 0.875rem;  --leading-sm: 1.25rem;
  --text-base: 1rem;    --leading-base: 1.5rem;
  --text-lg: 1.125rem;  --leading-lg: 1.75rem;
  --text-xl: 1.25rem;   --leading-xl: 1.75rem;
  --text-2xl: 1.5rem;   --leading-2xl: 2rem;
  --text-3xl: 1.875rem; --leading-3xl: 2.25rem;
  --text-4xl: 2.25rem;  --leading-4xl: 2.5rem;

  /* ── primitive: spacing (4px base) ── */
  --space-0: 0;      --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem;
  --space-4: 1rem;   --space-6: 1.5rem;  --space-8: 2rem;    --space-12: 3rem;
  --space-16: 4rem;  --space-24: 6rem;

  /* ── primitive: radius / shadow / motion ── */
  --radius-sm: 0.25rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
  --radius-xl: 1rem;    --radius-full: 9999px;
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.3, 0, 0, 1);
  --dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 320ms;

  /* ── semantic: shadcn roles ── */
  --background: 1 0 0;
  --foreground: 0.2 0 0;
  --card: 1 0 0;
  --card-foreground: 0.2 0 0;
  --popover: 1 0 0;
  --popover-foreground: 0.2 0 0;
  --primary: 0.55 0.17 264;
  --primary-foreground: 0.99 0 0;
  --secondary: 0.97 0 0;
  --secondary-foreground: 0.27 0 0;
  --muted: 0.97 0 0;
  --muted-foreground: 0.5 0 0;
  --accent: 0.96 0.02 264;
  --accent-foreground: 0.32 0.05 264;
  --destructive: 0.58 0.22 25;
  --destructive-foreground: 0.99 0 0;
  --border: 0.92 0 0;
  --input: 0.92 0 0;
  --ring: 0.55 0.1 264;
  --radius: 0.5rem;

  /* ── semantic: product roles ── */
  --primary-hover: 0.48 0.17 264;
  --chat-user-bubble: 0.94 0.03 264;
  --chat-user-bubble-foreground: 0.28 0.04 264;
  --chat-assistant-bubble: 0.97 0 0;
  --chat-assistant-bubble-foreground: 0.2 0 0;
  --citation: 0.9 0.05 264;
  --citation-foreground: 0.3 0.06 264;
  --code-bg: 0.16 0 0;
  --code-fg: 0.92 0 0;
  --sidebar: 0.985 0 0;
  --sidebar-foreground: 0.2 0 0;
  --sidebar-accent: 0.95 0.01 264;

  /* ── derived (white-label) defaults — MUST equal DEFAULT_DERIVED in theme/derive.ts ── */
  --primary: 0.55 0.17 264;
  --primary-foreground: 0.99 0 0;
  --primary-hover: 0.48 0.17 264;
  --ring: 0.55 0.1 264;
  --accent: 0.96 0.02 264;
  --accent-foreground: 0.32 0.05 264;
  --chat-user-bubble: 0.94 0.03 264;
  --chat-user-bubble-foreground: 0.28 0.04 264;
}
```

> Note: the derived keys appear twice (once in their semantic group, once in the
> trailing block). CSS takes the last declaration — the trailing block is the
> single source of truth and is what `tokens.test.ts` checks against
> `DEFAULT_DERIVED`. Keep both copies equal to avoid confusion.

- [ ] **Step 4: Write `packages/ui/tailwind-preset.cjs`**

```js
/**
 * Tailwind preset for @assistente-os/ui. Consumers:
 *   presets: [require("@assistente-os/ui/tailwind-preset")]
 * and add "@assistente-os/ui/src/**\/*.{ts,tsx}" to `content`.
 * No raw color values here — everything resolves to a CSS var from tokens.css.
 */
const color = (name) => `oklch(var(--${name}) / <alpha-value>)`;

module.exports = {
  theme: {
    extend: {
      colors: {
        background: color("background"),
        foreground: color("foreground"),
        border: color("border"),
        input: color("input"),
        ring: color("ring"),
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("popover"), foreground: color("popover-foreground") },
        primary: {
          DEFAULT: color("primary"),
          foreground: color("primary-foreground"),
          hover: color("primary-hover"),
        },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: { DEFAULT: color("destructive"), foreground: color("destructive-foreground") },
        success: { DEFAULT: color("success"), foreground: color("success-foreground") },
        warning: { DEFAULT: color("warning"), foreground: color("warning-foreground") },
        danger: { DEFAULT: color("danger"), foreground: color("danger-foreground") },
        info: { DEFAULT: color("info"), foreground: color("info-foreground") },
        chat: {
          user: color("chat-user-bubble"),
          "user-foreground": color("chat-user-bubble-foreground"),
          assistant: color("chat-assistant-bubble"),
          "assistant-foreground": color("chat-assistant-bubble-foreground"),
        },
        citation: { DEFAULT: color("citation"), foreground: color("citation-foreground") },
        code: { bg: color("code-bg"), fg: color("code-fg") },
        sidebar: {
          DEFAULT: color("sidebar"),
          foreground: color("sidebar-foreground"),
          accent: color("sidebar-accent"),
        },
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "var(--leading-xs)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--leading-sm)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-lg)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-xl)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-2xl)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-3xl)" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-4xl)" }],
      },
      spacing: {
        0: "var(--space-0)", 1: "var(--space-1)", 2: "var(--space-2)", 3: "var(--space-3)",
        4: "var(--space-4)", 6: "var(--space-6)", 8: "var(--space-8)", 12: "var(--space-12)",
        16: "var(--space-16)", 24: "var(--space-24)",
      },
      borderRadius: {
        sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)",
        xl: "var(--radius-xl)", full: "var(--radius-full)", DEFAULT: "var(--radius)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)",
        lg: "var(--shadow-lg)", xl: "var(--shadow-xl)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)", emphasized: "var(--ease-emphasized)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)", DEFAULT: "var(--dur-base)", slow: "var(--dur-slow)",
      },
    },
  },
};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui -- tokens`
Expected: PASS — all `tokens.test.ts` cases. If "derived defaults match" fails, reconcile `tokens.css` trailing block with `DEFAULT_DERIVED` (they must be byte-identical strings).

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/tokens.css packages/ui/tailwind-preset.cjs packages/ui/src/tokens.test.ts
git commit -m "feat(ui): tokens.css default theme + Tailwind preset + structure test"
```

---

### Task 9: Ladle catalog + brand control + theme story

**Files:**
- Create: `packages/ui/.ladle/config.mjs`
- Create: `packages/ui/.ladle/components.tsx`
- Create: `packages/ui/src/theme/theme.stories.tsx`
- Modify: `package.json` (root) — add a `catalog` convenience script

**Interfaces:**
- Consumes: `ThemeProvider` from `../theme/context`; `deriveTheme` from `../theme/derive`; `RAMP_STOPS` from `../theme/ramp`; `parseColor` + `buildRamp` from `../theme/*`.
- Produces: `npm run catalog -w @assistente-os/ui` serves a browsable catalog; a global "Brand" dropdown control (presets: **Default**, **Warm**, **Cool**, **Near-grey**) wraps every story in `<ThemeProvider>` with the matching `BrandInput`.

- [ ] **Step 1: Create `packages/ui/.ladle/config.mjs`**

```js
/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.tsx",
  defaultStory: "theme--tokens",
};
```

- [ ] **Step 2: Create `packages/ui/.ladle/components.tsx`**

```tsx
import type { GlobalProvider } from "@ladle/react";
import { ThemeProvider } from "../src/theme/context";
import type { BrandInput } from "../src/theme/types";
import "../src/tokens.css";

const PRESETS: Record<string, BrandInput | null> = {
  Default: null,
  Warm: { productName: "Warm Co", logo: { light: "" }, primaryColor: "#e2643b" },
  Cool: { productName: "Cool Co", logo: { light: "" }, primaryColor: "#2b7fd8" },
  "Near-grey": { productName: "Slate Co", logo: { light: "" }, primaryColor: "#6b7280" },
};

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const key = globalState.control?.brand?.value ?? "Default";
  return <ThemeProvider brand={PRESETS[key] ?? null}>{children}</ThemeProvider>;
};

export const argTypes = {
  brand: {
    control: { type: "select" },
    options: Object.keys(PRESETS),
    defaultValue: "Default",
  },
};
```

- [ ] **Step 3: Create `packages/ui/src/theme/theme.stories.tsx`**

```tsx
import { RAMP_STOPS } from "./ramp";

const SEMANTIC = [
  "background", "foreground", "primary", "primary-foreground", "primary-hover",
  "secondary", "muted", "accent", "accent-foreground", "destructive", "border",
  "ring", "chat-user-bubble", "chat-user-bubble-foreground",
];

function Swatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "system-ui", fontSize: 12 }}>
      <span
        style={{
          width: 40, height: 24, borderRadius: 4, border: "1px solid #0002",
          background: `oklch(var(${varName}))`,
        }}
      />
      <code>{varName}</code>
      <span style={{ opacity: 0.6 }}>{label}</span>
    </div>
  );
}

export const Tokens = () => (
  <div style={{ display: "grid", gap: 6, padding: 16 }}>
    <h3 style={{ fontFamily: "system-ui" }}>Semantic roles (react to the Brand control)</h3>
    {SEMANTIC.map((r) => (
      <Swatch key={r} label="" varName={`--${r}`} />
    ))}
    <h3 style={{ fontFamily: "system-ui", marginTop: 16 }}>Brand ramp</h3>
    <div style={{ display: "flex" }}>
      {RAMP_STOPS.map((stop) => (
        <span
          key={stop}
          title={`--brand-${stop}`}
          style={{ width: 48, height: 40, background: `oklch(var(--brand-${stop}))` }}
        />
      ))}
    </div>
  </div>
);
Tokens.storyName = "Tokens";
```

- [ ] **Step 4: Add a root convenience script — `package.json` (root), `scripts` block**

Add this line to the root `package.json` `"scripts"`:

```json
"catalog": "npm run catalog -w @assistente-os/ui"
```

- [ ] **Step 5: Verify the catalog builds (fast, non-interactive)**

Run: `npm run catalog:build -w @assistente-os/ui`
Expected: exits 0; writes `packages/ui/build/` (static catalog). If it fails on missing deps, confirm `@ladle/react` installed in Task 1.

Run: `npm test -w @assistente-os/ui`
Expected: PASS — full suite still green (stories are not tests but must typecheck).

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/.ladle packages/ui/src/theme/theme.stories.tsx package.json
echo "packages/ui/build/" >> .gitignore
git add .gitignore
git commit -m "feat(ui): Ladle catalog + global brand control + token/ramp story"
```

---

### Task 10: ADR-UI-001 + per-zone dependency guard in CI

**Files:**
- Create: `docs/adr/ADR-UI-001.md`
- Create: `.github/scripts/deps-zones.mjs`
- Create: `.github/scripts/deps-zones.test.mjs`
- Modify: `.github/workflows/ci.yml` — add a `Dependency zones` step

**Interfaces:**
- Consumes: nothing from earlier tasks (reads workspace `package.json` files on disk).
- Produces: `node .github/scripts/deps-zones.mjs` exits `0` when every workspace's `dependencies` + `devDependencies` are within its zone's allowlist, non-zero otherwise, printing the offending `package :: dep` pairs.

- [ ] **Step 1: Write `docs/adr/ADR-UI-001.md`**

```markdown
# ADR-UI-001 — Zona de frontend isenta do STDLIB_FIRST

**Status:** aceito · 2026-09-01
**Relacionado:** SPEC-HR5 (STDLIB_FIRST), spec `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md`

## Contexto

A hard-rule STDLIB_FIRST restringe dependências a `node:*`, `playwright-core`,
`@langchain/*`, `pg`, `zod`. Ela foi escrita para o runtime do daemon, do core e
do agente — código servidor de longa vida. O reposicionamento de produto exige uma
superfície de Up real (React + Tailwind + biblioteca de componentes), que não cabe
nessa allowlist e nem deveria: são preocupações e perfis de risco diferentes.

## Decisão

Duas zonas, cada uma com sua allowlist, verificadas em CI:

- **Zona backend** — `packages/{core,daemon,tools,memory,cli,voice}`. Mantém o
  STDLIB_FIRST **inalterado**. A lista efetiva é o snapshot atual das deps
  (grandfathered); apertá-la é trabalho do SPEC-HR5, fora deste ADR.
- **Zona frontend** — `packages/ui` (e futuros `packages/web`, landing). Allowlist
  própria:
  - `react`, `react-dom`, `@types/react`, `@types/react-dom`
  - `@radix-ui/*`
  - `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/*`
  - `class-variance-authority`, `clsx`, `tailwind-merge`
  - `lucide-react`
  - **um** parser de markdown + **um** sanitizador (`marked`, `dompurify`)
  - **um** highlighter (`shiki`)
  - `@ladle/react`
  - `vitest`, `@vitest/*`, `@testing-library/*`, `jsdom`, `axe-core`
  - `typescript`
  Adicionar item a esta lista = uma linha neste ADR + no array do script.

## Guard

`.github/scripts/deps-zones.mjs` roda em CI (`build-and-test`). Falha se uma
workspace tem dep fora da allowlist da sua zona. `node --test` cobre o script.

## Consequências

- Bundle size da zona de frontend passa a ser métrica vigiada (orçamento entra
  junto do SEO da landing — sub-projeto E).
- Supply-chain cresce: versões **pinadas** (sem `^`) nos `package.json` da zona;
  `npm audit --workspace` na zona de frontend entra no CI num follow-up.
- O texto de SPEC-HR5 / `system_prompt` passa a referenciar o modelo de duas
  zonas (edição feita junto com este ADR).
```

- [ ] **Step 2: Write the failing test — `.github/scripts/deps-zones.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPackage, FRONTEND_ALLOW } from "./deps-zones.mjs";

test("a frontend package with only allowlisted deps passes", () => {
  const violations = checkPackage(
    "packages/ui",
    { dependencies: { clsx: "2.1.1", "tailwind-merge": "2.5.4" }, devDependencies: { vitest: "2.1.5", react: "19.0.0" } },
    "frontend",
  );
  assert.deepEqual(violations, []);
});

test("a frontend package with an off-list dep is flagged", () => {
  const violations = checkPackage("packages/ui", { dependencies: { lodash: "4" } }, "frontend");
  assert.deepEqual(violations, ["packages/ui :: lodash"]);
});

test("a backend package importing react is flagged", () => {
  const violations = checkPackage(
    "packages/daemon",
    { dependencies: { pg: "8", react: "19" } },
    "backend",
  );
  assert.deepEqual(violations, ["packages/daemon :: react"]);
});

test("@radix-ui/* scope is allowed in frontend", () => {
  assert.ok(FRONTEND_ALLOW.some((rule) => rule("@radix-ui/react-dialog")));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test .github/scripts/deps-zones.test.mjs`
Expected: FAIL — cannot find `./deps-zones.mjs`.

- [ ] **Step 4: Write `.github/scripts/deps-zones.mjs`**

```js
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BACKEND_ZONE = ["core", "daemon", "tools", "memory", "cli", "voice"].map((p) => `packages/${p}`);
const FRONTEND_ZONE = ["packages/ui"]; // + packages/web, landing later

/** Each rule: (depName) => boolean */
export const FRONTEND_ALLOW = [
  (d) => ["react", "react-dom", "@types/react", "@types/react-dom"].includes(d),
  (d) => d.startsWith("@radix-ui/"),
  (d) => ["tailwindcss", "postcss", "autoprefixer"].includes(d) || d.startsWith("@tailwindcss/"),
  (d) => ["class-variance-authority", "clsx", "tailwind-merge"].includes(d),
  (d) => d === "lucide-react",
  (d) => ["marked", "dompurify", "shiki"].includes(d),
  (d) => d === "@ladle/react",
  (d) => d === "vitest" || d.startsWith("@vitest/") || d.startsWith("@testing-library/") || ["jsdom", "axe-core"].includes(d),
  (d) => d === "typescript",
];

/** Backend: the grandfathered snapshot (2026-09-01). SPEC-HR5 owns tightening this. */
export const BACKEND_ALLOW = [
  (d) => d.startsWith("node:"),
  (d) => d.startsWith("@langchain/"),
  (d) =>
    [
      "pg", "zod", "playwright-core", "@types/node", "@types/pg", "typescript",
      "azure-devops-node-api", "ioredis", "pino", "pino-pretty", "say", "telegraf",
      "@xenova/transformers", "busboy", "@types/busboy",
    ].includes(d),
];

export function checkPackage(pkgPath, pkgJson, zone) {
  const allow = zone === "frontend" ? FRONTEND_ALLOW : BACKEND_ALLOW;
  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  const violations = [];
  for (const dep of Object.keys(deps)) {
    if (!allow.some((rule) => rule(dep))) violations.push(`${pkgPath} :: ${dep}`);
  }
  return violations;
}

function main() {
  const root = process.cwd();
  const all = [];
  for (const [zone, paths] of [["backend", BACKEND_ZONE], ["frontend", FRONTEND_ZONE]]) {
    for (const p of paths) {
      let json;
      try {
        json = JSON.parse(readFileSync(join(root, p, "package.json"), "utf8"));
      } catch {
        continue; // package not present yet (e.g. packages/web)
      }
      all.push(...checkPackage(p, json, zone));
    }
  }
  if (all.length) {
    console.error("Dependency zone violations:\n" + all.map((v) => "  " + v).join("\n"));
    console.error("\nFix: move the dep to the right zone, or amend docs/adr/ADR-UI-001.md + FRONTEND_ALLOW.");
    process.exit(1);
  }
  console.log("dependency zones: OK");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 5: Run the test + the script**

Run: `node --test .github/scripts/deps-zones.test.mjs`
Expected: PASS — 4 tests.

Run: `node .github/scripts/deps-zones.mjs`
Expected: prints `dependency zones: OK`, exit 0. (If it flags a real dep added in Task 1 that belongs on the list, add a rule to `FRONTEND_ALLOW` and note it in the ADR.)

- [ ] **Step 6: Wire into CI — `.github/workflows/ci.yml`**

In the `build-and-test` job, after the `Typecheck` step and before the test step, add:

```yaml
      - name: Dependency zones
        run: |
          node --test .github/scripts/deps-zones.test.mjs
          node .github/scripts/deps-zones.mjs
```

- [ ] **Step 7: Commit**

```bash
git add docs/adr/ADR-UI-001.md .github/scripts/deps-zones.mjs .github/scripts/deps-zones.test.mjs .github/workflows/ci.yml
git commit -m "feat(ci): ADR-UI-001 two-zone STDLIB_FIRST + per-zone dependency guard"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 Estrutura do pacote (source-only, exports, peer/dev deps, preset) | 1, 8 |
| §2 Arquitetura de tokens (3 camadas, OKLCH, preset mapping) | 8 (+ 4 for OKLCH math) |
| §3 Contrato de tema (`BrandInput`, `DerivedVarKey` whitelist, algoritmo, nudge, `nudged`) | 3, 4, 5, 6 |
| §3 `<ThemeProvider>` + `useBrand()` + injection contract | 7 |
| §3 Catálogo brand control (mock presets) | 9 |
| §5 Ladle catalog scaffold + hybrid Stitch loop entry point | 9 (`DESIGN.md` authored during the loop, not in this plan) |
| §6 Testes: token contract, OKLCH derivation, fuzz, no-hardcoded-color (theme/preset scope) | 3, 4, 5, 6, 8 |
| §7 Deps novas + ADR-UI-001 + CI zone guard + SPEC-HR5 text | 10 |
| §4 Component inventory | **Deferred to plan A2** (stated in header) |
| §6 Component behavior tests + axe smoke | **Deferred to plan A2** (needs components) |

Gaps: none for A1's scope. `DESIGN.md` (spec §5) is a byproduct of the Stitch loop and is intentionally not a task. The `no-hardcoded-color` sweep over `src/components/**` (spec §6) moves to A2 with the components; A1 enforces the equivalent rule on the preset (Task 8, step 1, "no raw color literal in the preset").

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step has literal content. Error handling is concrete (`InvalidBrandColorError` thrown at named points; nudge fallback path spelled out).

**3. Type consistency:**
- `Oklch { l, c, h }` defined in Task 3, used identically in 4/5/6/7.
- `DerivedVarKey` (8 members) defined in Task 3; `DERIVED_VAR_KEYS` iterated in 6/7/8; `DEFAULT_DERIVED` (Task 6) keyed by it and cross-checked against `tokens.css` in Task 8.
- `parseColor`/`formatOklch` (Task 4) consumed by 6; `buildRamp`/`contrastRatio`/`passesAA`/`pickForeground` (Task 5) consumed by 6.
- `deriveTheme(brand: BrandInput): DerivedTheme` signature identical in Task 6 definition and Task 7 consumption.
- `ThemeProvider` prop `brand?: BrandInput | null` consistent between Task 7 and Task 9's `.ladle/components.tsx`.
- `checkPackage(pkgPath, pkgJson, zone)` / `FRONTEND_ALLOW` signatures identical between Task 10 test and implementation.

Fixes applied inline: none needed on final pass.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-01-design-system-ui-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — tasks run in this session via executing-plans, batched with checkpoints for review.

Which approach?
