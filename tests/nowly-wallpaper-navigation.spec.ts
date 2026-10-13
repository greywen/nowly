import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

const layouts = [
  [
    { id: 'calendar', x: 0, y: 0, w: 7, h: 8 },
    { id: 'matrix', x: 7, y: 0, w: 5, h: 5 },
    { id: 'notes', x: 7, y: 5, w: 5, h: 3 }
  ],
  [
    { id: 'kanban', x: 0, y: 0, w: 6, h: 8 },
    { id: 'time', x: 6, y: 0, w: 6, h: 8 }
  ]
];

for (const layout of layouts) {
  test(`wallpaper navigation follows the setting for ${layout.map(item => item.id).join(', ')}`, async ({ page }) => {
    await page.addInitScript((moduleLayout) => {
      localStorage.setItem('nowly:onboarding-seen', 'true');
      if (!localStorage.getItem('nowly:browser-backend')) {
        localStorage.setItem('nowly:browser-backend', JSON.stringify({ moduleLayout }));
      }
    }, layout);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const root = page.getByTestId('desktop-root');
    const headers = page.locator('.workspace .module-frame__body > * > .card-header');
    await expect(headers).toHaveCount(layout.length);
    for (const header of await headers.all()) await expect(header).toBeVisible();

    await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
    await expect(root).toHaveClass(/app-shell--no-topbar/);
    for (const header of await headers.all()) {
      await expect(header).toBeHidden();
      expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBe(0);
    }
    for (const item of layout) {
      const body = page.locator(`.module-frame[data-widget-id="${item.id}"] .module-frame__body`);
      await expect(body).toBeVisible();
      expect(await body.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0);
    }
    const contentButtons = page.locator('.module-frame__body button:not(.card-header button)');
    expect(await contentButtons.count()).toBeGreaterThan(0);
    await expect(contentButtons.first()).toBeVisible();
    for (const button of await page.locator('.card-header button').all()) await expect(button).toBeHidden();

    await root.dblclick({ position: { x: 4, y: 4 } });
    await expect(root).not.toHaveClass(/app-shell--no-topbar/);
    for (const header of await headers.all()) await expect(header).toBeVisible();

    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    const hideNavigation = page.getByRole('checkbox', { name: /设为壁纸后隐藏导航栏/ });
    await expect(hideNavigation).toBeChecked();
    await hideNavigation.uncheck();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeHidden();
    await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
    await expect(page.locator('.topbar')).toBeVisible();
    for (const header of await headers.all()) await expect(header).toBeVisible();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nowly:browser-backend')!));
    expect(stored.moduleLayout).toEqual(layout);
    expect(stored.settings.hideTopbarInWallpaper).toBe(false);
    await page.reload();
    await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
    for (const header of await headers.all()) await expect(header).toBeVisible();
  });
}
