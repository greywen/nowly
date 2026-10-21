import { test, expect, type Page } from '@playwright/test';

// The overlay with a mocked native session. Scrolling capture is driven entirely
// from this one window: there are no control, preview or review windows.
async function overlay(page: Page, options: { failCopy?: boolean } = {}) {
  await page.addInitScript(({ failCopy }) => {
    localStorage.setItem('nowly.language', 'zh');
    const label = 'screenshot-overlay-7-0';
    let callback = 0;
    const listeners = new Map<string, number>();
    const calls: { command: string; args: any }[] = [];
    let state = { sessionId: '7', revision: 0, sequence: 1, phase: 'capturing', width: 320, height: 0, region: { x: 0, y: 0, width: 320, height: 200 }, hint: null as string | null };
    const emit = (event: string, payload: unknown) => {
      const id = listeners.get(event);
      if (id) Reflect.get(window, `_${id}`)({ payload });
    };
    const png = () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 900;
      const x = c.getContext('2d')!;
      for (let y = 0; y < 900; y++) {
        x.fillStyle = `rgb(${y % 255},${(y * 3) % 255},${(y * 7) % 255})`;
        x.fillRect(0, y, 320, 1);
      }
      return fetch(c.toDataURL()).then((r) => r.arrayBuffer());
    };
    Object.assign(window, {
      __SCROLL_TEST__: {
        calls,
        grow: () => {
          state = { ...state, revision: state.revision + 1, sequence: state.sequence + 1, height: 900, hint: null };
          emit('screenshot-scroll-state', state);
        },
        lose: () => {
          state = { ...state, sequence: state.sequence + 1, hint: 'lostTrack' };
          emit('screenshot-scroll-state', state);
        }
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label }, currentWebview: { label } },
        transformCallback: (fn: unknown) => {
          callback++;
          Object.assign(window, { [`_${callback}`]: fn });
          return callback;
        },
        convertFileSrc: () => '/scroll-frame.png',
        invoke: async (command: string, args: any = {}) => {
          calls.push({ command, args });
          if (command === 'plugin:event|listen') {
            listeners.set(args.event, args.handler);
            return callback;
          }
          if (command === 'describe_capture_frame') return { path: '7/0', width: 1366, height: 768, originX: 0, originY: 0, windowCandidates: [] };
          if (command === 'scroll_capture_image') return png();
          if (command === 'scroll_capture') {
            if (args.action === 'start') state = { ...state, region: args.region, width: args.region.width, sequence: state.sequence + 1 };
            if (args.action === 'finish') state = { ...state, phase: 'finished', sequence: state.sequence + 1 };
            return state;
          }
          if (command === 'copy_capture_to_clipboard' && failCopy) throw { code: 'system_error', message: 'Simulated clipboard unavailable' };
          return null;
        }
      }
    });
  }, options);
  await page.route('**/scroll-frame.png', async (route) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    await route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/screenshot.html');
  await expect(page.locator('.screenshot-overlay')).toBeVisible();
}

const calls = (page: Page) => page.evaluate(() => Reflect.get(window, '__SCROLL_TEST__').calls as { command: string; args: any }[]);

async function startScrolling(page: Page) {
  await page.mouse.move(400, 150);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '滚动截图' }).click();
  await expect(page.locator('.screenshot-scroll-hint')).toHaveText('滚动页面截取更多内容');
}

test('scrolling capture entry is temporarily hidden while normal capture stays available', async ({ page }) => {
  await overlay(page);
  await page.mouse.move(400, 150);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.getByRole('button', { name: '滚动截图' })).toHaveCount(0);
  for (const name of ['钉住', '另存为 PNG', '取消截图', '复制图片并完成']) {
    await expect(page.getByRole('button', { name })).toBeEnabled();
  }
  expect((await calls(page)).some((call) => call.command === 'scroll_capture')).toBe(false);
});

test.describe('scrolling capture (temporarily unavailable)', () => {
  test.skip(true, 'Entry hidden until scrolling capture bugs are resolved; keep coverage for restoration.');

test('scrolling capture starts at once inside the original screenshot screen', async ({ page }) => {
  await overlay(page);
  await startScrolling(page);
  const start = (await calls(page)).find((c) => c.command === 'scroll_capture');
  expect(start?.args.action).toBe('start');
  expect(start?.args.region.width).toBeGreaterThan(0);

  const toolbar = page.getByRole('toolbar');
  await expect(toolbar.getByRole('button')).toHaveCount(3);
  for (const name of ['另存为 PNG', '取消截图', '复制图片并完成']) await expect(toolbar.getByRole('button', { name })).toBeEnabled();
  await expect(page.getByRole('button', { name: '滚动截图' })).toHaveCount(0);

  await page.evaluate(() => Reflect.get(window, '__SCROLL_TEST__').grow());
  const preview = page.locator('.screenshot-scroll-preview');
  await expect(preview.locator('img')).toBeVisible();
  // Beside the selection, never over it: the selection is where the user scrolls.
  const frame = (await page.locator('.screenshot-selection__frame').boundingBox())!;
  const panel = (await preview.boundingBox())!;
  expect(panel.x + panel.width <= frame.x || panel.x >= frame.x + frame.width).toBe(true);

  await page.evaluate(() => Reflect.get(window, '__SCROLL_TEST__').lose());
  await expect(page.locator('.screenshot-scroll-hint')).toHaveText('当前内容尚未衔接，已截内容保留');
});

test('done copies the whole long image and a failure keeps the capture for retry', async ({ page }) => {
  await overlay(page, { failCopy: true });
  await startScrolling(page);
  await page.evaluate(() => Reflect.get(window, '__SCROLL_TEST__').grow());
  await page.getByRole('button', { name: '复制图片并完成' }).click();
  await expect.poll(async () => (await calls(page)).filter((c) => c.command === 'copy_capture_to_clipboard').length).toBe(1);
  const all = await calls(page);
  expect(all.some((c) => c.command === 'scroll_capture' && c.args.action === 'finish')).toBe(true);
  const startRegion = all.find((c) => c.command === 'scroll_capture' && c.args.action === 'start')!.args.region;
  expect(all.find((c) => c.command === 'copy_capture_to_clipboard')!.args.geometry).toMatchObject({ x: 0, y: 0, width: startRegion.width, height: 900, hasOverlay: false });
  await expect(page.getByRole('alert')).toContainText('Simulated clipboard unavailable');
  await expect(page.locator('.screenshot-scroll-hint')).toBeVisible();
});

test('Esc closes the whole screenshot while scrolling', async ({ page }) => {
  await overlay(page);
  await startScrolling(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await calls(page)).some((c) => c.command === 'cancel_screen_capture')).toBe(true);
});
});
