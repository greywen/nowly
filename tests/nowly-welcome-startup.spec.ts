import { expect, test, type Page } from '@playwright/test';

async function delayLayout(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    const defineProperty = Object.defineProperty;
    Object.defineProperty = (target, key, descriptor) => {
      if (target !== window || key !== '__TAURI_INTERNALS__') return defineProperty(target, key, descriptor);
      Object.defineProperty = defineProperty;
      const internals = descriptor.value;
      const original = internals.invoke;
      const writes: string[] = [];
      Reflect.set(window, '__welcomeWrites', writes);
      let resolve!: (entries: unknown) => void, reject!: (error: Error) => void;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
      Reflect.set(window, '__finishLayout', resolve);
      Reflect.set(window, '__failLayout', () => reject(new Error('Layout read failed')));
      internals.invoke = (command: string, args: unknown) => {
        if (command === 'list_module_layout') return pending;
        if (command === 'save_module_layout' || /sticker/.test(command) && /save|import|delete|cleanup/.test(command)) writes.push(command);
        return original(command, args);
      };
      return defineProperty(target, key, descriptor);
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test('shows only welcome stickers while pending, then restores the saved layout without writes', async ({ page }) => {
  await delayLayout(page);
  const welcome = page.getByTestId('welcome-sticker');
  await expect(welcome).toBeVisible();
  await expect(page.locator('[data-widget-id]')).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeDisabled();
  const metrics = await welcome.evaluate(element => {
    const canvas = element.querySelector('.welcome-sticker__body')!;
    const box = canvas.getBoundingClientRect();
    const core = ['welcome-logo', 'welcome-title', 'welcome-subtitle'].map(id => element.querySelector(`[data-object-id="${id}"]`)!.getBoundingClientRect());
    return {
      overflow: document.body.scrollWidth > innerWidth || document.body.scrollHeight > innerHeight,
      clipped: core.some(rect => rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom),
      gradient: getComputedStyle(canvas).backgroundImage.includes('linear-gradient'),
      lightBehindArtwork: getComputedStyle(canvas, '::after').content === 'none',
      hasCanvasHeight: box.height > 100,
      topbarGradient: getComputedStyle(document.querySelector('.topbar')!).backgroundImage,
      motion: getComputedStyle(canvas).animationName,
      transition: getComputedStyle(canvas).transitionDuration,
      interactive: element.querySelectorAll('button, textarea, [tabindex]').length
    };
  });
  expect(metrics).toEqual({ overflow: false, clipped: false, gradient: true, lightBehindArtwork: true, hasCanvasHeight: true, topbarGradient: 'none', motion: 'none', transition: '0s', interactive: 0 });
  await expect.poll(() => welcome.locator('[data-object-id="welcome-logo"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => Reflect.get(window, '__finishLayout')([{ id: 'notes', x: 0, y: 0, w: 12, h: 8 }]));
  await expect(welcome).toHaveCount(0);
  await expect(page.locator('[data-widget-id="notes"]')).toBeVisible();
  await expect(page.locator('[data-widget-id="calendar"]')).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => Reflect.get(window, '__welcomeWrites'))).toEqual([]);
});

test('retains welcome artwork with an addition guide after an empty layout loads', async ({ page }) => {
  await delayLayout(page);
  await expect(page.getByTestId('welcome-sticker')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__finishLayout')([]));
  await expect(page.getByTestId('welcome-sticker')).toBeVisible();
  await expect(page.getByTestId('welcome-sticker').getByRole('status')).toHaveText('点击编辑布局，添加你的第一个模块');
  await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: '编辑布局', exact: true })).toBeEnabled();
  await expect(page.locator('[data-widget-id]')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__welcomeWrites'))).toEqual([]);
});

test('adds a module from the empty welcome state and restores welcome after removing it and reloading', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly:browser-backend')) localStorage.setItem('nowly:browser-backend', JSON.stringify({ moduleLayout: [] }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const welcome = page.getByTestId('welcome-sticker');
  await expect(welcome.getByRole('status')).toHaveText('点击编辑布局，添加你的第一个模块');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(welcome).toBeVisible();
  await page.getByRole('button', { name: '添加模块', exact: true }).click();
  await page.getByRole('button', { name: '添加日历', exact: true }).click();
  await expect(welcome).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('[data-widget-id="calendar"]')).toBeVisible();
  await page.getByRole('button', { name: '移除日历', exact: true }).click();
  await expect(welcome.getByRole('status')).toHaveText('点击编辑布局，添加你的第一个模块');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(welcome.getByRole('status')).toHaveText('点击编辑布局，添加你的第一个模块');
  await expect(page.locator('[data-widget-id]')).toHaveCount(0);
});

test('ends the welcome state on failure using the existing default fallback', async ({ page }) => {
  await delayLayout(page);
  await expect(page.getByTestId('welcome-sticker')).toBeVisible();
  await page.evaluate(() => Reflect.get(window, '__failLayout')());
  await expect(page.getByTestId('welcome-sticker')).toHaveCount(0);
  await expect(page.locator('[data-widget-id="calendar"]')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__welcomeWrites'))).toEqual([]);
});
