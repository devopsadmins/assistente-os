import axe from "axe-core";
import { expect } from "vitest";

/** Asserts zero axe-core violations for the given rendered container. */
export async function expectNoA11yViolations(
  container: Element,
  options?: { disableRules?: string[] },
): Promise<void> {
  const disabled = ["color-contrast", ...(options?.disableRules ?? [])];
  const rules = Object.fromEntries(disabled.map((id) => [id, { enabled: false }]));
  const results = await axe.run(container, { rules });
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}
