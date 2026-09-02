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
