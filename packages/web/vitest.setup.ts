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
}

// jsdom's own window.fetch is a lightweight shim that lazily requires its
// OWN private bundled copy of undici and validates `signal` against THAT
// module's internal AbortSignal class — not the ambient global one. So
// literally any AbortSignal (even a bare `AbortSignal.timeout(...)`, no
// AbortController involved) fails with "Expected signal to be an instance
// of AbortSignal" under vitest's jsdom environment. Replacing fetch/
// Headers/Request/Response with the real `undici` package's exports fixes
// this: undici's own fetch validates against undici's own AbortSignal,
// which the ambient global AbortController's `.signal` genuinely is an
// instance of (confirmed empirically: `new AbortController().signal
// instanceof AbortSignal` is true against the global class — the mismatch
// is only inside jsdom's private fetch shim, not the ambient realm).
// Known limits of this swap (doc-only, no test currently depends on either):
//  - undici's fetch has no `window.location` to resolve a RELATIVE URL
//    against. Production's real `ApiClientConfig.baseUrl: ""` (same-origin,
//    proxied by Vite — see client.ts) would throw under this test fetch. So
//    the actual production fetch configuration is structurally untestable
//    in this package as currently set up; every test here uses an absolute
//    `daemon.url` from `startFakeDaemon` instead.
//  - undici does no CORS enforcement and sends no `Origin` header, so these
//    tests prove the SSE/JSON parsing and our own code paths work, but
//    nothing about actual browser fetch/CORS semantics against the real
//    daemon.
if (typeof window !== "undefined") {
  const undici = await import("undici");
  globalThis.fetch = undici.fetch as unknown as typeof fetch;
  globalThis.Headers = undici.Headers as unknown as typeof Headers;
  globalThis.Request = undici.Request as unknown as typeof Request;
  globalThis.Response = undici.Response as unknown as typeof Response;
}

afterEach(() => {
  cleanup();
});
