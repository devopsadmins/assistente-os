import { chromium } from 'playwright';
import { CacheManager, AnalysisCache, ViewportConfig } from './utils/cache-manager.js';
import { extractDesignTokens } from './utils/token-extractor.js';
import { mapComponents } from './utils/component-mapper.js';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import ora from 'ora';

export interface AnalyzeOptions {
  viewports: ViewportConfig;
  headless: boolean;
  verbose: boolean;
  cacheKey: string;
  cacheManager: CacheManager;
}

export async function analyzeReference(url: string, options: AnalyzeOptions): Promise<AnalysisCache> {
  const { viewports, headless, verbose, cacheKey, cacheManager } = options;
  const spinner = ora('Iniciando navegador...').start();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: viewports.desktop,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  try {
    const page = await context.newPage();
    
    // Block unnecessary resources for speed
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['font', 'media', 'websocket'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    spinner.text = `Navegando para ${url}...`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for fonts and lazy content
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);

    // Extract design tokens
    spinner.text = 'Extraindo design tokens...';
    const designTokens = await extractDesignTokens(page);

    // Map components
    spinner.text = 'Mapeando componentes...';
    const componentMap = await mapComponents(page);

    // Extract interactions
    spinner.text = 'Detectando interações...';
    const interactions = await detectInteractions(page);

    // Capture screenshots for each viewport
    spinner.text = 'Capturando screenshots baseline...';
    const screenshots = await captureScreenshots(page, viewports, cacheKey);

    // Save screenshots to cache
    const cachePath = cacheManager.getCachePath(cacheKey);
    const screenshotsDir = join(cachePath, 'screenshots');
    if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

    for (const [name, buffer] of Object.entries(screenshots.fullPage)) {
      writeFileSync(join(screenshotsDir, `fullpage-${name}.png`), buffer);
    }
    for (const [viewport, buffer] of Object.entries(screenshots.viewport)) {
      writeFileSync(join(screenshotsDir, `viewport-${viewport}.png`), buffer);
    }
    for (const [component, buffer] of Object.entries(screenshots.components)) {
      writeFileSync(join(screenshotsDir, `component-${component}.png`), buffer);
    }

    // Update cache with screenshot paths
    const analysis: AnalysisCache = {
      meta: {
        url,
        timestamp: Date.now(),
        viewportConfig: viewports,
        hash: cacheKey,
      },
      designTokens,
      componentMap,
      screenshots: {
        fullPage: Object.fromEntries(
          Object.entries(screenshots.fullPage).map(([k, v]) => [k, join(screenshotsDir, `fullpage-${k}.png`)])
        ),
        viewport: Object.fromEntries(
          Object.entries(screenshots.viewport).map(([k, v]) => [k, join(screenshotsDir, `viewport-${k}.png`)])
        ),
        components: Object.fromEntries(
          Object.entries(screenshots.components).map(([k, v]) => [k, join(screenshotsDir, `component-${k}.png`)])
        ),
      },
      interactions,
    };

    await cacheManager.save(cacheKey, analysis);
    
    spinner.succeed('Análise completa!');
    await browser.close();
    return analysis;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function captureScreenshots(
  page: any,
  viewports: ViewportConfig,
  cacheKey: string
): Promise<{
  fullPage: Record<string, Buffer>;
  viewport: Record<string, Buffer>;
  components: Record<string, Buffer>;
}> {
  const fullPage: Record<string, Buffer> = {};
  const viewport: Record<string, Buffer> = {};
  const components: Record<string, Buffer> = {};

  for (const [name, vp] of Object.entries(viewports)) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);

    // Full page screenshot
    const fullPageBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    fullPage[name] = fullPageBuffer;

    // Viewport screenshot
    const vpBuffer = await page.screenshot({ fullPage: false, type: 'png' });
    viewport[name] = vpBuffer;
  }

  // Component screenshots. Canonical keys (`hero`, `header`, `cta`, `footer`)
  // MUST match the selectors validate-visual.ts uses on the generated site,
  // otherwise the per-region comparison is silently skipped and its score
  // stays 0 (which makes the visual gate impossible to pass).
  const canonicalSelectors: Record<string, string> = {
    header: 'header, nav, [role="banner"]',
    hero: 'main > section:first-child, .hero, #hero, [class*="hero"]',
    cta: '.btn-primary, [class*="cta"], .btn, button',
    footer: 'footer, [role="contentinfo"]',
  };

  for (const [key, selector] of Object.entries(canonicalSelectors)) {
    try {
      const el = await page.$(selector);
      if (!el) continue;
      const box = await el.boundingBox();
      if (box && box.width > 20 && box.height > 20) {
        components[key] = await el.screenshot({ type: 'png' });
      }
    } catch {
      // Ignore selector errors
    }
  }

  // Extra section crops (indexed, best-effort — used for the report only).
  const extraSelectors = [
    '[class*="card"], [class*="feature"], [class*="pricing"]',
  ];
  for (const selector of extraSelectors) {
    try {
      const elements = await page.$$(selector);
      for (let i = 0; i < Math.min(elements.length, 3); i++) {
        const box = await elements[i].boundingBox();
        if (box && box.width > 50 && box.height > 50) {
          components[`${selector.replace(/[^a-zA-Z0-9]/g, '-')}-${i}`] = await elements[i].screenshot({ type: 'png' });
        }
      }
    } catch {
      // Ignore selector errors
    }
  }

  return { fullPage, viewport, components };
}

async function detectInteractions(page: any): Promise<any[]> {
  const interactions: any[] = [];

  // Carousels/Sliders
  const carousels = await page.$$('[class*="carousel"], [class*="slider"], [class*="swiper"], [data-carousel]');
  for (const el of carousels) {
    interactions.push({
      type: 'carousel',
      selector: await getUniqueSelector(page, el),
      config: { hasNav: true, hasDots: true },
    });
  }

  // Modals
  const modals = await page.$$('[class*="modal"], [class*="dialog"], [role="dialog"], [data-modal]');
  for (const el of modals) {
    interactions.push({
      type: 'modal',
      selector: await getUniqueSelector(page, el),
      config: { trigger: 'click', closeOnEscape: true },
    });
  }

  // Countdown timers
  const countdowns = await page.$$('[class*="countdown"], [data-countdown], [id*="countdown"]');
  for (const el of countdowns) {
    interactions.push({
      type: 'countdown',
      selector: await getUniqueSelector(page, el),
      config: {},
    });
  }

  // Accordions
  const accordions = await page.$$('[class*="accordion"], [data-accordion], details');
  for (const el of accordions) {
    interactions.push({
      type: 'accordion',
      selector: await getUniqueSelector(page, el),
      config: { multiple: false },
    });
  }

  // Tabs
  const tabs = await page.$$('[class*="tab"], [role="tablist"], [data-tabs]');
  for (const el of tabs) {
    interactions.push({
      type: 'tabs',
      selector: await getUniqueSelector(page, el),
      config: {},
    });
  }

  // Dropdowns
  const dropdowns = await page.$$('[class*="dropdown"], [class*="select"], [data-dropdown]');
  for (const el of dropdowns) {
    interactions.push({
      type: 'dropdown',
      selector: await getUniqueSelector(page, el),
      config: {},
    });
  }

  // Forms
  const forms = await page.$$('form');
  for (const el of forms) {
    interactions.push({
      type: 'form',
      selector: await getUniqueSelector(page, el),
      config: { validation: true },
    });
  }

  // Smooth scroll anchors
  const anchors = await page.$$('a[href^="#"]');
  if (anchors.length > 0) {
    interactions.push({
      type: 'smooth-scroll',
      selector: 'a[href^="#"]',
      config: {},
    });
  }

  return interactions;
}

async function getUniqueSelector(page: any, element: any): Promise<string> {
  return await page.evaluate((el: Element) => {
    if (el.id) return `#${el.id}`;
    if (el.className) {
      const classes = (el.className as string).split(' ').filter((c: string) => c.length > 1);
      if (classes.length) return `.${classes.join('.')}`;
    }
    const tag = el.tagName.toLowerCase();
    const nth = Array.from(el.parentElement?.children || []).indexOf(el) + 1;
    return `${tag}:nth-child(${nth})`;
  }, element);
}