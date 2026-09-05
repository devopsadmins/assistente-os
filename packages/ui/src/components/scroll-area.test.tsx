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

test("without viewportLabel, the focusable viewport has no region role/name (DS12 baseline)", () => {
  const viewportRef = createRef<HTMLDivElement>();
  render(
    <ScrollArea className="h-20" viewportRef={viewportRef}>
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(viewportRef.current).not.toHaveAttribute("role");
  expect(viewportRef.current).not.toHaveAttribute("aria-label");
});

test("viewportLabel gives the focusable viewport an accessible name (DS12)", () => {
  const viewportRef = createRef<HTMLDivElement>();
  render(
    <ScrollArea className="h-20" viewportRef={viewportRef} viewportLabel="Histórico da conversa">
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(screen.getByRole("region", { name: "Histórico da conversa" })).toBe(viewportRef.current);
});
