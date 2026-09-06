import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';

// Browser context types for page.evaluate - use loose types to avoid DOM constraint issues
interface BrowserElement {
  className: string;
  id: string;
  tagName: string;
  textContent: string | null;
  children: any;
  parentElement: BrowserElement | null;
  naturalWidth?: number;
  open?: boolean;
  validity?: ValidityState;
  scrollWidth?: number;
  clientWidth?: number;
}

interface BrowserDocument {
  documentElement: BrowserElement;
  body: BrowserElement;
  querySelectorAll(selectors: string): any;
  querySelector(selectors: string): BrowserElement | null;
  getAttribute(name: string): string | null;
  fonts?: {
    ready: Promise<void>;
  };
}

interface BrowserWindow {
  getComputedStyle(element: BrowserElement): CSSStyleDeclaration;
}

declare const document: BrowserDocument;
declare const window: BrowserWindow;

export interface FunctionalValidationOptions {
  headless: boolean;
  verbose: boolean;
}

export interface FunctionalTestResult {
  name: string;
  passed: boolean;
  duration: number;
  details: string;
  error?: string;
  screenshot?: string;
}

export interface FunctionalValidationResult {
  passed: boolean;
  tests: FunctionalTestResult[];
  totalDuration: number;
  passedCount: number;
  failedCount: number;
}

export async function validateFunctional(
  projectDir: string,
  options: FunctionalValidationOptions
): Promise<FunctionalValidationResult> {
  const { headless, verbose } = options;
  const spinner = ora('Iniciando validação funcional...').start();

  // Start Astro preview server
  const previewUrl = await startAstroPreview(projectDir);
  
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  
  const tests: FunctionalTestResult[] = [];
  const startTime = Date.now();

  try {
    const page = await context.newPage();
    
    // Capture console errors
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push(err.message);
    });

    await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');

    // Test 1: Page loads without critical errors
    tests.push(await runTest('Page Load', async () => {
      const title = await page.title();
      if (!title) throw new Error('Page has no title');
      return { details: `Title: "${title}"` };
    }));

    // Test 2: Navigation - anchor links work
    tests.push(await runTest('Anchor Navigation', async () => {
      const anchors = await page.$$('a[href^="#"]');
      if (anchors.length === 0) return { details: 'No anchor links found', passed: true };
      
      for (const anchor of anchors.slice(0, 3)) {
        const href = await anchor.getAttribute('href');
        if (href && href !== '#') {
          await anchor.click();
          await page.waitForTimeout(500);
          const targetId = href.slice(1);
          const target = await page.$(`#${targetId}, [name="${targetId}"]`);
          if (!target) {
            throw new Error(`Anchor target not found: ${href}`);
          }
        }
      }
      return { details: `${anchors.length} anchor links tested` };
    }));

    // Test 3: Smooth scroll behavior
    tests.push(await runTest('Smooth Scroll', async () => {
      const scrollBehavior = await page.evaluate(() => {
        const el = document.documentElement as HTMLElement;
        return getComputedStyle(el).scrollBehavior;
      });
      if (scrollBehavior !== 'smooth') {
        return { details: 'scroll-behavior not set to smooth', passed: false };
      }
      return { details: 'scroll-behavior: smooth' };
    }));

    // Test 4: Forms - if any exist
    const forms = await page.$$('form');
    if (forms.length > 0) {
      tests.push(await runTest('Form Validation', async () => {
        for (const form of forms.slice(0, 2)) {
          const inputs = await form.$$('input[required], textarea[required], select[required]');
          for (const input of inputs.slice(0, 2)) {
            await input.fill('');
            await form.evaluate(f => f.requestSubmit());
            await page.waitForTimeout(300);
            const isInvalid = await input.evaluate((el: HTMLInputElement) => el.validity.valid === false);
            if (!isInvalid) {
              throw new Error('Required field validation not working');
            }
          }
        }
        return { details: `${forms.length} forms tested` };
      }));
    }

    // Test 5: Buttons/CTAs clickable
    tests.push(await runTest('CTA Buttons', async () => {
      const buttons = await page.$$('button, a.btn, [class*="button"], [class*="cta"]');
      let clickableCount = 0;
      for (const btn of buttons.slice(0, 5)) {
        const isVisible = await btn.isVisible();
        const isEnabled = await btn.isEnabled();
        if (isVisible && isEnabled) clickableCount++;
      }
      if (clickableCount === 0) {
        return { details: 'No clickable buttons found', passed: false };
      }
      return { details: `${clickableCount}/${buttons.length} buttons clickable` };
    }));

    // Test 6: Modals/Dialogs
    const modalTriggers = await page.$$('[data-modal], [class*="modal-trigger"], button:has-text("modal"), button:has-text("Modal")');
    if (modalTriggers.length > 0) {
      tests.push(await runTest('Modal Open/Close', async () => {
        for (const trigger of modalTriggers.slice(0, 1)) {
          await trigger.click();
          await page.waitForTimeout(300);
          const modal = await page.$('[role="dialog"], [class*="modal"], [class*="dialog"]');
          if (!modal) throw new Error('Modal did not open');
          
          const closeBtn = await modal.$('[class*="close"], [aria-label*="close"], button:has-text("×")');
          if (closeBtn) {
            await closeBtn.click();
            await page.waitForTimeout(200);
          } else {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
          
          const stillOpen = await modal.isVisible();
          if (stillOpen) throw new Error('Modal did not close');
        }
        return { details: 'Modal open/close tested' };
      }));
    }

    // Test 7: Carousels/Sliders
    const carousels = await page.$$('[class*="carousel"], [class*="slider"], [class*="swiper"]');
    if (carousels.length > 0) {
      tests.push(await runTest('Carousel Navigation', async () => {
        for (const carousel of carousels.slice(0, 1)) {
          const nextBtn = await carousel.$('[class*="next"], [class*="arrow-right"], button[aria-label*="next"]');
          const prevBtn = await carousel.$('[class*="prev"], [class*="arrow-left"], button[aria-label*="prev"]');
          
          if (nextBtn) {
            await nextBtn.click();
            await page.waitForTimeout(300);
          }
          if (prevBtn) {
            await prevBtn.click();
            await page.waitForTimeout(300);
          }
        }
        return { details: `${carousels.length} carousels tested` };
      }));
    }

    // Test 8: Accordions
    const accordions = await page.$$('[class*="accordion"], details');
    if (accordions.length > 0) {
      tests.push(await runTest('Accordion Expand/Collapse', async () => {
        for (const acc of accordions.slice(0, 2)) {
          const summary = await acc.$('summary, [class*="accordion-trigger"], [class*="accordion-header"]');
          if (summary) {
            await summary.click();
            await page.waitForTimeout(200);
            const isOpen = await acc.evaluate((el: HTMLDetailsElement) => el.open);
            if (!isOpen) throw new Error('Accordion did not expand');
            
            await summary.click();
            await page.waitForTimeout(200);
            const isClosed = await acc.evaluate((el: HTMLDetailsElement) => !el.open);
            if (!isClosed) throw new Error('Accordion did not collapse');
          }
        }
        return { details: `${accordions.length} accordions tested` };
      }));
    }

    // Test 9: Countdown timer
    const countdowns = await page.$$('[class*="countdown"], [data-countdown], [id*="countdown"]');
    if (countdowns.length > 0) {
      tests.push(await runTest('Countdown Timer', async () => {
        for (const cd of countdowns.slice(0, 1)) {
          const text1 = await cd.textContent();
          await page.waitForTimeout(1100);
          const text2 = await cd.textContent();
          if (text1 === text2) {
            return { details: 'Countdown not updating', passed: false };
          }
        }
        return { details: 'Countdown timer updating' };
      }));
    }

    // Test 10: Responsive - check mobile viewport
    tests.push(await runTest('Mobile Responsive', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(500);
      
      const hasHorizontalScroll = await page.evaluate(() => 
        (document.documentElement.scrollWidth ?? 0) > (document.documentElement.clientWidth ?? 0)
      );
      if (hasHorizontalScroll) {
        return { details: 'Horizontal scroll detected on mobile', passed: false };
      }
      
      const bodyText = await page.$eval('body', el => 
        window.getComputedStyle(el).fontSize
      );
      const fontSize = parseFloat(bodyText);
      if (fontSize < 14) {
        return { details: `Font size too small on mobile: ${fontSize}px`, passed: false };
      }
      
      return { details: 'Mobile viewport OK' };
    }));

    // Test 11: Tablet responsive
    tests.push(await runTest('Tablet Responsive', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.waitForTimeout(500);
      
      const hasHorizontalScroll = await page.evaluate(() => 
        (document.documentElement.scrollWidth ?? 0) > (document.documentElement.clientWidth ?? 0)
      );
      if (hasHorizontalScroll) {
        return { details: 'Horizontal scroll detected on tablet', passed: false };
      }
      
      return { details: 'Tablet viewport OK' };
    }));

    // Test 12: Desktop responsive
    tests.push(await runTest('Desktop Responsive', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(500);
      
      const hasHorizontalScroll = await page.evaluate(() => 
        (document.documentElement.scrollWidth ?? 0) > (document.documentElement.clientWidth ?? 0)
      );
      if (hasHorizontalScroll) {
        return { details: 'Horizontal scroll detected on desktop', passed: false };
      }
      
      return { details: 'Desktop viewport OK' };
    }));

    // Test 13: Images load correctly
    tests.push(await runTest('Images Load', async () => {
      const images = await page.$$('img');
      let loaded = 0;
      let failed = 0;
      for (const img of images.slice(0, 10)) {
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        if (naturalWidth > 0) loaded++;
        else failed++;
      }
      if (failed > 0 && loaded === 0) {
        return { details: 'All images failed to load', passed: false };
      }
      return { details: `${loaded} loaded, ${failed} failed` };
    }));

    // Test 14: No critical console errors
    tests.push(await runTest('Console Errors', async () => {
      const criticalErrors = consoleErrors.filter(e => 
        !e.includes('favicon') && 
        !e.includes('manifest') &&
        !e.includes('preload') &&
        !e.toLowerCase().includes('warning')
      );
      if (criticalErrors.length > 0) {
        return { details: `${criticalErrors.length} critical errors: ${criticalErrors.slice(0, 3).join('; ')}`, passed: false };
      }
      return { details: 'No critical console errors' };
    }));

    // Test 15: Accessibility basics
    tests.push(await runTest('Basic Accessibility', async () => {
      const lang = await page.getAttribute('html', 'lang');
      if (!lang) {
        return { details: 'Missing lang attribute on html', passed: false };
      }
      
      const images = await page.$$('img');
      let missingAlt = 0;
      for (const img of images.slice(0, 10)) {
        const alt = await img.getAttribute('alt');
        if (!alt) missingAlt++;
      }
      if (missingAlt > 0) {
        return { details: `${missingAlt} images missing alt text`, passed: false };
      }
      
      return { details: 'Basic accessibility OK' };
    }));

    // Summary
    const passedCount = tests.filter(t => t.passed).length;
    const failedCount = tests.filter(t => !t.passed).length;
    const totalDuration = Date.now() - startTime;
    const passed = failedCount === 0;

    spinner.succeed(passed ? 'Validação funcional PASSOU' : 'Validação funcional FALHOU');
    console.log(chalk.gray(`  Testes: ${passedCount} passed, ${failedCount} failed`));
    console.log(chalk.gray(`  Duração: ${totalDuration}ms`));

    // Save report
    const report: FunctionalValidationResult = {
      passed,
      tests,
      totalDuration,
      passedCount,
      failedCount,
    };
    writeFileSync(join(projectDir, 'functional-validation-report.json'), JSON.stringify(report, null, 2));

    await browser.close();
    return report;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function runTest(
  name: string,
  fn: () => Promise<{ passed?: boolean; details: string }>
): Promise<FunctionalTestResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      name,
      passed: result.passed !== false,
      duration: Date.now() - start,
      details: result.details,
    };
  } catch (error: any) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      details: error.message || 'Test failed',
      error: error.stack,
    };
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

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}