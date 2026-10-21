import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CalendarSubscription } from '../src/calendar/subscription-model';

const subscriptions: CalendarSubscription[] = [
  { name: 'calendar.owner@example.com', provider: 'google' },
  { name: 'Calendar', provider: 'microsoft' },
  { name: '中国 节假日', provider: 'microsoft' },
  { name: '生日', provider: 'microsoft' }
].map((item, index) => ({
  ...item,
  provider: item.provider as CalendarSubscription['provider'],
  id: `subscription-${index}`,
  url: '',
  color: '#4fc9da',
  categoryId: null,
  refreshIntervalMinutes: 15,
  accountId: `account-${index}`,
  remoteCalendarId: `remote-${index}`,
  lastSyncedAt: '2026-10-20T06:00:00.000Z',
  lastAttemptedAt: '2026-10-20T06:00:00.000Z',
  lastStatus: 'ok',
  lastError: null,
  createdAt: '2026-10-20T06:00:00.000Z',
  updatedAt: '2026-10-20T06:00:00.000Z'
}));

async function openSettings(page: Page) {
  await page.addInitScript(subscriptions => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:browser-backend', JSON.stringify({
      settings: { wallpaperEnabled: false, density: 'balanced' },
      moduleLayout: [{ id: 'calendar', x: 0, y: 0, w: 12, h: 8 }],
      subscriptions
    }));
  }, subscriptions);
  await page.goto('/');
  await page.getByRole('button', { name: '日历设置', exact: true }).click();
  return page.getByRole('dialog', { name: '日历设置', exact: true });
}

async function expectWidth(dialog: Locator, width: number) {
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(width);
}

async function expectNoHorizontalOverflow(dialog: Locator) {
  const body = dialog.locator('.good-dialog__body');
  expect(await body.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

test('calendar settings provides the same wide surface on both tabs', async ({ page }) => {
  const dialog = await openSettings(page);
  await expectWidth(dialog, 760);
  await expect(dialog.getByRole('tab', { name: '基础设置' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('tab', { name: '日历订阅(4)' }).click();
  await expectWidth(dialog, 760);
  await expect(dialog.locator('.subscription-list__row')).toHaveCount(4);
  await expectNoHorizontalOverflow(dialog);
  for (const text of await dialog.locator('.subscription-list__provider, .subscription-list__status').all()) {
    expect(await text.evaluate(element => {
      const style = getComputedStyle(element);
      return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        <= parseFloat(style.lineHeight) + 1;
    }), 'provider and sync status should stay on one line').toBe(true);
  }
  await dialog.getByRole('tab', { name: '基础设置' }).click();
  await expectWidth(dialog, 760);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('calendar settings width stays inside a narrower window', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1244 });
  const dialog = await openSettings(page);
  await expectWidth(dialog, 704);
  await dialog.getByRole('tab', { name: '日历订阅(4)' }).click();
  await expectNoHorizontalOverflow(dialog);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(752);
  expect(box.y).toBeGreaterThanOrEqual(32);
  expect(box.y + box.height).toBeLessThanOrEqual(1212);
});
