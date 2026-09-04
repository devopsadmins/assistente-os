import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Mesmo motivo do timeout alto em packages/ui/vitest.config.ts: layout
    // síncrono de componentes Radix (usados por @assistente-os/ui) pode
    // estourar o default de 5s sob contenção de CPU.
    testTimeout: 60000,
  },
});
