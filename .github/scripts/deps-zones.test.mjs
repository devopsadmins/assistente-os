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
