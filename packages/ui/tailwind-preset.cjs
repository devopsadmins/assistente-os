/**
 * Tailwind preset for @assistente-os/ui. Consumers:
 *   presets: [require("@assistente-os/ui/tailwind-preset")]
 * and add "./node_modules/@assistente-os/ui/src/**\/*.{ts,tsx}" to `content`.
 * No raw color values here — everything resolves to a CSS var from tokens.css.
 *
 * DS6: every var carries a fallback (`var(--x, <default>)`) matching its
 * `:root` value in tokens.css. Without it, a consumer who forgets to import
 * tokens.css gets `oklch( / 1)` — invalid, silently dropped by the CSS
 * parser, no error anywhere — instead of a visibly-unstyled-but-functional
 * page. Keep these in sync with tokens.css `:root` by hand; there's no
 * build step shared between the two files.
 */
const color = (name, fallback) => `oklch(var(--${name}, ${fallback}) / <alpha-value>)`;

module.exports = {
  theme: {
    extend: {
      colors: {
        background: color("background", "1 0 0"),
        foreground: color("foreground", "0.2 0 0"),
        border: color("border", "0.92 0 0"),
        input: color("input", "0.92 0 0"),
        overlay: color("overlay", "0.2 0 0"),
        ring: color("ring", "0.55 0.1 264"),
        card: { DEFAULT: color("card", "1 0 0"), foreground: color("card-foreground", "0.2 0 0") },
        popover: { DEFAULT: color("popover", "1 0 0"), foreground: color("popover-foreground", "0.2 0 0") },
        primary: {
          DEFAULT: color("primary", "0.55 0.17 264"),
          foreground: color("primary-foreground", "0.99 0 0"),
          hover: color("primary-hover", "0.48 0.17 264"),
        },
        secondary: { DEFAULT: color("secondary", "0.97 0 0"), foreground: color("secondary-foreground", "0.27 0 0") },
        muted: { DEFAULT: color("muted", "0.97 0 0"), foreground: color("muted-foreground", "0.5 0 0") },
        accent: { DEFAULT: color("accent", "0.96 0.02 264"), foreground: color("accent-foreground", "0.32 0.05 264") },
        destructive: {
          DEFAULT: color("destructive", "0.58 0.22 25"),
          foreground: color("destructive-foreground", "0.99 0 0"),
        },
        success: { DEFAULT: color("success", "0.62 0.17 150"), foreground: color("success-foreground", "0.99 0 0") },
        warning: { DEFAULT: color("warning", "0.75 0.15 80"), foreground: color("warning-foreground", "0.24 0.03 80") },
        danger: { DEFAULT: color("danger", "0.58 0.22 25"), foreground: color("danger-foreground", "0.99 0 0") },
        info: { DEFAULT: color("info", "0.6 0.14 240"), foreground: color("info-foreground", "0.99 0 0") },
        chat: {
          user: color("chat-user-bubble", "0.94 0.03 264"),
          "user-foreground": color("chat-user-bubble-foreground", "0.28 0.04 264"),
          assistant: color("chat-assistant-bubble", "0.97 0 0"),
          "assistant-foreground": color("chat-assistant-bubble-foreground", "0.2 0 0"),
        },
        citation: { DEFAULT: color("citation", "0.9 0.05 264"), foreground: color("citation-foreground", "0.3 0.06 264") },
        code: { bg: color("code-bg", "0.16 0 0"), fg: color("code-fg", "0.92 0 0") },
        sidebar: {
          DEFAULT: color("sidebar", "0.985 0 0"),
          foreground: color("sidebar-foreground", "0.2 0 0"),
          accent: color("sidebar-accent", "0.95 0.01 264"),
        },
      },
      fontSize: {
        xs: ["var(--text-xs)", { lineHeight: "var(--leading-xs)" }],
        sm: ["var(--text-sm)", { lineHeight: "var(--leading-sm)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-lg)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-xl)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-2xl)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-3xl)" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-4xl)" }],
      },
      spacing: {
        0: "var(--space-0)", 1: "var(--space-1)", 2: "var(--space-2)", 3: "var(--space-3)",
        4: "var(--space-4)", 6: "var(--space-6)", 8: "var(--space-8)", 12: "var(--space-12)",
        16: "var(--space-16)", 24: "var(--space-24)",
      },
      borderRadius: {
        sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)",
        xl: "var(--radius-xl)", full: "var(--radius-full)", DEFAULT: "var(--radius)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)",
        lg: "var(--shadow-lg)", xl: "var(--shadow-xl)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)", emphasized: "var(--ease-emphasized)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)", DEFAULT: "var(--dur-base)", slow: "var(--dur-slow)",
      },
    },
  },
};
