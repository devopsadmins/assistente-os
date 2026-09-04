import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

if (typeof window !== "undefined") {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }

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

  // Work around jsdom AbortSignal fetch validation bug
  // jsdom's fetch validates AbortSignal but doesn't properly recognize signals from jsdom's own AbortController
  // This is a known issue in jsdom. We work around it by using Node.js's global AbortController/AbortSignal
  try {
    if (typeof globalThis.AbortController !== "undefined") {
      // Replace jsdom's AbortController/Signal with Node.js versions for compatibility with fetch
      const NodeAbortController = globalThis.AbortController;
      const NodeAbortSignal = globalThis.AbortSignal;

      Object.defineProperty(window, "AbortController", {
        value: NodeAbortController,
        configurable: true,
        writable: true,
      });

      Object.defineProperty(window, "AbortSignal", {
        value: NodeAbortSignal,
        configurable: true,
        writable: true,
      });

      // Also replace fetch to use Node.js fetch which properly handles Node.js AbortSignal
      Object.defineProperty(window, "fetch", {
        value: globalThis.fetch,
        configurable: true,
        writable: true,
      });
    }
  } catch (e) {
    // If setup fails, continue with default jsdom behavior
  }
}

afterEach(() => {
  cleanup();
});
