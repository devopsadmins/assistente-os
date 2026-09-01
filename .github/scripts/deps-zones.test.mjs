import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPackage, findUnassignedPackages, FRONTEND_ALLOW } from "./deps-zones.mjs";

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

test("an off-list peerDependency is flagged", () => {
  const violations = checkPackage(
    "packages/ui",
    { peerDependencies: { "left-pad": "1.0.0" } },
    "frontend",
  );
  assert.deepEqual(violations, ["packages/ui :: left-pad"]);
});

test("an allowlisted peerDependency (react) is not flagged", () => {
  const violations = checkPackage(
    "packages/ui",
    { peerDependencies: { react: ">=19", "react-dom": ">=19" } },
    "frontend",
  );
  assert.deepEqual(violations, []);
});

test("an off-list optionalDependency is flagged", () => {
  const violations = checkPackage(
    "packages/daemon",
    { optionalDependencies: { fsevents: "2.3.3" } },
    "backend",
  );
  assert.deepEqual(violations, ["packages/daemon :: fsevents"]);
});

// Zone discovery (findUnassignedPackages) walks the real packages/ tree at repo root and is
// covered end-to-end by `node .github/scripts/deps-zones.mjs` (main()) in CI/the verify step —
// every current packages/* dir (cli, core, daemon, memory, tools, ui, voice) is assigned in
// BACKEND_ZONE/FRONTEND_ZONE, so that run passes with no unassigned-package violations. This
// unit test just pins the function's shape/behaviour against a fixture directory tree so a
// zone-discovery regression fails fast without needing the whole repo.
test("findUnassignedPackages flags a packages/* dir not in any zone", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "deps-zones-"));
  try {
    mkdirSync(join(root, "packages", "mystery"), { recursive: true });
    writeFileSync(join(root, "packages", "mystery", "package.json"), "{}");
    mkdirSync(join(root, "packages", "ui"), { recursive: true });
    writeFileSync(join(root, "packages", "ui", "package.json"), "{}");
    const violations = findUnassignedPackages(root);
    assert.deepEqual(violations, ["packages/mystery :: (unassigned to a dependency zone)"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
