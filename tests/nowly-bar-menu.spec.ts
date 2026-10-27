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
      { id: 'assistant', visible: true },
      { id: 'createEvent', visible: true },
      { id: 'createTask', visible: true },
      { id: 'createNote', visible: true }
    ];
    // Quick-create shortcuts are optional: unset, registered, and set but unavailable.
    let shortcuts: Record<string, unknown> = {
      screenshot: { shortcut: 'Ctrl+Alt+A', registered: true, error: null },
      history: { shortcut: 'Ctrl+Alt+H', registered: true, error: null },
      createEvent: { shortcut: '', registered: false, error: null },
      createTask: { shortcut: 'Ctrl+Alt+T', registered: true, error: null },
      createNote: { shortcut: 'Ctrl+Alt+N', registered: false, error: 'Shortcut in use' }
    };
    const calls: string[] = [];
    const quickCreates: unknown[] = [];
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
      calls, quickCreates, open, close, emit,
      setCaptureFails: (value: boolean) => { captureFails = value; },
      setMenu: (value: typeof menu) => { menu = value; emit('status-island-invalidated', null); },
      setShortcuts: (value: Record<string, unknown>) => { shortcuts = { ...shortcuts, ...value }; }
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
        // Persistent mode keeps the full Bar; notification-only would fold it into the top-edge strip.
        if (command === 'get_status_island_snapshot') return {
          sampledAt: new Date().toISOString(), events: [], externalEvents: [], tasks: [], reminders: [],
          focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0 }, barMenu: menu,
          notificationMode: 'persistent'
        };
        if (command === 'screenshot_shortcut_status') return shortcuts;
        // Native `open_quick_create` collapses the menu before showing its own window.
        if (command === 'open_quick_create') { quickCreates.push(args.kind); close(); }
        if (command === 'toggle_bar_menu') open('menu');
        if (command === 'toggle_nowly_panel') open('nowly');
        if (command === 'open_screenshot_history') open('history');
        if (command === 'close_status_island_details') close();
        if (command === 'start_screen_capture') {
          // Native commands reject with the structured CommandError contract.
          if (captureFails) throw { code: 'system_error', message: 'Capture startup failed' };
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
  expect((await title.boundingBox())!.x).toBe(titleX - 72);
  await page.keyboard.press('Escape');
  await expect(status).toHaveCSS('width', '288px');
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const menu = page.getByRole('menu', { name: '功能菜单' });
  await expect(menu).toBeVisible();
  await expect(page.locator('.status-rail__menu')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__menu')).toHaveCSS('height', '288px');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(menu.getByRole('menuitem')).toHaveCount(5);
  await expect(menu.getByRole('menuitem', { name: /AI/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('bar-menu.png') });
  await menu.getByRole('menuitem', { name: /截图历史/ }).click();
  await expect(page.locator('.status-rail__history')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__history')).toHaveCSS('height', '560px');
  await page.screenshot({ path: testInfo.outputPath('bar-history.png') });
  await page.keyboard.press('Escape');
  // The AI entry is hidden from the menu for now; its panel still opens from the native side.
  await page.evaluate(() => Reflect.get(window, '__barTest').open('nowly'));
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('width', '432px');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('height', '440px');
  await expect(page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('bar-assistant.png') });
  expect(await page.evaluate(() => Reflect.get(window, '__barTest').calls.filter((name: string) =>
    name === 'acknowledge_status_island_reminder').length)).toBe(0);
});

test('Bar controls never draw focus or active rings, including Logo after Escape', async ({ page }) => {
  await installBar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const logo = page.getByRole('button', { name: 'Nowly', exact: true });
  await logo.click();
  const menu = page.getByRole('menu', { name: '功能菜单' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(logo).toBeFocused();
  await expect(logo).toHaveCSS('box-shadow', 'none');
  await expect(logo).toHaveCSS('outline-style', 'none');

  for (const surface of ['island', 'menu', 'history', 'nowly']) {
    await page.evaluate(source => Reflect.get(window, '__barTest').open(source), surface);
    const controls = page.locator('.status-rail').locator('button:visible:not(:disabled), a:visible, summary:visible');
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      if (await control.evaluate(element => Boolean(element.closest('[inert], [aria-hidden="true"]'))
        || getComputedStyle(element).pointerEvents === 'none')) continue;
      await control.focus();
      await expect(control).toBeFocused();
      await expect(control).toHaveCSS('outline-style', 'none');
      await expect(control).toHaveCSS('box-shadow', 'none');
      await control.hover();
      await page.mouse.down();
      await expect(control).toHaveCSS('outline-style', 'none');
      await expect(control).toHaveCSS('box-shadow', 'none');
      // Release outside the control to avoid activating destructive actions.
      await page.mouse.move(431, 559);
      await page.mouse.up();
    }
    await page.keyboard.press('Escape');
  }
});

test('reopening the menu after Escape does not leave the first item hover-styled', async ({ page }) => {
  await installBar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const logo = page.getByRole('button', { name: 'Nowly', exact: true });
  await logo.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(logo).toBeFocused();
  await logo.click();
  const first = page.getByRole('menuitem').first();
  await expect(first).toBeFocused();
  await page.mouse.move(431, 559);
  expect(await first.evaluate(element => ({
    hovered: element.matches(':hover'),
    focusVisible: element.matches(':focus-visible')
  }))).toEqual({ hovered: false, focusVisible: true });
  // The first item is a quick-create tile; its neighbour shows the resting tile style.
  const normal = await page.getByRole('menuitem').nth(1).evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  await expect(first).toHaveCSS('background-color', normal.background);
  await expect(first).toHaveCSS('color', normal.color);
  await first.hover();
  await expect(first).not.toHaveCSS('background-color', normal.background);
  await page.mouse.move(431, 559);
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS('background-color', normal.background);
  await expect(first).toHaveCSS('color', normal.color);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
});

test('arrow keys move linearly across groups and Home/End jump to the ends', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  const names = ['日程', '四象限任务', '便签', '截图', '截图历史'];
  for (let index = 1; index < names.length; index++) {
    await page.keyboard.press(index % 2 ? 'ArrowRight' : 'ArrowDown');
    await expect(items.nth(index)).toBeFocused();
    await expect(items.nth(index)).toContainText(names[index]);
  }
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
});

test('live menu order and visibility update without changing Bar geometry', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__barTest').setMenu([
    { id: 'assistant', visible: true },
    { id: 'screenshotHistory', visible: true },
    { id: 'screenshot', visible: false },
    { id: 'createNote', visible: true },
    { id: 'createEvent', visible: true },
    { id: 'createTask', visible: false }
  ]));
  // Groups keep their fixed order; items follow the saved order inside each group.
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  await expect(page.getByRole('group', { name: '快速创建' }).getByRole('menuitem')).toHaveText([/^便签/, /^日程/]);
  await expect(page.getByRole('group', { name: '截图' }).getByRole('menuitem')).toHaveText([/^截图历史/]);
  await expect(page.locator('.status-rail__menu')).toHaveCSS('width', '432px');
  await page.evaluate(() => Reflect.get(window, '__barTest').setMenu([
    { id: 'assistant', visible: true },
    { id: 'screenshotHistory', visible: true },
    { id: 'screenshot', visible: true },
    { id: 'createNote', visible: false },
    { id: 'createEvent', visible: false },
    { id: 'createTask', visible: false }
  ]));
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByRole('group')).toHaveCount(1);
  await expect(page.getByText('快速创建', { exact: true })).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, '__barTest').setMenu([
    { id: 'assistant', visible: false },
    { id: 'screenshotHistory', visible: false },
    { id: 'screenshot', visible: false },
    { id: 'createEvent', visible: false },
    { id: 'createTask', visible: false },
    { id: 'createNote', visible: false }
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
  await page.getByRole('menuitem', { name: '截图', exact: true }).click();
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
  await page.getByRole('menuitem', { name: /^截图历史/ }).click();
  await page.evaluate(() => Reflect.get(window, '__barTest').emit('status-island-details-closed', { generation: 1 }));
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'history');
  await expect(page.getByRole('heading', { name: '截图历史' })).toBeVisible();
});

for (const language of ['zh', 'en', 'fr', 'es', 'ja', 'ko', 'zh-Hant']) {
  test(`menu entries center icons above labels (${language})`, async ({ page }) => {
    await installBar(page, language);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Nowly', exact: true }).click();
    const entries = page.getByRole('menuitem');
    await expect(entries).toHaveCount(5);
    await expect(page.locator('.bar-menu-panel__keys, .bar-menu-panel__shortcut, .bar-menu-panel__note')).toHaveCount(0);

    for (const entry of await entries.all()) {
      const box = (await entry.boundingBox())!;
      const icon = (await entry.locator('svg').boundingBox())!;
      const label = (await entry.locator('.bar-menu-panel__label').boundingBox())!;
      const center = box.x + box.width / 2;
      expect(Math.abs(icon.x + icon.width / 2 - center)).toBeLessThan(1);
      expect(Math.abs(label.x + label.width / 2 - center)).toBeLessThan(1);
      expect(label.y - icon.y - icon.height).toBeCloseTo(8, 0);
      await expect(entry).toHaveCSS('text-align', 'center');
      const contentCenterY = (icon.y + label.y + label.height) / 2;
      expect(Math.abs(contentCenterY - box.y - box.height / 2)).toBeLessThan(1);
      expect(box.height).toBeGreaterThanOrEqual(80);
      expect(await entry.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await expect(page.locator('.status-rail__menu')).toHaveCSS('height', '288px');
    expect(await page.locator('.bar-menu-panel__body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test('capture labels stay aligned when one shortcut is unavailable', async ({ page }) => {
  await installBar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => Reflect.get(window, '__barTest').setShortcuts({
    history: { shortcut: 'Ctrl+Alt+H', registered: false, error: 'Shortcut in use' }
  }));
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const entries = page.locator('.bar-menu-panel__item');
  await expect(entries).toHaveText(['截图', '截图历史']);
  const labels = await Promise.all((await entries.all()).map(entry => entry.locator('.bar-menu-panel__label').boundingBox()));
  expect(labels[0]!.y).toBeCloseTo(labels[1]!.y, 0);
});

test('quick create tiles show only names and open the create window', async ({ page }) => {
  await installBar(page);
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const create = page.getByRole('group', { name: '快速创建' });
  const tiles = create.getByRole('menuitem');
  await expect(tiles).toHaveCount(3);
  const boxes = await Promise.all((await tiles.all()).map(tile => tile.boundingBox()));
  // Three equal tiles share one row.
  expect(new Set(boxes.map(box => Math.round(box!.y))).size).toBe(1);
  expect(new Set(boxes.map(box => Math.round(box!.width))).size).toBe(1);
  await expect(tiles).toHaveText(['日程', '四象限任务', '便签']);
  expect(await page.locator('.bar-menu-panel__body').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);

  await tiles.nth(1).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__barTest').quickCreates)).toEqual(['task']);
  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'status');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('English menu shows only names without horizontal overflow', async ({ page }) => {
  await installBar(page, 'en');
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Function menu' })).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(5);
  await expect(page.getByRole('group', { name: 'Quick create' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Screenshots' })).toBeVisible();
  await expect(page.getByText(/Ctrl\+Alt\+/)).toHaveCount(0);
  await expect(page.getByText('Shortcut unavailable', { exact: true })).toHaveCount(0);
  expect(await page.locator('.bar-menu-panel__body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('long menu text stops at two lines with an ellipsis', async ({ page }) => {
  await installBar(page, 'fr');
  const long = 'Un nom de fonctionnalité exceptionnellement long pour vérifier la mise en page';
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  const tile = page.getByRole('menuitem').nth(1);
  const label = tile.locator('.bar-menu-panel__label');
  await label.evaluate((element, text) => { element.textContent = text; }, long);
  await expect(tile).toHaveAccessibleName(long);
  const metrics = await label.evaluate(element => {
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight);
    const shown = element.getBoundingClientRect().height;
    element.style.setProperty('-webkit-line-clamp', 'unset');
    element.style.setProperty('display', 'block');
    const natural = element.getBoundingClientRect().height;
    element.removeAttribute('style');
    return { clamp: style.webkitLineClamp, shown: Math.round(shown / line), natural: Math.round(natural / line) };
  });
  expect(metrics.clamp).toBe('2');
  expect(metrics.shown).toBe(2);
  expect(metrics.natural).toBeGreaterThan(2);
  const texts = page.locator('.bar-menu-panel__label');
  for (const text of await texts.all()) {
    expect(await text.evaluate(element =>
      Math.round(element.clientHeight / parseFloat(getComputedStyle(element).lineHeight)))).toBeLessThanOrEqual(2);
  }
  expect(await page.locator('.bar-menu-panel__body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
