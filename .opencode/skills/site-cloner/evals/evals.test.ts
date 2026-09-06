import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

interface EvalCase {
  id: string;
  name: string;
  referenceUrl: string;
  description: string;
  expectedComponents: string[];
  expectedInteractions: string[];
  visualThreshold: number;
  viewportTests: string[];
  functionalTests: string[];
}

interface EvalFile {
  skill_name: string;
  evals: EvalCase[];
}

const data: EvalFile = JSON.parse(readFileSync(join(here, 'evals.json'), 'utf-8'));

describe('evals.json schema', () => {
  it('declares the skill name', () => {
    expect(data.skill_name).toBe('site-cloner');
  });

  it('has at least one eval case', () => {
    expect(Array.isArray(data.evals)).toBe(true);
    expect(data.evals.length).toBeGreaterThan(0);
  });

  it.each(data.evals.map((e) => [e.id, e] as const))('case %s is well formed', (_id, c) => {
    expect(c.id).toMatch(/^[a-z0-9-]+$/);
    expect(() => new URL(c.referenceUrl)).not.toThrow();
    expect(c.expectedComponents.length).toBeGreaterThan(0);
    expect(c.visualThreshold).toBeGreaterThan(0);
    expect(c.visualThreshold).toBeLessThanOrEqual(1);
    expect(c.viewportTests.every((v) => ['mobile', 'tablet', 'desktop'].includes(v))).toBe(true);
    expect(c.functionalTests.length).toBeGreaterThan(0);
  });
});

// Live extraction check — network + a real browser, so opt-in only.
// Run with:  SITE_CLONER_LIVE=1 npm test
const live = process.env.SITE_CLONER_LIVE === '1';

describe.skipIf(!live)('live: analyze extracts a design system', () => {
  it(
    'pulls tokens, components and interactions from the first eval reference',
    { timeout: 180_000 },
    async () => {
      const { chromium } = await import('playwright');
      const { extractDesignTokens } = await import('../scripts/utils/token-extractor.ts');
      const { mapComponents } = await import('../scripts/utils/component-mapper.ts');

      const target = data.evals[0].referenceUrl;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(target, { waitUntil: 'networkidle', timeout: 60_000 });

        const tokens = await extractDesignTokens(page);
        expect(Object.keys(tokens.colors).length).toBeGreaterThan(2);
        expect(Object.keys(tokens.typography.fontFamilies).length).toBeGreaterThan(0);

        const components = await mapComponents(page);
        expect(components.length).toBeGreaterThan(0);
      } finally {
        await browser.close();
      }
    },
  );
});
