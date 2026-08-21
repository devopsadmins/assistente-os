import { test, expect } from '@playwright/test';

test('debug tab visibility', async ({ page }) => {
  await page.goto('http://127.0.0.1:4310');
  const tab = page.locator('#tab-telegram');
  console.log('tag name:', await tab.evaluate(el => el.tagName));
  console.log('computed style display:', await tab.evaluate(el => window.getComputedStyle(el).display));
  console.log('computed style visibility:', await tab.evaluate(el => window.getComputedStyle(el).visibility));
  console.log('has attr hidden:', await tab.getAttribute('hidden'));
  const allSections = page.locator('section.panel');
  console.log('total sections:', await allSections.count());
  for (let i = 0; i < await allSections.count(); i++) {
    const s = allSections.nth(i);
    console.log(`section ${i} id:`, await s.getAttribute('id'));
    console.log(`section ${i} display:`, await s.evaluate(el => window.getComputedStyle(el).display));
  }
});
