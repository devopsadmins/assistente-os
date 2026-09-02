/**
 * Tailwind config for @assistente-os/ui's OWN dev preview (Ladle catalog).
 * This is separate from `tailwind-preset.cjs`, which is what consumers of
 * the package (e.g. `packages/web`) import into their own app-level config —
 * this file exists only so `npm run catalog` (Ladle) can generate real
 * utility classes for the components while developing/reviewing them here.
 */
module.exports = {
  presets: [require("./tailwind-preset.cjs")],
  content: ["./src/**/*.{ts,tsx}", "./.ladle/**/*.{ts,tsx}"],
};
