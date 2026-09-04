import * as React from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreamingText } from "./streaming-text";

test("renders the concatenated chunks as markdown", () => {
  render(<StreamingText chunks={["Hello ", "**world**"]} />);
  expect(screen.getByText("world").tagName).toBe("STRONG");
  expect(screen.getByText(/Hello/)).toBeInTheDocument();
});

test("shows a caret while mounted", () => {
  const { container } = render(<StreamingText chunks={["Hi"]} />);
  expect(container.querySelector(".ds-streaming-caret")).not.toBeNull();
});

// DS14: without a way to signal "the stream is over", the caret blinked
// forever even on a message that finished minutes ago.
test("DS14: stops showing the caret once done=true", () => {
  const { container, rerender } = render(<StreamingText chunks={["Hi"]} done={false} />);
  expect(container.querySelector(".ds-streaming-caret")).not.toBeNull();
  rerender(<StreamingText chunks={["Hi"]} done={true} />);
  expect(container.querySelector(".ds-streaming-caret")).toBeNull();
});

test("DS14: done defaults to false (no caret regression for existing callers)", () => {
  const { container } = render(<StreamingText chunks={["Hi"]} />);
  expect(container.querySelector(".ds-streaming-caret")).not.toBeNull();
});

// DS15: aria-busy lets assistive tech know this node is still mutating —
// without it, a screen reader has no signal to hold off announcing partial
// fragments as they stream in.
test("DS15: aria-busy tracks done — true while streaming, false once finished", () => {
  const { container, rerender } = render(<StreamingText chunks={["Hi"]} done={false} />);
  expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  rerender(<StreamingText chunks={["Hi"]} done={true} />);
  expect(container.firstElementChild).toHaveAttribute("aria-busy", "false");
});

test("tolerates an unclosed code fence mid-stream without crashing", () => {
  expect(() =>
    render(<StreamingText chunks={["Here's the fix:\n\n```ts\nconst x = 1;"]} />),
  ).not.toThrow();
  expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
});

test("tolerates an unclosed bold marker mid-stream without crashing", () => {
  expect(() => render(<StreamingText chunks={["This is **still typ"]} />)).not.toThrow();
  expect(screen.getByText(/still typ/)).toBeInTheDocument();
});

test("appends new chunks without remounting the already-rendered content", () => {
  const { container, rerender } = render(<StreamingText chunks={["Hello"]} />);
  const firstNode = container.firstElementChild;
  rerender(<StreamingText chunks={["Hello", " world"]} />);
  expect(container.firstElementChild).toBe(firstNode);
});

test("forwards a ref to the root element", () => {
  const ref = React.createRef<HTMLDivElement>();
  render(<StreamingText chunks={["Hi"]} ref={ref} />);
  expect(ref.current).not.toBeNull();
  expect(ref.current?.className).toContain("ds-streaming-text");
});

// The caret is CSS-generated content (`::after`), so it can't be asserted on
// directly via querySelectorAll — these two tests instead prove, the same
// way a `:last-child`-based selector bug was caught in review, that the
// *real-element* selector the caret's CSS rule is built on matches exactly
// the one element it's meant to: `:last-child` is evaluated per-parent, not
// globally within an ancestor, so a selector that's one combinator too loose
// silently matches more than one element instead of erroring.
test("the table caret selector matches only the last row's last cell, not every row's", () => {
  const { container } = render(
    <StreamingText chunks={["| A | B |\n", "| - | - |\n", "| 1 | 2 |\n", "| 3 | 4 |\n", "| 5 | 6 |\n"]} />,
  );
  // Mirrors the `table:last-child_tbody:last-child>tr:last-child>td:last-child`
  // arbitrary-variant selector in streaming-text.tsx's CARET_CLASSES.
  const matches = container.querySelectorAll(
    ".ds-markdown > *:last-child > table:last-child tbody:last-child > tr:last-child > td:last-child",
  );
  expect(matches).toHaveLength(1);
  expect(matches[0]?.textContent).toBe("6"); // the true last row's last cell, not the first row's
});

test("the list caret selector matches only the top-level last item, not a nested sub-list's last item", () => {
  const { container } = render(
    <StreamingText chunks={["- item 1\n", "- item 2\n", "  - nested a\n", "  - nested b\n"]} />,
  );
  // Mirrors the `:is(ul,ol):last-child>li:last-child` arbitrary-variant
  // selector in streaming-text.tsx's CARET_CLASSES.
  const matches = container.querySelectorAll(".ds-markdown > *:last-child > :is(ul,ol):last-child > li:last-child");
  expect(matches).toHaveLength(1);
  expect(matches[0]?.textContent).toContain("item 2"); // the outer item, not the nested "nested b" <li>
});
