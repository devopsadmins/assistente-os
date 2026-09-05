// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const componentsDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = fileURLToPath(new URL("..", import.meta.url));

// DS7: the sweep used to check only the top level of src/components/ —
// `entry.isDirectory()` skipped subdirectories entirely instead of
// recursing, and src/hooks/ + src/lib/ (siblings of components/) weren't
// scanned at all. Both gaps are fixed here.
//
// src/theme/ is deliberately excluded, not missed: it's the color engine's
// own implementation (parsing/converting OKLCH, named-color lookup tables in
// color.ts) — raw color literals there are the whole point, not a leak of
// hardcoded styling. `tokens.css` (the other legitimate home for raw color
// values) isn't a .ts/.tsx file and was never in scope for this regex sweep.
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(join(dir, entry.name)));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

const files = [
  ...listSourceFiles(componentsDir),
  ...listSourceFiles(join(srcDir, "hooks")),
  ...listSourceFiles(join(srcDir, "lib")),
];

test("found at least the primitives this plan added (sanity check the sweep isn't scanning an empty dir)", () => {
  expect(files.length).toBeGreaterThanOrEqual(19);
});

test.each(files.map((f) => [f.split("/").pop()!, f] as const))("%s has no raw color literal", (_name, path) => {
  const src = readFileSync(path, "utf8");
  expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(src).not.toMatch(/\brgb\(/);
  expect(src).not.toMatch(/\bhsl\(/);
  expect(src).not.toMatch(/\boklch\(/);
});
