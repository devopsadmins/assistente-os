import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeBlock } from "./code-block";
import { expectNoA11yViolations } from "../test/axe";

test("renders the code text verbatim inside a monospace block", () => {
  render(<CodeBlock code="const x = 1;" lang="ts" />);
  expect(screen.getByText("const x = 1;")).toBeInTheDocument();
});

test("shows the language badge when lang is provided", () => {
  render(<CodeBlock code="const x = 1;" lang="ts" />);
  expect(screen.getByText("ts")).toBeInTheDocument();
});

test("omits the language badge when lang is absent", () => {
  render(<CodeBlock code="plain text" />);
  expect(screen.queryByText("ts")).not.toBeInTheDocument();
});

test("copy button writes the exact code to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  render(<CodeBlock code="const x = 1;" lang="ts" />);
  await user.click(screen.getByRole("button", { name: /copiar código/i }));

  expect(writeText).toHaveBeenCalledWith("const x = 1;");
});

test("renders text content safely even when the code string contains HTML-like syntax", () => {
  render(<CodeBlock code="<script>alert(1)</script>" />);
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const { container } = render(<CodeBlock code="const x = 1;" lang="ts" />);
  await expectNoA11yViolations(container);
});
