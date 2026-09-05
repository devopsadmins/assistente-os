import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../lib/cn";

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  /**
   * Ref to the underlying Radix Viewport DOM node — needed for scrollTop/
   * scrollHeight/onScroll access (e.g. MessageList's auto-scroll-to-bottom
   * and "jump to latest" affordance). See DS1 in docs/BACKLOG-DESIGN-SYSTEM.md.
   */
  viewportRef?: React.Ref<React.ElementRef<typeof ScrollAreaPrimitive.Viewport>>;
  /**
   * DS12: `tabIndex={0}` below makes the viewport a keyboard tab stop (for
   * axe's scrollable-region-focusable rule), but a focusable region with no
   * accessible name is worse for screen reader users than a non-focusable
   * one — they land on it with no idea what it is. Opt in to a real name.
   */
  viewportLabel?: string;
}

export const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, viewportRef, viewportLabel, ...props }, ref) => (
    <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
      {/*
        tabIndex makes the scrollable region itself keyboard-focusable so
        arrow/Page Up/Page Down scrolling works without a mouse — Radix's
        Viewport doesn't set this by default, and axe-core's
        scrollable-region-focusable rule (WCAG 2.1.1/2.1.3) flags its
        absence. Surfaced by MessageList's a11y test (task-2).
      */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className="h-full w-full rounded-[inherit]"
        tabIndex={0}
        role={viewportLabel ? "region" : undefined}
        aria-label={viewportLabel}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none border-l border-l-transparent p-px transition-colors"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        className="flex h-2.5 touch-none select-none border-t border-t-transparent p-px transition-colors"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = "ScrollArea";
