import { expect, test, type Page } from '@playwright/test';

async function pinShell(page: Page, width = 240, height = 160) {
  await page.addInitScript(({ width, height }) => {
    localStorage.setItem('nowly.language', 'zh');
    const calls: { command: string; args: unknown }[] = [];
    Object.assign(window, {
      __PIN_TEST__: { calls },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'screenshot-pin-1' }, currentWebview: { label: 'screenshot-pin-1' } },
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push({ command, args });
          if (command === 'capture_pin_image') {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#4fc9da';
            context.fillRect(0, 0, width, height);
            context.fillStyle = '#211f1c';
            context.fillRect(width - 1, height - 1, 1, 1);
            return fetch(canvas.toDataURL()).then(response => response.arrayBuffer());
          }
          return null;
        }
      }
    });
  }, { width, height });
}

async function calls(page: Page, command: string) {
  return page.evaluate(command =>
    (Reflect.get(window, '__PIN_TEST__').calls as { command: string; args: unknown }[])
      .filter(call => call.command === command), command);
}

test('pin fits its window without manual zoom and closes through restricted native IPC', async ({ page }) => {
  await pinShell(page);
  await page.goto('/screenshot.html');
  const image = page.getByRole('img', { name: '钉住的截图' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 240 && img.naturalHeight === 160)).toBe(true);
  expect(await image.evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
  expect(await calls(page, 'zoom_capture_pin')).toEqual([]);
  await expect(page.getByRole('button', { name: '关闭钉图' })).toBeInViewport();
  await page.getByRole('button', { name: '关闭钉图' }).click();
  expect(await calls(page, 'plugin:window|close')).toHaveLength(1);
  expect(await calls(page, 'get_app_settings')).toEqual([]);
  expect(await page.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['关闭钉图']);
});

test('all pin edges and corners invoke native resize and keep the image fitted after growing and shrinking', async ({ page }) => {
  await pinShell(page, 400, 200);
  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto('/screenshot.html');
  const image = page.getByRole('img', { name: '钉住的截图' });
  await expect(image).toBeVisible();
  const directions = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'];
  for (const direction of directions) {
    await page.locator(`.screenshot-pin__resize--${direction}`).click();
  }
  expect((await calls(page, 'plugin:window|start_resize_dragging')).map(call => call.args)).toEqual(
    directions.map(direction => ({ label: 'screenshot-pin-1', value: direction }))
  );
  expect(await calls(page, 'plugin:window|start_dragging')).toEqual([]);
  for (const size of [{ width: 800, height: 600 }, { width: 240, height: 96 }]) {
    await page.setViewportSize(size);
    const viewport = await page.locator('.screenshot-pin__viewport').boundingBox();
    const bounds = await image.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.height).toBeLessThanOrEqual(viewport!.height);
    expect(await image.evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
    await expect(page.getByRole('button', { name: '关闭钉图' })).toBeInViewport();
  }
});

test('tall pinned image initially fits completely while close remains outside image content', async ({ page }) => {
  await pinShell(page, 200, 2000);
  await page.goto('/screenshot.html');
  const image = page.getByRole('img', { name: '钉住的截图' });
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalHeight === 2000)).toBe(true);
  const bounds = await image.boundingBox();
  const viewport = await page.locator('.screenshot-pin__viewport').boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(viewport!.width + 2);
  expect(bounds!.height).toBeLessThanOrEqual(viewport!.height + 2);
  expect(await image.evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
  const close = await page.getByRole('button', { name: '关闭钉图' }).boundingBox();
  expect(close!.y + close!.height).toBeLessThanOrEqual(bounds!.y);
  expect(await calls(page, 'zoom_capture_pin')).toEqual([]);
  await expect(page.getByRole('button', { name: '关闭钉图' })).toBeInViewport();
});
