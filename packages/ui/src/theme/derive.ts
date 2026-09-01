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
  set("--primary", primary);
  const primaryResolved = primary ?? parseTripletToOklch(DEFAULT_DERIVED["--primary"]);

  // --primary-foreground: white or near-black, whichever clears AA against --primary.
  set("--primary-foreground", pickForeground(primaryResolved, [WHITE, NEAR_BLACK]));

  // --primary-hover: one ramp step darker than --primary (bounded). Index by position,
  // never by object identity — a future `{...ramp[i]}` copy must still resolve correctly.
  const primaryIdx = ramp.indexOf(primaryResolved);
  const hoverIdx = primaryIdx < 0 ? 10 : Math.min(10, primaryIdx + 1);
  const hover = ramp[hoverIdx]!;
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
  // The --primary cluster shares a ramp position (--primary-hover, --ring are both derived
  // from --primary), so resetting only the fg/bg pair would leave --primary-hover/--ring on
  // the brand hue while --primary reverts to the default — an incoherent theme. Reset the
  // whole cluster together.
  const pairs: [DerivedVarKey, DerivedVarKey][] = [
    ["--primary-foreground", "--primary"],
    ["--accent-foreground", "--accent"],
    ["--chat-user-bubble-foreground", "--chat-user-bubble"],
  ];
  const PAIR_CLUSTER: Partial<Record<DerivedVarKey, DerivedVarKey[]>> = {
    "--primary": ["--primary", "--primary-foreground", "--primary-hover", "--ring"],
  };
  for (const [fgKey, bgKey] of pairs) {
    const ratio = contrastRatio(parseTripletToOklch(out[fgKey]), parseTripletToOklch(out[bgKey]));
    if (ratio < 4.5) {
      const cluster = PAIR_CLUSTER[bgKey] ?? [fgKey, bgKey];
      for (const k of cluster) {
        out[k] = DEFAULT_DERIVED[k];
        if (!nudged.includes(k)) nudged.push(k);
      }
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
