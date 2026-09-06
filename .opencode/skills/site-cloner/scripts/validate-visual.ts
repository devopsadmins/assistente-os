import { chromium } from 'playwright';
import { AnalysisCache } from './utils/cache-manager.js';
import { compareImages, ComparisonResult } from './utils/pixel-diff.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import ora from 'ora';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  documentElement: BrowserElement;
  body: BrowserElement;
  querySelectorAll(selectors: string): any;
  querySelector(selectors: string): BrowserElement | null;
  fonts?: {
    ready: Promise<void>;
  };
}

interface BrowserWindow {
  getComputedStyle(element: BrowserElement): CSSStyleDeclaration;
}

declare const document: BrowserDocument;
declare const window: BrowserWindow;

export interface VisualValidationOptions {
  threshold: number;
  viewports: string[];
  headless: boolean;
  verbose: boolean;
}

export interface VisualValidationResult {
  passed: boolean;
  overallSimilarity: number;
  heroSimilarity: number;
  headerSimilarity: number;
  ctaSimilarity: number;
  mobileSimilarity: number;
  tabletSimilarity: number;
  desktopSimilarity: number;
  componentDiffs: Record<string, ComparisonResult>;
  iterations: number;
  threshold: number;
  diffImages: Record<string, string>;
}

export async function validateVisual(
  projectDir: string,
  analysis: AnalysisCache | null,
  options: VisualValidationOptions
): Promise<VisualValidationResult> {
  const { threshold, viewports, headless, verbose } = options;
  const spinner = ora('Iniciando validação visual...').start();

  // Start Astro preview server
  const previewUrl = await startAstroPreview(projectDir);
  
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  
  try {
    const page = await context.newPage();
    
    // Generate screenshots for generated site
    const generatedScreenshots = await captureValidationScreenshots(page, previewUrl, viewports);
    
    // Load reference screenshots from analysis or cache
    const referenceScreenshots = await loadReferenceScreenshots(analysis, projectDir);
    
    // Compare
    spinner.text = 'Comparando screenshots...';
    const comparisons = await compareAllViewports(generatedScreenshots, referenceScreenshots, projectDir);
    
    // Calculate scores
    const overallSimilarity = comparisons.desktop?.similarity || 0;
    const heroSimilarity = comparisons.hero?.similarity || 0;
    const headerSimilarity = comparisons.header?.similarity || 0;
    const ctaSimilarity = comparisons.cta?.similarity || 0;
    const mobileSimilarity = comparisons.mobile?.similarity || 0;
    const tabletSimilarity = comparisons.tablet?.similarity || 0;
    const desktopSimilarity = comparisons.desktop?.similarity || 0;
    
    const passed = 
      overallSimilarity >= threshold &&
      heroSimilarity >= 0.95 &&
      headerSimilarity >= 0.95 &&
      ctaSimilarity >= 0.93 &&
      mobileSimilarity >= 0.88 &&
      tabletSimilarity >= 0.88;

    const result: VisualValidationResult = {
      passed,
      overallSimilarity,
      heroSimilarity,
      headerSimilarity,
      ctaSimilarity,
      mobileSimilarity,
      tabletSimilarity,
      desktopSimilarity,
      componentDiffs: comparisons,
      iterations: 0,
      threshold,
      diffImages: Object.fromEntries(
        Object.entries(comparisons).map(([k, v]) => [k, v.diffImagePath || ''])
      ),
    };

    // Save detailed report
    const reportPath = join(projectDir, 'visual-validation-report.json');
    writeFileSync(reportPath, JSON.stringify(result, null, 2));

    spinner.succeed(passed ? 'Validação visual PASSOU' : 'Validação visual FALHOU');
    console.log(chalk.gray(`  Overall: ${(overallSimilarity * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%)`));
    console.log(chalk.gray(`  Hero: ${(heroSimilarity * 100).toFixed(1)}%`));
    console.log(chalk.gray(`  Header: ${(headerSimilarity * 100).toFixed(1)}%`));
    console.log(chalk.gray(`  CTAs: ${(ctaSimilarity * 100).toFixed(1)}%`));
    console.log(chalk.gray(`  Mobile: ${(mobileSimilarity * 100).toFixed(1)}%`));
    console.log(chalk.gray(`  Tablet: ${(tabletSimilarity * 100).toFixed(1)}%`));

    await browser.close();
    return result;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function startAstroPreview(projectDir: string): Promise<string> {
  const { spawn } = await import('child_process');
  const port = 43210 + Math.floor(Math.random() * 1000);
  
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'preview', '--', '--port', port.toString()], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error('Timeout starting preview server'));
      }
    }, 30000);

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes(`http://localhost:${port}`) || output.includes(`http://127.0.0.1:${port}`)) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          setTimeout(() => resolve(`http://localhost:${port}`), 2000);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      console.error('Preview stderr:', data.toString());
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function captureValidationScreenshots(
  page: any,
  url: string,
  viewports: string[]
): Promise<Record<string, Buffer>> {
  const screenshots: Record<string, Buffer> = {};
  const viewportMap: Record<string, { width: number; height: number }> = {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  };

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  
  // Wait for fonts if available
  try {
    await page.evaluate(() => (document as any).fonts?.ready);
  } catch {}
  
  await page.waitForTimeout(1000);

  for (const vpName of viewports) {
    const vp = viewportMap[vpName];
    if (!vp) continue;

    await page.setViewportSize(vp);
    await page.waitForTimeout(500);

    // Full page
    const fullPage = await page.screenshot({ fullPage: true, type: 'png' });
    screenshots[`${vpName}-fullpage`] = fullPage;

    // Viewport only
    const viewportOnly = await page.screenshot({ fullPage: false, type: 'png' });
    screenshots[`${vpName}-viewport`] = viewportOnly;

    // Hero section
    try {
      const hero = await page.$('header, [class*="hero"], [id*="hero"], main > section:first-child');
      if (hero) {
        const heroShot = await hero.screenshot({ type: 'png' });
        screenshots[`${vpName}-hero`] = heroShot;
      }
    } catch {}

    // Header
    try {
      const header = await page.$('header, nav, [role="banner"]');
      if (header) {
        const headerShot = await header.screenshot({ type: 'png' });
        screenshots[`${vpName}-header`] = headerShot;
      }
    } catch {}

    // CTAs
    try {
      const ctas = await page.$$('.btn-primary, .btn-primary, [class*="cta"], button:not([class*="secondary"])');
      if (ctas.length > 0) {
        const ctaShot = await ctas[0].screenshot({ type: 'png' });
        screenshots[`${vpName}-cta`] = ctaShot;
      }
    } catch {}
  }

  return screenshots;
}

async function loadReferenceScreenshots(
  analysis: AnalysisCache | null,
  projectDir: string
): Promise<Record<string, Buffer>> {
  const screenshots: Record<string, Buffer> = {};
  
  if (analysis?.screenshots) {
    for (const [key, path] of Object.entries(analysis.screenshots.fullPage)) {
      if (existsSync(path)) {
        screenshots[`${key}-fullpage`] = readFileSync(path);
      }
    }
    for (const [key, path] of Object.entries(analysis.screenshots.viewport)) {
      if (existsSync(path)) {
        screenshots[`${key}-viewport`] = readFileSync(path);
      }
    }
    for (const [key, path] of Object.entries(analysis.screenshots.components)) {
      if (existsSync(path)) {
        screenshots[key] = readFileSync(path);
      }
    }
  }

  const projectScreenshotsDir = join(projectDir, '.validation-screenshots');
  if (existsSync(projectScreenshotsDir)) {
    const files = readdirSync(projectScreenshotsDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        const key = file.replace('.png', '');
        screenshots[key] = readFileSync(join(projectScreenshotsDir, file));
      }
    }
  }

  return screenshots;
}

async function compareAllViewports(
  generated: Record<string, Buffer>,
  reference: Record<string, Buffer>,
  projectDir: string
): Promise<Record<string, ComparisonResult>> {
  const comparisons: Record<string, ComparisonResult> = {};
  const diffDir = join(projectDir, 'visual-diffs');
  mkdirSync(diffDir, { recursive: true });

  const comparePairs = [
    { key: 'desktop', gen: 'desktop-fullpage', ref: 'desktop-fullpage' },
    { key: 'mobile', gen: 'mobile-fullpage', ref: 'mobile-fullpage' },
    { key: 'tablet', gen: 'tablet-fullpage', ref: 'tablet-fullpage' },
    { key: 'hero', gen: 'desktop-hero', ref: 'hero' },
    { key: 'header', gen: 'desktop-header', ref: 'header' },
    { key: 'cta', gen: 'desktop-cta', ref: 'cta' },
  ];

  for (const pair of comparePairs) {
    const genImg = generated[pair.gen];
    const refImg = reference[pair.ref];

    if (genImg && refImg) {
      try {
        const result = await compareImages(genImg, refImg, {
          threshold: 0.1,
          includeAA: true,
        });
        
        const diffPath = join(diffDir, `diff-${pair.key}.png`);
        writeFileSync(diffPath, result.diffBuffer);
        
        comparisons[pair.key] = {
          ...result,
          diffImagePath: diffPath,
        };
      } catch (e) {
        console.warn(`Failed to compare ${pair.key}:`, e);
      }
    }
  }

  return comparisons;
}