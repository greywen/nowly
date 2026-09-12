import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __quickPanelOpenCount: number;
  }
}

for (const scale of [1, 1.5, 2]) {
  test.describe(`Home Indicator hit area at ${scale}x`, () => {
    test.use({ viewport: { width: 64, height: 20 }, deviceScaleFactor: scale });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        window.__quickPanelOpenCount = 0;
        Object.assign(window, {
          __TAURI_INTERNALS__: {
            metadata: {
              currentWindow: { label: 'quick-panel-handle' },
              currentWebview: { label: 'quick-panel-handle' }
            },
            invoke: async (command: string) => {
              if (command === 'open_quick_panel') window.__quickPanelOpenCount++;
              return null;
            }
          }
        });
      });
      await page.goto('/');
      await expect(page.getByRole('button', { name: '打开 AI 快捷面板' })).toBeVisible();
    });

    test('transparent margins and rounded corners do not open the panel', async ({ page }) => {
      for (const [x, y] of [[32, 1], [32, 7], [32, 14], [32, 19], [0.1, 8.1], [63.9, 12.9]]) {
        await page.mouse.move(-10, -10);
        await page.evaluate(() => { window.__quickPanelOpenCount = 0; });
        await page.mouse.move(x, y);
        expect(await page.evaluate(() => window.__quickPanelOpenCount), `pointer at ${x}, ${y}`).toBe(0);
      }
      await page.mouse.move(32, 10);
      expect(await page.evaluate(() => window.__quickPanelOpenCount)).toBe(1);
    });

    test('button matches the white bar and remains keyboard accessible', async ({ page }) => {
      const button = page.getByRole('button', { name: '打开 AI 快捷面板' });
      const bar = button.locator('span');
      expect(await button.boundingBox()).toEqual({ x: 0, y: 8, width: 64, height: 5 });
      expect(await bar.boundingBox()).toEqual(await button.boundingBox());
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      expect(await page.evaluate(() => window.__quickPanelOpenCount)).toBeGreaterThan(0);
    });
  });
}
