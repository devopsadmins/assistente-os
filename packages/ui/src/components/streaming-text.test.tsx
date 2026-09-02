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
