import { Page } from 'playwright';

export interface DesignTokens {
  colors: Record<string, string>;
  typography: {
    fontFamilies: Record<string, string>;
    fontSizes: Record<string, string>;
    fontWeights: Record<string, number>;
    lineHeights: Record<string, string>;
  };
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
  transitions: Record<string, string>;
  zIndices: Record<string, number>;
}

// Browser context types for page.evaluate - use loose types to avoid DOM constraint issues
interface BrowserElement {
  className: string;
  id: string;
  tagName: string;
  textContent: string | null;
  children: any;
  parentElement: BrowserElement | null;
}

interface BrowserDocument {
  querySelectorAll(selectors: string): any;
  body: BrowserElement;
}

interface BrowserWindow {
  getComputedStyle(element: BrowserElement): CSSStyleDeclaration;
}

declare const document: BrowserDocument;
declare const window: BrowserWindow;

export async function extractDesignTokens(page: Page): Promise<DesignTokens> {
  return await page.evaluate(() => {
    // NOTE: everything below runs in the browser context. Helpers must be
    // declared inside this callback — closures over module scope are not
    // serialized by page.evaluate().
    function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
      const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (rgbMatch) {
        return {
          r: parseInt(rgbMatch[1]),
          g: parseInt(rgbMatch[2]),
          b: parseInt(rgbMatch[3]),
          a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1,
        };
      }
      const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/);
      if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
          return {
            r: parseInt(hex[0] + hex[0], 16),
            g: parseInt(hex[1] + hex[1], 16),
            b: parseInt(hex[2] + hex[2], 16),
            a: 1,
          };
        }
        if (hex.length === 6) {
          return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: 1,
          };
        }
        if (hex.length === 8) {
          return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: parseInt(hex.slice(6, 8), 16) / 255,
          };
        }
      }
      return null;
    }

    function categorizeColor(color: string, index: number): string {
      const rgb = parseColor(color);
      if (!rgb) return `color-${index + 1}`;

      const { r, g, b, a } = rgb;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);

      if (a < 1) return `color-${index + 1}-transparent`;
      if (brightness > 200 && saturation < 30) return `color-${index + 1}-light-neutral`;
      if (brightness < 50 && saturation < 30) return `color-${index + 1}-dark-neutral`;
      if (saturation > 100) return `color-${index + 1}-accent`;
      return `color-${index + 1}`;
    }

    const tokens: DesignTokens = {
      colors: {},
      typography: {
        fontFamilies: {},
        fontSizes: {},
        fontWeights: {},
        lineHeights: {},
      },
      spacing: {},
      borderRadius: {},
      shadows: {},
      breakpoints: {},
      transitions: {},
      zIndices: {},
    };

    const allElements = document.querySelectorAll('*');
    const colorSet = new Set<string>();
    const fontFamilySet = new Set<string>();
    const fontSizeSet = new Set<string>();
    const fontWeightSet = new Set<number>();
    const lineHeightSet = new Set<string>();
    const spacingSet = new Set<string>();
    const radiusSet = new Set<string>();
    const shadowSet = new Set<string>();
    const transitionSet = new Set<string>();
    const zIndexSet = new Set<number>();

    allElements.forEach((el: BrowserElement) => {
      const style = window.getComputedStyle(el);
      
      ['color', 'background-color', 'border-color', 'outline-color'].forEach(prop => {
        const val = style[prop as any];
        if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
          colorSet.add(val);
        }
      });

      if (style.fontFamily) fontFamilySet.add(style.fontFamily);
      if (style.fontSize) fontSizeSet.add(style.fontSize);
      if (style.fontWeight) fontWeightSet.add(parseInt(style.fontWeight) || 400);
      if (style.lineHeight && style.lineHeight !== 'normal') lineHeightSet.add(style.lineHeight);

      ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
       'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
       'gap', 'row-gap', 'column-gap'].forEach(prop => {
        const val = style[prop as any];
        if (val && val !== '0px') spacingSet.add(val);
      });

      ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 
       'border-bottom-left-radius', 'border-bottom-right-radius'].forEach(prop => {
        const val = style[prop as any];
        if (val && val !== '0px') radiusSet.add(val);
      });

      if (style.boxShadow && style.boxShadow !== 'none') shadowSet.add(style.boxShadow);

      if (style.transition && style.transition !== 'all 0s ease 0s') transitionSet.add(style.transition);

      if (style.zIndex && style.zIndex !== 'auto') zIndexSet.add(parseInt(style.zIndex) || 0);
    });

    const colorArray = Array.from(colorSet);
    colorArray.forEach((color, i) => {
      const key = categorizeColor(color, i);
      tokens.colors[key] = color;
    });

    Array.from(fontFamilySet).slice(0, 3).forEach((font, i) => {
      tokens.typography.fontFamilies[`font-${i + 1}`] = font.replace(/['"]/g, '');
    });

    Array.from(fontSizeSet).forEach((size, i) => {
      const px = parseFloat(size);
      if (px > 0) {
        tokens.typography.fontSizes[`size-${i + 1}`] = `${(px / 16).toFixed(3)}rem`;
      }
    });

    Array.from(fontWeightSet).sort((a, b) => a - b).forEach((weight, i) => {
      tokens.typography.fontWeights[`weight-${i + 1}`] = weight;
    });

    Array.from(lineHeightSet).slice(0, 5).forEach((lh, i) => {
      tokens.typography.lineHeights[`lh-${i + 1}`] = lh;
    });

    Array.from(spacingSet).slice(0, 20).forEach((space, i) => {
      const px = parseFloat(space);
      if (px > 0) {
        tokens.spacing[`space-${i + 1}`] = `${(px / 16).toFixed(3)}rem`;
      }
    });

    Array.from(radiusSet).slice(0, 8).forEach((rad, i) => {
      const px = parseFloat(rad);
      if (px >= 0) {
        tokens.borderRadius[`radius-${i + 1}`] = `${(px / 16).toFixed(3)}rem`;
      }
    });

    Array.from(shadowSet).slice(0, 6).forEach((shadow, i) => {
      tokens.shadows[`shadow-${i + 1}`] = shadow;
    });

    Array.from(transitionSet).slice(0, 8).forEach((trans, i) => {
      tokens.transitions[`transition-${i + 1}`] = trans;
    });

    Array.from(zIndexSet).sort((a, b) => a - b).slice(0, 10).forEach((z, i) => {
      tokens.zIndices[`z-${i + 1}`] = z;
    });

    tokens.breakpoints = {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    };

    return tokens;
  });
}