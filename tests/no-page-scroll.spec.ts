import { expect, test } from '@playwright/test';

test('main page has no document-level scrollbars', async ({ page }) => {
  await page.goto('/');

  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollHeight: document.documentElement.scrollHeight,
    rootClientHeight: document.documentElement.clientHeight
  }));

  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.bodyClientWidth);
  expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.bodyClientHeight);
  expect(metrics.rootScrollWidth).toBeLessThanOrEqual(metrics.rootClientWidth);
  expect(metrics.rootScrollHeight).toBeLessThanOrEqual(metrics.rootClientHeight);
});
