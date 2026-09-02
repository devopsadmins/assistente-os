import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  expect(screen.getByTestId("code-block-lang")).toHaveTextContent("");
});

test("shows only the language token when the fence info string has extra content", () => {
  render(<CodeBlock code="const x = 1;" lang='ts title="a.ts"' />);
  expect(screen.getByTestId("code-block-lang")).toHaveTextContent("ts");
});

test("copy button writes the exact code to the clipboard", async () => {
  // @testing-library/user-event's setup() installs its own (getter-only)
  // navigator.clipboard as a side effect, so the mock must be installed
  // via defineProperty *after* setup() — Object.assign before setup() gets
  // silently discarded, and Object.assign after setup() throws ("has only
  // a getter") since the installed property has no setter.
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });

  try {
    render(<CodeBlock code="const x = 1;" lang="ts" />);
    await user.click(screen.getByRole("button", { name: /copiar código/i }));
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  } finally {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  }
});

test("renders text content safely even when the code string contains HTML-like syntax", () => {
  render(<CodeBlock code="<script>alert(1)</script>" />);
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const { container } = render(<CodeBlock code="const x = 1;" lang="ts" />);
  await expectNoA11yViolations(container);
});
