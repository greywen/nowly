import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const prototypePath = resolve(process.cwd(), 'docs/prototypes/nowly-final-uiux.html');

async function loadPrototype(page: Page) {
  const html = await readFile(prototypePath, 'utf8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

test('renders the complete single-screen Nowly shell', async ({ page }) => {
  await loadPrototype(page);
  await expect(page).toHaveTitle('Nowly · 最终 UI/UX 原型');
  await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  await expect(page.getByText('今天有 3 个日程 · 2 个重要任务 · 2 条便签')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-grid"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="quadrant-grid"]')).toHaveCount(1);
});

test('shows balanced-density calendar, quadrant, and note content', async ({ page }) => {
  await loadPrototype(page);
  await expect(page.locator('[data-calendar-day]')).toHaveCount(35);
  await expect(page.locator('[data-calendar-day][aria-current="date"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /14:00 设计评审/ })).toBeVisible();
  await expect(page.locator('[data-quadrant]')).toHaveCount(4);
  await expect(page.getByText('发布 Nowly v0.1')).toBeVisible();
  await expect(page.locator('[data-note-card]')).toHaveCount(2);
  await expect(page.getByText('产品原则')).toBeVisible();
});

test('uses inline icon symbols instead of emoji function icons', async ({ page }) => {
  await loadPrototype(page);
  expect(await page.locator('svg[aria-hidden="true"] use').count()).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText(/📅|✅|📝|⚙️|📌/);
});

test('switches between light and desktop blend modes', async ({ page }) => {
  await loadPrototype(page);
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换到桌面融合模式' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'desktop');
  await expect(page.getByRole('button', { name: '切换到浅色渐变模式' })).toBeVisible();
});

for (const viewport of [
  { name: 'compact', width: 1366, height: 768 },
  { name: 'standard', width: 1920, height: 1080 },
  { name: 'large', width: 2560, height: 1440 }
]) {
  test(`has no page overflow at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPrototype(page);
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  });
}
