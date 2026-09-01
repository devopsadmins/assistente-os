import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

test("accepts typed input", async () => {
  const user = userEvent.setup();
  render(<Input placeholder="e-mail" />);
  const el = screen.getByPlaceholderText("e-mail");
  await user.type(el, "a@b.com");
  expect(el).toHaveValue("a@b.com");
});

test("uses token border/ring classes", () => {
  render(<Input placeholder="x" />);
  expect(screen.getByPlaceholderText("x").className).toMatch(/border-input\b/);
});
