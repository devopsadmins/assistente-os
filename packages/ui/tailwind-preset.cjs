/**
 * Tailwind preset for @assistente-os/ui. Consumers:
 *   presets: [require("@assistente-os/ui/tailwind-preset")]
 * and add "@assistente-os/ui/src/**\/*.{ts,tsx}" to `content`.
 * No raw color values here — everything resolves to a CSS var from tokens.css.
 */
const color = (name) => `oklch(var(--${name}) / <alpha-value>)`;

module.exports = {
  theme: {
    extend: {
      colors: {
        background: color("background"),
        foreground: color("foreground"),
        border: color("border"),
        input: color("input"),
        ring: color("ring"),
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("popover"), foreground: color("popover-foreground") },
        primary: {
          DEFAULT: color("primary"),
          foreground: color("primary-foreground"),
          hover: color("primary-hover"),
        },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: { DEFAULT: color("destructive"), foreground: color("destructive-foreground") },
        success: { DEFAULT: color("success"), foreground: color("success-foreground") },
        warning: { DEFAULT: color("warning"), foreground: color("warning-foreground") },
        danger: { DEFAULT: color("danger"), foreground: color("danger-foreground") },
        info: { DEFAULT: color("info"), foreground: color("info-foreground") },
        chat: {
          user: color("chat-user-bubble"),
          "user-foreground": color("chat-user-bubble-foreground"),
          assistant: color("chat-assistant-bubble"),
          "assistant-foreground": color("chat-assistant-bubble-foreground"),
        },
        citation: { DEFAULT: color("citation"), foreground: color("citation-foreground") },
        code: { bg: color("code-bg"), fg: color("code-fg") },
        sidebar: {
          DEFAULT: color("sidebar"),
          foreground: color("sidebar-foreground"),
          accent: color("sidebar-accent"),
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
