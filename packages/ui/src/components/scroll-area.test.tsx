import { createRef } from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

test("renders its children inside a scrollable viewport", () => {
  render(
    <ScrollArea className="h-20">
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(screen.getByText("conteúdo rolável")).toBeInTheDocument();
});

test("viewportRef reaches the real Radix viewport node, exposing scrollTop/scrollHeight (DS1)", () => {
  const viewportRef = createRef<HTMLDivElement>();
  render(
    <ScrollArea className="h-20" viewportRef={viewportRef}>
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(viewportRef.current).not.toBeNull();
  expect(viewportRef.current).toHaveAttribute("data-radix-scroll-area-viewport");
  expect(typeof viewportRef.current!.scrollTop).toBe("number");
  expect(typeof viewportRef.current!.scrollHeight).toBe("number");
});

test("the viewport is keyboard-focusable (WCAG 2.1.1/2.1.3 — scrollable-region-focusable)", () => {
  const viewportRef = createRef<HTMLDivElement>();
  render(
    <ScrollArea className="h-20" viewportRef={viewportRef}>
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(viewportRef.current).toHaveAttribute("tabindex", "0");
});
