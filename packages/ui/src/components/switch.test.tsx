import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

test("toggles checked state on click", async () => {
  const user = userEvent.setup();
  render(<Switch aria-label="ativo" />);
  const el = screen.getByRole("switch", { name: "ativo" });
  expect(el).toHaveAttribute("aria-checked", "false");
  await user.click(el);
  expect(el).toHaveAttribute("aria-checked", "true");
});
