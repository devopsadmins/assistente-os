import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Some test files (e.g. src/tokens.test.ts) opt into `@vitest-environment
// node`, where there is no `window`/`document`/`Element` at all. This setup
// file still runs for them, so every DOM polyfill below must be guarded.
if (typeof window !== "undefined") {
  // jsdom does not provide navigator.clipboard by default. Add a polyfill.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => text,
      },
      writable: true,
      configurable: true,
    });
  }

  // jsdom does not implement ResizeObserver. Radix's Popper-based positioning
  // (used by Popover, and anything else built on @radix-ui/react-popper) needs
  // it to observe the anchor/content elements; without a stub the constructor
  // throws and the floating content never mounts, hanging user-event's click.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }

  // jsdom has no PointerEvent constructor. @testing-library/user-event's click
  // sequence dispatches real PointerEvents, and Radix's primitives listen for
  // them; without this the dispatch silently misfires and user-event stalls
  // retrying with real timers (observed as tens of seconds of "hang").
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }
    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
  }

  // jsdom also has no pointer-capture or scrollIntoView implementations. Radix's
  // dismissable layer / popper primitives (Popover, Dialog's Escape handling,
  // etc.) call these on every pointer interaction; without them user-event's
  // click sequence stalls waiting on APIs that silently never resolve.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
});
