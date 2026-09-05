import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";
import { expectNoA11yViolations } from "../test/axe";

test("toggles checked state on click", async () => {
  const user = userEvent.setup();
  render(<Switch aria-label="ativo" />);
  const el = screen.getByRole("switch", { name: "ativo" });
  expect(el).toHaveAttribute("aria-checked", "false");
  await user.click(el);
  expect(el).toHaveAttribute("aria-checked", "true");
});

test("has no a11y violations", async () => {
  const { container } = render(<Switch aria-label="ativo" />);
  await expectNoA11yViolations(container);
});
