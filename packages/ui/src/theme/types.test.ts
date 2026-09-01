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
