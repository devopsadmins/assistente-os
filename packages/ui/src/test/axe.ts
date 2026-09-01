import axe from "axe-core";
import { expect } from "vitest";

/** Asserts zero axe-core violations for the given rendered container. */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}
