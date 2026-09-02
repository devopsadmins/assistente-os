import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./checkbox";

test("toggles checked state on click and via Space", async () => {
  const user = userEvent.setup();
  render(<Checkbox aria-label="aceito" />);
  const el = screen.getByRole("checkbox", { name: "aceito" });
  expect(el).toHaveAttribute("aria-checked", "false");
  await user.click(el);
  expect(el).toHaveAttribute("aria-checked", "true");
  await user.keyboard(" ");
  expect(el).toHaveAttribute("aria-checked", "false");
});
