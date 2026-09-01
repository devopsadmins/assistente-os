// @vitest-environment node
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

test("each of the 8 derived vars is declared exactly once in the :root block", () => {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/)![1]!;
  for (const key of DERIVED_VAR_KEYS) {
    const re = new RegExp(`^\\s*${key}\\s*:`, "gm");
    const matches = block.match(re) ?? [];
    expect(matches.length, `${key} declared ${matches.length} times, expected 1`).toBe(1);
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
