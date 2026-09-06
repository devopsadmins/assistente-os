import type { BrowserContext, Page } from 'playwright';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';

export interface CapturedSnapshot {
  bodyHtml: string;
  css: string;
  title: string;
  lang: string;
  assetCount: number;
}

const ASSET_EXT_BY_CT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'font/woff2': '.woff2',
  'font/woff': '.woff',
  'application/font-woff2': '.woff2',
  'application/font-woff': '.woff',
  'font/ttf': '.ttf',
  'application/octet-stream': '',
};

function assetName(url: string, contentType: string | null): string {
  const h = createHash('sha1').update(url).digest('hex').slice(0, 16);
  let ext = extname(new URL(url).pathname).split('?')[0].toLowerCase();
  if (!ext && contentType) ext = ASSET_EXT_BY_CT[contentType.split(';')[0].trim()] ?? '';
  return `${h}${ext}`;
}

/** Collect every stylesheet on the page as one string. Same-origin sheets are
 * read from `cssRules`; cross-origin ones (which throw on `cssRules`) are
 * re-fetched Node-side via the Playwright request context (no CORS). */
async function collectCss(page: Page, context: BrowserContext, baseUrl: string): Promise<string> {
  const { inline, hrefs } = await page.evaluate(() => {
    const inlineParts: string[] = [];
    const externalHrefs: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = (sheet as CSSStyleSheet).cssRules;
        let text = '';
        for (const rule of Array.from(rules)) text += rule.cssText + '\n';
        // same-origin sheets: cssText resolves url()s to absolute already,
        // but re-tag with the sheet href so the Node side can normalise too
        inlineParts.push(sheet.href ? `/* @sheet ${sheet.href} */\n${text}` : text);
      } catch {
        if (sheet.href) externalHrefs.push(sheet.href);
      }
    }
    for (const el of Array.from(document.querySelectorAll('style'))) {
      inlineParts.push(el.textContent || '');
    }
    return { inline: inlineParts, hrefs: externalHrefs };
  });

  // Normalise every url() in the inline/same-origin CSS against the page URL
  // (covers relative refs in inline <style> blocks that would otherwise 404).
  const inlineNormalised = inline.map((part) => {
    const tag = part.match(/^\/\* @sheet (\S+) \*\/\n/);
    return rewriteCssUrls(tag ? part.slice(tag[0].length) : part, tag ? tag[1] : baseUrl);
  });

  const externalParts: string[] = [];
  for (const href of [...new Set(hrefs)]) {
    try {
      const res = await context.request.get(href, { timeout: 20000 });
      if (res.ok()) {
        // rewrite relative url(...) against the stylesheet's own URL
        externalParts.push(rewriteCssUrls(await res.text(), href));
      }
    } catch {
      /* skip unreachable sheet */
    }
  }
  return [...externalParts, ...inlineNormalised].join('\n');
}

/** Make every url(...) in a CSS blob absolute against `cssUrl`. */
function rewriteCssUrls(css: string, cssUrl: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
    if (/^data:/.test(ref)) return m;
    try {
      const resolved = ref.startsWith('//') ? `https:${ref}` : new URL(ref, cssUrl).href;
      return `url(${q}${resolved}${q})`;
    } catch {
      return m;
    }
  });
}

function collectAssetUrls(css: string, htmlAssetUrls: string[]): string[] {
  const fromCss: string[] = [];
  for (const m of css.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]+)['"]?\s*\)/g)) {
    fromCss.push(m[1]);
  }
  return [...new Set([...htmlAssetUrls, ...fromCss])].filter((u) => /^https?:\/\//.test(u));
}

export async function capturePageSnapshot(
  page: Page,
  context: BrowserContext,
  url: string,
  assetsOutDir: string,
): Promise<CapturedSnapshot> {
  mkdirSync(assetsOutDir, { recursive: true });

  const css = await collectCss(page, context, url);

  const { bodyHtml, title, lang, htmlAssetUrls } = await page.evaluate(() => {
    const abs = (ref: string): string | null => {
      try {
        return new URL(ref, location.href).href;
      } catch {
        return null;
      }
    };

    // work on a clone so we don't disturb anything still reading the live DOM
    const root = document.body.cloneNode(true) as HTMLElement;
    root
      .querySelectorAll('script, link[rel="preload"], link[rel="modulepreload"], link[rel="stylesheet"], style')
      .forEach((n) => n.remove());

    const urls: string[] = [];

    // Resolve <img> to a single absolute src so the Node-side rewrite map
    // (keyed by absolute URL) matches what ends up in the serialised HTML.
    root.querySelectorAll('img').forEach((img) => {
      const picked = (img as HTMLImageElement).currentSrc || img.getAttribute('src') || '';
      const a = picked ? abs(picked) : null;
      if (a) {
        img.setAttribute('src', a);
        urls.push(a);
      }
      img.removeAttribute('srcset');
      img.removeAttribute('loading');
      img.removeAttribute('data-src');
    });

    // <picture><source> — drop the sources, keep the <img> already handled.
    root.querySelectorAll('picture source, source').forEach((s) => s.remove());

    // Inline style="background:url(...)" → absolute.
    root.querySelectorAll<HTMLElement>('[style*="url("]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      const next = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, ref) => {
        const a = abs(ref);
        if (a) urls.push(a);
        return a ? `url(${q}${a}${q})` : m;
      });
      el.setAttribute('style', next);
    });

    return {
      bodyHtml: root.innerHTML,
      title: document.title || location.hostname,
      lang: document.documentElement.getAttribute('lang') || 'pt-BR',
      htmlAssetUrls: urls,
    };
  });

  // Download assets and build a rewrite map.
  const rewrite = new Map<string, string>();
  let assetCount = 0;
  for (const assetUrl of collectAssetUrls(css, htmlAssetUrls)) {
    try {
      const res = await context.request.get(assetUrl, { timeout: 20000 });
      if (!res.ok()) continue;
      const name = assetName(assetUrl, res.headers()['content-type'] ?? null);
      writeFileSync(join(assetsOutDir, name), await res.body());
      const local = `/assets/${name}`;
      rewrite.set(assetUrl, local);
      try {
        rewrite.set(new URL(assetUrl).pathname, local); // also catch path-only refs
      } catch {
        /* ignore */
      }
      assetCount++;
    } catch {
      /* skip unreachable asset */
    }
  }

  const applyRewrite = (s: string): string => {
    let out = s;
    for (const [from, to] of rewrite) out = out.split(from).join(to);
    return out;
  };

  return {
    bodyHtml: applyRewrite(bodyHtml),
    css: applyRewrite(css),
    title,
    lang,
    assetCount,
  };
}
