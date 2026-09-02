import * as React from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Message } from "./message";

test("renders children inside the message bubble", () => {
  render(<Message role="assistant">Hello there</Message>);
  expect(screen.getByText("Hello there")).toBeInTheDocument();
});

test("marks the role on the root element", () => {
  const { container } = render(<Message role="user">Hi</Message>);
  expect(container.firstElementChild).toHaveAttribute("data-role", "user");
});

test('reverses layout and applies the user bubble styling for role="user"', () => {
  const { container } = render(<Message role="user">Hi</Message>);
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).toContain("flex-row-reverse");
  expect(screen.getByText("Hi").className).toContain("bg-chat-user");
});

test('applies the assistant bubble styling for role="assistant" without reversing layout', () => {
  const { container } = render(<Message role="assistant">Hi</Message>);
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).not.toContain("flex-row-reverse");
  expect(screen.getByText("Hi").className).toContain("bg-chat-assistant");
});

test("renders the avatar slot when provided", () => {
  render(
    <Message role="assistant" avatar={<span data-testid="av">A</span>}>
      Hi
    </Message>,
  );
  expect(screen.getByTestId("av")).toBeInTheDocument();
});

test("omits the avatar slot entirely when none is provided", () => {
  render(<Message role="assistant">Hi</Message>);
  expect(screen.queryByTestId("av")).not.toBeInTheDocument();
});

test("renders the footer slot below the content", () => {
  render(
    <Message role="assistant" footer={<span data-testid="ft">footer</span>}>
      Hi
    </Message>,
  );
  expect(screen.getByTestId("ft")).toBeInTheDocument();
});

test("forwards a ref to the root element", () => {
  const ref = React.createRef<HTMLDivElement>();
  render(
    <Message role="assistant" ref={ref}>
      Hi
    </Message>,
  );
  expect(ref.current).not.toBeNull();
  expect(ref.current).toHaveAttribute("data-role", "assistant");
});

test("spreads additional props onto the root element", () => {
  render(
    <Message role="assistant" data-testid="msg-root">
      Hi
    </Message>,
  );
  expect(screen.getByTestId("msg-root")).toBeInTheDocument();
});
