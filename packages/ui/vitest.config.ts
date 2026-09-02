import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Radix's Popper-based positioning (Popover, and future Popper-based
    // primitives) does real synchronous layout/position computation on open.
    // Under CPU contention (shared CI runners, loaded dev machines) this can
    // take much longer than Vitest's 5s default (observed up to ~50s under
    // heavy load in this repo's dev sandbox), causing flaky timeouts that
    // have nothing to do with correctness. 60s gives headroom without
    // masking a genuine hang.
    testTimeout: 60000,
  },
});
