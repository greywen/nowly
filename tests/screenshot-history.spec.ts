import { expect, test } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';

test('history copies images without adding entries and confirms file deletion', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(({ id }) => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const callbacks = new Map<number, (payload: unknown) => void>();
    let sequence = 0;
    let deleted = false;
    const listeners = new Map<string, number>();
    let generation = 0;
    const emit = (event: string, payload: unknown) => {
      const handler = listeners.get(event);
      if (handler) callbacks.get(handler)?.({ event, id: handler, payload });
    };
    Reflect.set(window, '__historyCalls', calls);
    Reflect.set(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { unregisterListener: () => undefined });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'quick-panel-handle' }, currentWebview: { label: 'quick-panel-handle' } },
      convertFileSrc: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=',
      transformCallback: (callback: (payload: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push({ command, args });
        if (command === 'list_screenshot_history') return { items: deleted ? [] : Array.from({ length: 8 }, (_, index) => ({ id: index ? `${id}-${index}` : id, fileName: `shot-${index}.png`, createdAt: '2026-10-09T11:00:00Z', width: 1920, height: 1080, byteSize: 1000, available: true })), nextCursor: null };
        if (command === 'delete_screenshot_history') deleted = true;
        if (command === 'get_status_island_snapshot') return { sampledAt: '2026-10-10T10:00', localDate: '2026-10-10', events: [], externalEvents: [], tasks: [], reminders: [], focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0 } };
        if (command === 'open_screenshot_history') emit('status-island-details-open', { generation: ++generation, source: 'history', identity: null });
        if (command === 'close_status_island_details') {
          emit('status-island-details-close', { generation: ++generation });
          setTimeout(() => emit('status-island-details-closed', { generation }), 260);
        }
        if (command === 'plugin:event|listen') { listeners.set(args.event as string, args.handler as number); return args.handler; }
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_settings') return { density: 'balanced', iconStyle: 'duotone' };
        return null;
      }
    });
  }, { id });
  await page.setViewportSize({ width: 432, height: 560 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.getByRole('main', { name: 'Nowly Bar' })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__TAURI_INTERNALS__').invoke('open_screenshot_history'));
  await expect(page.getByRole('heading', { name: '截图历史', exact: true })).toBeVisible();
  const titleBefore = await page.getByRole('heading', { name: '截图历史', exact: true }).boundingBox();
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'history');
  await expect.poll(async () => Math.round((await page.locator('.status-rail__history').boundingBox())!.height)).toBe(560);
  await expect.poll(async () => (await page.locator('.status-rail__history').boundingBox())!.width).toBe(432);
  expect((await page.getByRole('heading', { name: '截图历史', exact: true }).boundingBox())!.x).toBeCloseTo(titleBefore!.x, 1);
  await expect(page.getByRole('article')).toHaveCount(8);
  await expect(page.getByText('1920 × 1080')).toHaveCount(0);
  await expect(page.locator('.screenshot-history-card__metadata')).toHaveCount(0);
  const cards = page.getByRole('article');
  const first = (await cards.nth(0).boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  const third = (await cards.nth(2).boundingBox())!;
  expect(second.y).toBeCloseTo(first.y, 1);
  expect(second.x - first.x - first.width).toBeCloseTo(12, 1);
  expect(third.y).toBeGreaterThan(first.y + first.height);
  const folder = page.getByRole('button', { name: '打开文件夹' });
  await expect(page.locator('.screenshot-history__header').getByRole('button', { name: '打开文件夹' })).toBeVisible();
  const folderBox = (await folder.boundingBox())!;
  const closeBox = (await page.locator('[data-owner="history"]').boundingBox())!;
  expect(folderBox.width).toBe(28);
  expect(folderBox.height).toBe(28);
  expect(closeBox.x - folderBox.x - folderBox.width).toBeCloseTo(8, 1);
  await folder.click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__historyCalls') as Array<{ command: string }>).filter(call => call.command === 'open_screenshot_folder').length)).toBe(1);
  expect(await page.locator('.screenshot-history__content').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await page.locator('.screenshot-history-card__thumbnail img').first().evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');
  await expect(cards.first().locator('time')).toHaveAttribute('datetime', '2026-10-09T11:00:00Z');
  const overlay = cards.first().locator('.screenshot-history-card__body');
  await folder.hover();
  await folder.focus();
  await expect(overlay).toHaveCSS('opacity', '0');
  await cards.first().hover();
  await expect(overlay).toHaveCSS('opacity', '1');
  const preview = (await cards.first().locator('.screenshot-history-card__thumbnail').boundingBox())!;
  expect(first.height).toBeCloseTo(preview.height + 2, 1);
  expect(preview.width / preview.height).toBeCloseTo(4 / 3, 1);
  const timeBox = (await cards.first().locator('time').boundingBox())!;
  const actionsBox = (await cards.first().locator('.screenshot-history-card__actions').boundingBox())!;
  expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(actionsBox.x);
  expect(timeBox.y + timeBox.height / 2).toBeCloseTo(actionsBox.y + actionsBox.height / 2, 1);
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(preview.y + preview.height);
  await folder.hover();
  await expect(overlay).toHaveCSS('opacity', '0');
  await cards.first().focus();
  await expect(overlay).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: /复制/ }).first().click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__historyCalls') as Array<{ command: string }>).filter(call => call.command === 'copy_screenshot_history').length)).toBe(1);
  await folder.focus();
  await folder.hover();
  await expect(overlay).toHaveCSS('opacity', '0');
  await expect(cards.first().getByRole('status')).toBeVisible();
  expect((await cards.first().boundingBox())!.height).toBeCloseTo(first.height, 1);
  await cards.first().hover();
  await page.getByRole('button', { name: /删除/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const confirmation = await page.getByRole('dialog').boundingBox();
  expect(confirmation!.x).toBeGreaterThanOrEqual(12);
  expect(confirmation!.x + confirmation!.width).toBeLessThanOrEqual(420);
  await page.keyboard.press('Escape');
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'history');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (Reflect.get(window, '__historyCalls') as Array<{ command: string }>).some(call => call.command === 'delete_screenshot_history'))).toBe(false);
  await page.getByRole('button', { name: /删除/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /删除/ }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__historyCalls') as Array<{ command: string }>).filter(call => call.command === 'delete_screenshot_history').length)).toBe(1);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'status');
  await expect(page.getByRole('heading', { name: '截图历史', exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => Reflect.get(window, '__TAURI_INTERNALS__').invoke('open_screenshot_history'));
  await expect(page.getByRole('heading', { name: '截图历史', exact: true })).toBeVisible();
  expect(await page.locator('.status-rail__history').evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(duration => duration.trim() === '0s'))).toBe(true);
});
