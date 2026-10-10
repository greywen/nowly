import { expect, test } from '@playwright/test';

test('screenshot menu shows configured keys and executes selected action', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Reflect.set(window, '__menuCalls', calls);
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'screenshot-menu' }, currentWebview: { label: 'screenshot-menu' } },
      transformCallback: () => 1,
      invoke: async (command: string) => {
        calls.push(command);
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'screenshot_shortcut_status') return {
          screenshot: { shortcut: 'Ctrl+Alt+A', registered: true, error: null },
          history: { shortcut: 'Ctrl+Alt+H', registered: true, error: null }
        };
        if (command === 'get_app_settings') return { iconStyle: 'duotone' };
        return null;
      }
    });
  });
  await page.goto('/');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByText('Ctrl+Alt+A', { exact: true })).toBeVisible();
  await expect(page.getByText('Ctrl+Alt+H', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__menuCalls') as string[])).toContain('open_screenshot_history');
});

const id = '11111111-1111-4111-8111-111111111111';

test('history copies images without adding entries and confirms file deletion', async ({ page }) => {
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
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'quick-panel-handle' }, currentWebview: { label: 'quick-panel-handle' } },
      convertFileSrc: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=',
      transformCallback: (callback: (payload: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push({ command, args });
        if (command === 'list_screenshot_history') return { items: deleted ? [] : [{ id, fileName: 'shot.png', createdAt: '2026-10-09T11:00:00Z', width: 1920, height: 1080, byteSize: 1000, available: true }], nextCursor: null };
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
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Nowly Bar' })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__TAURI_INTERNALS__').invoke('open_screenshot_history'));
  await expect(page.getByRole('heading', { name: '截图历史', exact: true })).toBeVisible();
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'history');
  await expect.poll(async () => Math.round((await page.locator('.status-rail__history').boundingBox())!.height)).toBe(560);
  expect((await page.locator('.status-rail__history').boundingBox())!.width).toBe(408);
  await expect(page.getByText('1920 × 1080')).toBeVisible();
  await page.getByRole('button', { name: /复制/ }).first().click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__historyCalls') as Array<{ command: string }>).filter(call => call.command === 'copy_screenshot_history').length)).toBe(1);
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
  await expect(page.getByText('1920 × 1080')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'status');
  await expect(page.getByRole('heading', { name: '截图历史', exact: true })).toHaveCount(0);
});
