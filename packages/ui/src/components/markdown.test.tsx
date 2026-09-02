import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./markdown";

test("renders headings, bold, and links", () => {
  render(<Markdown source={"# Title\n\nSome **bold** text with a [link](https://example.com)."} />);
  expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
  expect(screen.getByText("bold")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://example.com");
});

test("renders GFM tables and strikethrough", () => {
  const source = "~~gone~~\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  render(<Markdown source={source} />);
  expect(screen.getByText("gone").tagName).toBe("DEL");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("renders a fenced code block as a real CodeBlock element with a working copy button", () => {
  render(<Markdown source={"```ts\nconst x = 1;\n```"} />);
  expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  expect(screen.getByText("ts")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /copiar código/i })).toBeInTheDocument();
});

test("sanitizes a raw <script> injection attempt embedded in the source", () => {
  const { container } = render(<Markdown source={'Hello <script>window.__pwned = true;</script> world'} />);
  expect(container.querySelector("script")).toBeNull();
  expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
});

test("renders a [[n]] citation marker as a static, non-interactive superscript", () => {
  render(<Markdown source={"Some claim [[1]] follows."} />);
  const marker = screen.getByText("1");
  expect(marker.tagName).toBe("SUP");
  expect(marker).not.toHaveAttribute("role", "button");
});

test("drops empty spacer blocks between blocks instead of doubling the layout gap", () => {
  const source = "# Title\n\nSome paragraph.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```";
  const { container } = render(<Markdown source={source} />);
  const emptyDivs = Array.from(container.querySelectorAll("div")).filter((el) => el.innerHTML === "");
  expect(emptyDivs).toHaveLength(0);
});
