import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 432, height: 560 } });
test.setTimeout(60_000);

async function installBar(page: Page, language = 'zh') {
  await page.addInitScript(({ language }) => {
    localStorage.setItem('nowly.language', language);
    let sequence = 0;
    let generation = 0;
    let captureFails = true;
    let menu = [
      { id: 'screenshot', visible: true },
      { id: 'screenshotHistory', visible: true },
      { id: 'assistant', visible: true }
    ];
    const calls: string[] = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    const emit = (event: string, payload: unknown) => {
      const callback = callbacks.get(listeners.get(event) ?? -1);
      callback?.({ event, payload });
    };
    const open = (source: string) => emit('status-island-details-open', {
      generation: ++generation, source, identity: null
    });
    const close = () => {
      const closing = ++generation;
      emit('status-island-details-close', { generation: closing });
      setTimeout(() => emit('status-island-details-closed', { generation: closing }), 260);
    };
    Reflect.set(window, '__barTest', {
      calls, open, close, emit,
      setCaptureFails: (value: boolean) => { captureFails = value; },
      setMenu: (value: typeof menu) => { menu = value; emit('status-island-invalidated', null); }
    });
    Reflect.set(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { unregisterListener: () => undefined });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'quick-panel-handle' }, currentWebview: { label: 'quick-panel-handle' } },
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push(command);
        if (command === 'plugin:event|listen') { listeners.set(String(args.event), Number(args.handler)); return args.handler; }
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_settings') return { iconStyle: 'duotone' };
        if (command === 'get_status_island_snapshot') return {
          sampledAt: new Date().toISOString(), events: [], externalEvents: [], tasks: [], reminders: [],
          focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0 }, barMenu: menu
        };
        if (command === 'screenshot_shortcut_status') return {
          screenshot: { shortcut: 'Ctrl+Alt+A', registered: true, error: null },
          history: { shortcut: 'Ctrl+Alt+H', registered: true, error: null }
        };
        if (command === 'toggle_bar_menu') open('menu');
        if (command === 'toggle_nowly_panel') open('nowly');
        if (command === 'open_screenshot_history') open('history');
        if (command === 'close_status_island_details') close();
        if (command === 'start_screen_capture') {
          if (captureFails) throw { message: 'Capture startup failed' };
          close();
        }
        if (command === 'list_screenshot_history') return { items: [], nextCursor: null };
        if (command === 'assistant_get_config') return {
          endpoint: 'https://example.com/v1', model: 'fixture', hasKey: true,
          permissions: { calendar: true, tasks: true, external: false }
        };
        return null;
      }
    });
  }, { language });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

test('all expanded panels measure 432px while the collapsed Logo Bar is 288px', async ({ page }, testInfo) => {
  await installBar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const status = page.locator('.status-rail__status-presence');
  const title = page.locator('.status-island__copy strong');
  await expect(status).toHaveCSS('width', '288px');
  expect((await status.boundingBox())!.x).toBe(72);
  expect(await page.locator('.status-rail__app-button').count()).toBe(0);
  const titleX = (await title.boundingBox())!.x;
  await page.evaluate(() => Reflect.get(window, '__barTest').open('island'));
  await expect(status).toHaveCSS('width', '432px');
  await expect(status).toHaveCSS('height', '288px');
  expect((await status.boundingBox())!.x).toBe(0);
  expect((await title.boundingBox())!.x).toBe(titleX);
  await page.keyboard.press('Escape');
  await expect(status).toHaveCSS('width', '288px');
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const menu = page.getByRole('menu', { name: '功能菜单' });
  await expect(menu).toBeVisible();
  await expect(page.locator('.status-rail__menu')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__menu')).toHaveCSS('height', '288px');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('bar-menu.png') });
  await menu.getByRole('menuitem', { name: /截图历史/ }).click();
  await expect(page.locator('.status-rail__history')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__history')).toHaveCSS('height', '560px');
  await page.screenshot({ path: testInfo.outputPath('bar-history.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await page.getByRole('menuitem', { name: 'AI 助手' }).click();
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('height', '440px');
  await expect(page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('bar-assistant.png') });
  expect(await page.evaluate(() => Reflect.get(window, '__barTest').calls.filter((name: string) =>
    name === 'acknowledge_status_island_reminder').length)).toBe(0);
});

test('live menu order and visibility update without changing Bar geometry', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__barTest').setMenu([
    { id: 'assistant', visible: true },
    { id: 'screenshotHistory', visible: true },
    { id: 'screenshot', visible: false }
  ]));
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByRole('menuitem').first()).toHaveText('AI 助手');
  await expect(page.locator('.status-rail__menu')).toHaveCSS('width', '432px');
  await page.evaluate(() => Reflect.get(window, '__barTest').setMenu([
    { id: 'assistant', visible: false },
    { id: 'screenshotHistory', visible: false },
    { id: 'screenshot', visible: false }
  ]));
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(page.getByText('暂无显示的功能，请在设置 → Nowly Bar 中启用。')).toBeVisible();
  await expect(page.locator('[data-owner="menu"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.status-rail__status-presence')).toHaveCSS('width', '288px');
  await page.evaluate(() => Reflect.get(window, '__barTest').open('history'));
  await expect(page.getByRole('heading', { name: '截图历史' })).toBeVisible();
});

test('capture startup failures remain visible and retry without an extra window', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await page.getByRole('menuitem', { name: /^截图 Ctrl/ }).click();
  await expect(page.getByRole('alert')).toContainText('Capture startup failed');
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'menu');
  await page.evaluate(() => Reflect.get(window, '__barTest').setCaptureFails(false));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'status');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('late close events cannot close a more recently selected panel', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await page.getByRole('menuitem', { name: 'AI 助手' }).click();
  await page.evaluate(() => Reflect.get(window, '__barTest').emit('status-island-details-closed', { generation: 1 }));
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'assistant');
  await expect(page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' })).toBeVisible();
});

test('English menu shows names and configured shortcuts without horizontal overflow', async ({ page }) => {
  await installBar(page, 'en');
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Function menu' })).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  await expect(page.getByText('Ctrl+Alt+A', { exact: true })).toBeVisible();
  await expect(page.getByText('Ctrl+Alt+H', { exact: true })).toBeVisible();
  expect(await page.locator('.bar-menu-panel__body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
