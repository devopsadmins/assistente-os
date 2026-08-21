import { test, expect } from '@playwright/test';

test('Telegram tab button exists', async ({ page }) => {
  await page.goto('http://127.0.0.1:4310');
  // Telegram tab button exists in the navigation
  await expect(page.locator('.tab[data-tab="telegram"]')).toBeVisible();
  // Telegram panel section exists in the DOM
  await expect(page.locator('#tab-telegram')).toBeVisible({ timeout: 0 });
});

test('Telegram tab can be clicked', async ({ page }) => {
  await page.goto('http://127.0.0.1:4310');
  // Click the Telegram tab
  await page.click('.tab[data-tab="telegram"]');
  // After clicking, the Telegram panel should be active
  await expect(page.locator('#tab-telegram')).toHaveClass('panel active');
});
