import { Page } from 'playwright';

export interface ComponentMap {
  selector: string;
  type: string;
  props: Record<string, unknown>;
  children: ComponentMap[];
  styles: Record<string, string>;
  viewport: string;
}

// Browser context types for page.evaluate - use loose types to avoid DOM constraint issues
interface BrowserElement {
  className: string;
  id: string;
  tagName: string;
  textContent: string | null;
  children: any; // HTMLCollectionOf<BrowserElement>;
  parentElement: BrowserElement | null;
}

interface BrowserDocument {
  body: BrowserElement;
  querySelectorAll(selectors: string): any; // NodeListOf<BrowserElement>
  querySelector(selectors: string): BrowserElement | null;
}

interface BrowserWindow {
  getComputedStyle(element: BrowserElement): CSSStyleDeclaration;
}

declare const document: BrowserDocument;
declare const window: BrowserWindow;

export async function mapComponents(page: Page): Promise<ComponentMap[]> {
  return await page.evaluate(() => {
    // NOTE: runs in the browser context — constants and helpers must live
    // inside this callback (closures over module scope are not serialized).
    const COMPONENT_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
      { pattern: /hero|banner|jumbotron/i, type: 'Hero' },
      { pattern: /nav|navbar|header|menu/i, type: 'Nav' },
      { pattern: /footer/i, type: 'Footer' },
      { pattern: /button|btn|cta/i, type: 'Button' },
      { pattern: /card|feature|pricing|plan/i, type: 'Card' },
      { pattern: /carousel|slider|swiper/i, type: 'Carousel' },
      { pattern: /accordion|collapse/i, type: 'Accordion' },
      { pattern: /tab|tablist/i, type: 'Tabs' },
      { pattern: /modal|dialog|popup/i, type: 'Modal' },
      { pattern: /dropdown|select/i, type: 'Dropdown' },
      { pattern: /form|input|textarea|select/i, type: 'Form' },
      { pattern: /countdown|timer/i, type: 'Countdown' },
      { pattern: /grid|container|wrapper/i, type: 'Grid' },
      { pattern: /section|block/i, type: 'Section' },
    ];

    const components: ComponentMap[] = [];
    const processed = new WeakSet<BrowserElement>();

    function getElementType(el: BrowserElement): string {
      const className = el.className || '';
      const id = el.id || '';
      const tagName = el.tagName.toLowerCase();
      const text = el.textContent?.slice(0, 50) || '';
      const combined = `${className} ${id} ${tagName} ${text}`;

      for (const { pattern, type } of COMPONENT_PATTERNS) {
        if (pattern.test(combined)) return type;
      }

      if (['header', 'nav', 'footer', 'main', 'section', 'article', 'aside'].includes(tagName)) {
        return tagName.charAt(0).toUpperCase() + tagName.slice(1);
      }
      return 'Div';
    }

    function extractStyles(el: BrowserElement): Record<string, string> {
      const style = window.getComputedStyle(el);
      const relevant: Record<string, string> = {};
      const props = [
        'display', 'position', 'flex-direction', 'justify-content', 'align-items',
        'gap', 'grid-template-columns', 'grid-template-rows',
        'padding', 'margin', 'width', 'height', 'max-width', 'min-height',
        'background-color', 'color', 'font-size', 'font-weight', 'line-height',
        'border-radius', 'box-shadow', 'border', 'overflow',
        'z-index', 'opacity', 'transform', 'transition',
      ];
      props.forEach((prop: string) => {
        const val = style[prop as any];
        if (val && val !== 'normal' && val !== 'auto' && val !== 'none' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)') {
          relevant[prop] = val;
        }
      });
      return relevant;
    }

    function processElement(el: BrowserElement, depth = 0): ComponentMap | null {
      if (processed.has(el) || depth > 4) return null;

      const className = el.className || '';
      if (className.match(/^(sr-only|visually-hidden|hidden|d-none|invisible)/)) return null;

      const children: ComponentMap[] = [];
      (Array.from(el.children) as BrowserElement[]).forEach((child: BrowserElement) => {
        const childComp = processElement(child, depth + 1);
        if (childComp) children.push(childComp);
      });

      const styles = extractStyles(el);
      const type = getElementType(el);

      if (Object.keys(styles).length > 0 || children.length > 0 || ['Hero', 'Nav', 'Footer', 'Button', 'Card'].includes(type)) {
        const comp: ComponentMap = {
          selector: getSelector(el),
          type,
          props: extractProps(el),
          children,
          styles,
          viewport: 'desktop',
        };
        processed.add(el);
        return comp;
      }
      return null;
    }

    function getSelector(el: BrowserElement): string {
      if (el.id) return `#${el.id}`;
      const classes = (el.className || '').split(' ').filter((c: string) => c && !c.startsWith('col-') && !c.match(/^\d/));
      if (classes.length) return `.${classes.join('.')}`;
      return el.tagName.toLowerCase();
    }

    function extractProps(el: BrowserElement): Record<string, unknown> {
      const props: Record<string, unknown> = {};
      if (el.id) props.id = el.id;
      if (el.className) props.className = el.className;
      if (el.tagName === 'A') props.href = (el as HTMLAnchorElement).href;
      if (el.tagName === 'IMG') props.src = (el as HTMLImageElement).src;
      if (el.tagName === 'BUTTON') props.type = (el as HTMLButtonElement).type;
      return props;
    }

    const bodyComp = processElement(document.body);
    if (bodyComp) components.push(bodyComp);

    document.querySelectorAll('body > *:not(script):not(style):not(link):not(meta)').forEach((el: BrowserElement) => {
      const comp = processElement(el);
      if (comp) components.push(comp);
    });

    return components;
  });
}