# CSS → Tailwind Mapping Guide

## Visão Geral
Este guia documenta como propriedades CSS extraídas são mapeadas para tokens do Tailwind CSS no `tailwind.config.ts`.

---

## Cores (Colors)

### CSS Custom Properties → Tailwind
```css
/* CSS */
:root {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-secondary: #64748b;
  --color-background: #ffffff;
  --color-surface: #f8fafc;
  --color-text: #1e293b;
  --color-text-muted: #64748b;
  --color-border: #e2e8f0;
}

/* Tailwind config */
colors: {
  primary: {
    DEFAULT: '#3b82f6',
    hover: '#2563eb',
  },
  secondary: '#64748b',
  background: '#ffffff',
  surface: '#f8fafc',
  text: {
    DEFAULT: '#1e293b',
    muted: '#64748b',
  },
  border: '#e2e8f0',
}
```

### RGB/RGBA → Tailwind
```css
/* CSS */
color: rgb(59, 130, 246);
background: rgba(59, 130, 246, 0.1);

/* Tailwind */
colors: {
  primary: {
    DEFAULT: 'rgb(59 130 246)',
    '10': 'rgb(59 130 246 / 0.1)',
  }
}
```

### HSL/HSLA → Tailwind
```css
/* CSS */
color: hsl(221, 83%, 53%);
background: hsla(221, 83%, 53%, 0.1);

/* Tailwind - converter para RGB ou usar arbitrary values */
colors: {
  primary: {
    DEFAULT: 'hsl(221 83% 53%)',
    '10': 'hsl(221 83% 53% / 0.1)',
  }
}
```

### Gradientes
```css
/* CSS */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* Tailwind - usar arbitrary values ou custom utilities */
backgroundImage: {
  'gradient-primary': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
}
```

---

## Tipografia (Typography)

### Font Families
```css
/* CSS */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
font-family: 'Georgia', serif;

/* Tailwind */
fontFamily: {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  serif: ['Georgia', 'ui-serif', 'Georgia', 'serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
}
```

### Font Sizes
```css
/* CSS */
font-size: 16px;    /* 1rem */
font-size: 18px;    /* 1.125rem */
font-size: 24px;    /* 1.5rem */
font-size: 32px;    /* 2rem */
font-size: 48px;    /* 3rem */

/* Tailwind */
fontSize: {
  base: '1rem',      // 16px
  lg: '1.125rem',    // 18px
  xl: '1.25rem',     // 20px
  '2xl': '1.5rem',   // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem',  // 36px
  '5xl': '3rem',     // 48px
  '6xl': '3.75rem',  // 60px
}
```

### Font Weights
```css
/* CSS */
font-weight: 300;  /* light */
font-weight: 400;  /* normal */
font-weight: 500;  /* medium */
font-weight: 600;  /* semibold */
font-weight: 700;  /* bold */
font-weight: 800;  /* extrabold */

/* Tailwind */
fontWeight: {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
}
```

### Line Heights
```css
/* CSS */
line-height: 1.5;
line-height: 1.625;
line-height: 1.25;

/* Tailwind */
lineHeight: {
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
}
```

---

## Espaçamento (Spacing)

### Padding/Margin/Gap
```css
/* CSS */
padding: 8px;    /* 0.5rem */
padding: 16px;   /* 1rem */
padding: 24px;   /* 1.5rem */
padding: 32px;   /* 2rem */
padding: 48px;   /* 3rem */
padding: 64px;   /* 4rem */

/* Tailwind */
spacing: {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem',     // 96px
}
```

### Valores Arbitrários
```css
/* CSS */
padding: 13px;
margin-top: -8px;

/* Tailwind - usar arbitrary values */
<div class="p-[13px] -mt-2">
```

---

## Border Radius

```css
/* CSS */
border-radius: 4px;   /* 0.25rem */
border-radius: 8px;   /* 0.5rem */
border-radius: 12px;  /* 0.75rem */
border-radius: 16px;  /* 1rem */
border-radius: 50%;   /* full */

/* Tailwind */
borderRadius: {
  none: '0',
  sm: '0.25rem',    // 4px
  DEFAULT: '0.375rem', // 6px
  md: '0.5rem',     // 8px
  lg: '0.75rem',    // 12px
  xl: '1rem',       // 16px
  '2xl': '1.5rem',  // 24px
  full: '9999px',
}
```

---

## Sombras (Box Shadows)

```css
/* CSS */
box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);

/* Tailwind */
boxShadow: {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
}
```

---

## Transições (Transitions)

```css
/* CSS */
transition: all 0.2s ease;
transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out;
transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

/* Tailwind */
transitionDuration: {
  75: '75ms',
  100: '100ms',
  150: '150ms',
  200: '200ms',
  300: '300ms',
  500: '500ms',
  700: '700ms',
  1000: '1000ms',
}

transitionTimingFunction: {
  DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  linear: 'linear',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
}

transitionProperty: {
  none: 'none',
  all: 'all',
  DEFAULT: 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter',
  colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
  opacity: 'opacity',
  shadow: 'box-shadow',
  transform: 'transform',
}
```

---

## Breakpoints (Responsive)

```css
/* CSS Media Queries */
@media (min-width: 640px) { }
@media (min-width: 768px) { }
@media (min-width: 1024px) { }
@media (min-width: 1280px) { }
@media (min-width: 1536px) { }

/* Tailwind */
screens: {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
}
```

---

## Z-Index

```css
/* CSS */
z-index: 10;
z-index: 20;
z-index: 50;
z-index: 100;

/* Tailwind */
zIndex: {
  0: '0',
  10: '10',
  20: '20',
  30: '30',
  40: '40',
  50: '50',
  auto: 'auto',
}
```

---

## Filtros e Backdrop

```css
/* CSS */
filter: blur(8px);
backdrop-filter: blur(8px);
backdrop-filter: blur(4px) saturate(1.5);

/* Tailwind */
blur: {
  none: '0',
  sm: '4px',
  DEFAULT: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '40px',
  '3xl': '64px',
}

backdropBlur: {
  none: '0',
  sm: '4px',
  DEFAULT: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '40px',
  '3xl': '64px',
}
```

---

## Animações (Keyframes)

```css
/* CSS */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Tailwind */
keyframes: {
  fadeIn: {
    '0%': { opacity: '0' },
    '100%': { opacity: '1' },
  },
  slideUp: {
    '0%': { transform: 'translateY(10px)', opacity: '0' },
    '100%': { transform: 'translateY(0)', opacity: '1' },
  },
  spin: {
    to: { transform: 'rotate(360deg)' },
  },
  ping: {
    '75%, 100%': { transform: 'scale(2)', opacity: '0' },
  },
  pulse: {
    '50%': { opacity: '0.5' },
  },
  bounce: {
    '0%, 100%': { transform: 'translateY(-25%)', animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)' },
    '50%': { transform: 'translateY(0)', animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)' },
  },
}

animation: {
  none: 'none',
  spin: 'spin 1s linear infinite',
  ping: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
  pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  bounce: 'bounce 1s infinite',
  'fade-in': 'fadeIn 0.3s ease-out',
  'slide-up': 'slideUp 0.4s ease-out',
}
```

---

## Arbitrary Values (Valores Arbitrários)

Quando o token não existe no Tailwind, use `[valor]`:

```html
<!-- Cores -->
<div class="bg-[#1a2b3c] text-[#ffffff]">

<!-- Espaçamento -->
<div class="p-[13px] m-[-8px] gap-[2.5rem]">

<!-- Tipografia -->
<div class="text-[13px] leading-[1.4] font-[550]">

<!-- Border Radius -->
<div class="rounded-[13px]">

<!-- Sombras -->
<div class="shadow-[0_4px_6px_-1px_rgb(0_0_0_/0.1)]">

<!-- Transições -->
<div class="transition-[width,height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]">

<!-- Z-Index -->
<div class="z-[9999]">

<!-- Grid/Flex -->
<div class="grid-cols-[1fr_2fr_1fr] grid-rows-[auto_1fr_auto]">
```

---

## Dark Mode

```css
/* CSS */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f172a;
    --color-text: #f1f5f9;
  }
}

/* Tailwind */
darkMode: 'class', // ou 'media'

// No config:
colors: {
  background: {
    DEFAULT: '#ffffff',
    dark: '#0f172a',
  },
  text: {
    DEFAULT: '#1e293b',
    dark: '#f1f5f9',
  },
}
```

---

## Container Queries (Experimental)

```css
/* CSS */
@container (min-width: 400px) {
  .card { grid-template-columns: 1fr 1fr; }
}

/* Tailwind v3.4+ */
@custom-variant container (&:is(.container, .container *));
```