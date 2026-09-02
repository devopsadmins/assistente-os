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
