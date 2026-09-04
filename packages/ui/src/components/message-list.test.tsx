import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageList } from "./message-list";
import { expectNoA11yViolations } from "../test/axe";

function stubScrollGeometry(scrollHeight: number, clientHeight: number) {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-radix-scroll-area-viewport]");
  if (!el) throw new Error("viewport not found in rendered MessageList");
  return el as HTMLElement;
}

test("scrolls to the bottom on mount", () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  expect(getViewport(container).scrollTop).toBe(500);
});

test("shows the jump-to-latest button once the reader scrolls away from the bottom", () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  expect(screen.queryByRole("button", { name: /ir para o final/i })).not.toBeInTheDocument();

  viewport.scrollTop = 100; // far from the 500-scrollHeight bottom, past the 48px threshold
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();
});

test("clicking the jump-to-latest button scrolls to the bottom and hides the button", async () => {
  stubScrollGeometry(500, 200);
  const user = userEvent.setup();
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  const button = screen.getByRole("button", { name: /ir para o final/i });

  await user.click(button);

  expect(viewport.scrollTop).toBe(500);
  expect(screen.queryByRole("button", { name: /ir para o final/i })).not.toBeInTheDocument();
});

test("auto-scrolls when new content is appended while already at the bottom", async () => {
  stubScrollGeometry(500, 200);
  const { container, rerender } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  expect(viewport.scrollTop).toBe(500); // mounted already at the bottom

  stubScrollGeometry(700, 200); // the new message made the content taller
  rerender(
    <MessageList>
      <div>msg 1</div>
      <div>msg 2</div>
    </MessageList>,
  );

  await waitFor(() => expect(viewport.scrollTop).toBe(700));
});

test("does not yank the scroll position when new content arrives after the reader scrolled up", async () => {
  stubScrollGeometry(500, 200);
  const { container, rerender } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 50;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();

  stubScrollGeometry(700, 200);
  rerender(
    <MessageList>
      <div>msg 1</div>
      <div>msg 2</div>
    </MessageList>,
  );

  // Let the MutationObserver's microtask run, then confirm it declined to move the viewport.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(viewport.scrollTop).toBe(50);
  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();
});

test("clicking the jump-to-latest button moves focus to the scrollable region", async () => {
  stubScrollGeometry(500, 200);
  const user = userEvent.setup();
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  const button = screen.getByRole("button", { name: /ir para o final/i });

  await user.click(button);

  expect(viewport).toHaveFocus();
});

test("has no a11y violations once the jump-to-latest button is visible", async () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  await expectNoA11yViolations(container);
});

// DS15: without role="log"/aria-live, a screen reader is never told a new
// message arrived — the transcript grows silently under it.
test("DS15: content region is announced as a log (role=log, aria-live=polite)", () => {
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const log = screen.getByRole("log");
  expect(log).toHaveAttribute("aria-live", "polite");
  expect(container.querySelector('[role="log"]')?.textContent).toContain("msg 1");
});
