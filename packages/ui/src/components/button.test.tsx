import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { expectNoA11yViolations } from "../test/axe";

test("renders the default variant with token classes", () => {
  render(<Button>Enviar</Button>);
  const btn = screen.getByRole("button", { name: "Enviar" });
  expect(btn.className).toMatch(/bg-primary\b/);
  expect(btn.className).toMatch(/text-primary-foreground\b/);
});

test("applies variant and size overrides", () => {
  render(
    <Button variant="ghost" size="lg">
      X
    </Button>,
  );
  const btn = screen.getByRole("button");
  expect(btn.className).toMatch(/h-12\b/);
  expect(btn.className).not.toMatch(/bg-primary\b/);
});

test("merges a caller className without dropping variant classes", () => {
  render(<Button className="w-full">Full</Button>);
  const btn = screen.getByRole("button");
  expect(btn.className).toMatch(/w-full\b/);
  expect(btn.className).toMatch(/bg-primary\b/);
});

test("asChild renders the child element instead of a <button>", () => {
  render(
    <Button asChild>
      <a href="/x">Link</a>
    </Button>,
  );
  expect(screen.getByRole("link", { name: "Link" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("disabled button is not clickable and is announced as disabled", async () => {
  const user = userEvent.setup();
  let clicked = false;
  render(
    <Button disabled onClick={() => (clicked = true)}>
      Off
    </Button>,
  );
  await user.click(screen.getByRole("button"));
  expect(clicked).toBe(false);
});

test("has no a11y violations", async () => {
  const { container } = render(<Button>Enviar</Button>);
  await expectNoA11yViolations(container);
});
