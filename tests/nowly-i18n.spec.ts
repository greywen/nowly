import { expect, test, type Page } from '@playwright/test';
import { translations } from '../src/i18n/translations';
import { LOCALES, SUPPORTED_LANGUAGES, type Language } from '../src/i18n/locales';

test.setTimeout(60_000);
const layout = [
  { id: 'calendar', x: 0, y: 0, w: 8, h: 8 },
  { id: 'time', x: 8, y: 0, w: 4, h: 4 },
  { id: 'notes', x: 8, y: 4, w: 4, h: 4 }
];

async function boot(page: Page, language: Language) {
  await page.addInitScript(({ language, layout }) => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly.language')) localStorage.setItem('nowly.language', language);
    if (!localStorage.getItem('nowly:browser-backend')) {
      localStorage.setItem('nowly:browser-backend', JSON.stringify({ moduleLayout: layout }));
    }
  }, { language, layout });
  await page.goto('/');
  await expect(page.locator('[data-guide="settings"]')).toBeVisible();
}

for (const language of SUPPORTED_LANGUAGES) {
  test(`${language}: settings, translated modules, reload and constrained layout`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await boot(page, language);
    const strings = translations[language];
    await expect(page.locator('html')).toHaveAttribute('lang', LOCALES[language].lang);
    await expect(page.locator('html')).toHaveAttribute('dir', LOCALES[language].dir);
    await expect(page.locator('[data-guide="settings"]')).toHaveAccessibleName(strings['shell.openSettings']);
    await expect(page.getByRole('button', { name: strings['calendar.newEvent'], exact: true })).toBeVisible();
    const modulesBefore = await page.locator('.module-frame').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    await page.locator('[data-guide="settings"]').click();
    const dialog = page.getByRole('dialog', { name: strings['settings.title'], exact: true });
    await expect(dialog).toBeVisible();
    if (['fr', 'es', 'ar', 'ja', 'ko', 'zh-Hant'].includes(language)) {
      const fonts: Record<string, string> = { fr: 'Segoe UI', es: 'Segoe UI', ar: 'Segoe UI', ja: 'Yu Gothic UI', ko: 'Malgun Gothic', 'zh-Hant': 'Microsoft JhengHei' };
      expect(await dialog.locator('#settings-language').evaluate(element => getComputedStyle(element).fontFamily)).toContain(fonts[language]);
    }
    await dialog.locator('#settings-language').click();
    for (const id of SUPPORTED_LANGUAGES) {
      await expect(page.getByRole('option', { name: LOCALES[id].name, exact: true })).toBeAttached();
    }
    await page.getByRole('option', { name: LOCALES[language].name, exact: true }).click();
    const overflow = await dialog.evaluate(element => ({
      dialog: element.scrollWidth - element.clientWidth,
      body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offscreen: element.getBoundingClientRect().right > window.innerWidth
    }));
    expect(overflow).toEqual({ dialog: 0, body: 0, offscreen: false });
    await page.screenshot({ path: testInfo.outputPath(`settings-${language}.png`) });
    await dialog.getByRole('button', { name: strings['settings.close'], exact: true }).click();
    // Real settings switch, not a synthetic store injection.
    await page.locator('[data-guide="settings"]').click();
    await page.locator('#settings-language').click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: translations.en['settings.close'], exact: true }).click();
    expect(await page.locator('.module-frame').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }))).toEqual(modulesBefore);
    await page.reload();
    await expect(page.locator('[data-guide="settings"]')).toHaveAccessibleName('Open settings');
    expect(await page.evaluate(() => localStorage.getItem('nowly.language'))).toBe('en');
    expect(errors).toEqual([]);
  });
}

test('real secondary history window follows a language change in the main window', async ({ page, context }) => {
  await boot(page, 'en');
  const history = await context.newPage();
  await history.goto('/?surface=screenshot-history');
  await expect(history.getByRole('heading', { name: translations.en['screenshotHistory.title'], exact: true })).toBeVisible();
  await page.locator('[data-guide="settings"]').click();
  await page.locator('#settings-language').click();
  await page.getByRole('option', { name: 'العربية', exact: true }).click();
  await expect(history.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(history.getByRole('heading', { name: translations.ar['screenshotHistory.title'], exact: true })).toBeVisible();
  await history.close();
});

test('dedicated capture document loads Arabic typography and direction rules', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly.language', 'ar');
    let callbackId = 0;
    const canvas = document.createElement('canvas');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const frameUrl = canvas.toDataURL();
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'screenshot-overlay-1-0' }, currentWebview: { label: 'screenshot-overlay-1-0' } },
        transformCallback: (callback: unknown) => {
          callbackId += 1;
          Reflect.set(window, `_${callbackId}`, callback);
          return callbackId;
        },
        convertFileSrc: () => frameUrl,
        invoke: async (command: string) => command === 'describe_capture_frame'
          ? { path: '1/0', width: innerWidth, height: innerHeight, originX: 0, originY: 0, windowCandidates: [] }
          : command === 'plugin:event|listen' ? 1 : null
      }
    });
  });
  await page.goto('/screenshot.html');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-sans'))).toContain('Segoe UI');
  const overlay = page.locator('.screenshot-overlay');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(element => getComputedStyle(element).direction)).toBe('ltr');
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(600, 400);
  await page.mouse.up();
  const toolbar = page.locator('.screenshot-toolbar');
  await expect(toolbar).toBeVisible();
  expect(await toolbar.evaluate(element => getComputedStyle(element).direction)).toBe('rtl');
  await page.getByRole('button', { name: translations.ar['screenshot.tool.text'], exact: true }).click();
  await page.mouse.click(200, 200);
  const editor = page.locator('.screenshot-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Hello world! مرحباً');
  const before = await editor.evaluate(element => ({ font: getComputedStyle(element).fontFamily, x: element.getBoundingClientRect().x }));
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'en' })));
  expect(await editor.evaluate(element => ({ font: getComputedStyle(element).fontFamily, x: element.getBoundingClientRect().x }))).toEqual(before);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'ar' })));
  await editor.press('Control+Enter');
  const annotation = page.locator('.screenshot-annotations text');
  await expect(annotation).toHaveText('Hello world! مرحباً');
  expect(await annotation.evaluate(element => getComputedStyle(element).fontFamily)).toBe(before.font);
  expect(await annotation.getAttribute('font-family')).toBe(before.font);
  const metrics = await annotation.evaluate(element => {
    return { width: Number(element.getAttribute('data-width')), text: (element as SVGTextElement).getComputedTextLength() };
  });
  expect(Math.abs(metrics.width - Math.ceil(metrics.text))).toBeLessThanOrEqual(1);
});

test('saved sticker artwork keeps its font and geometry through every language', async ({ page }) => {
  await boot(page, 'zh');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加模块', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '移除日历', exact: true }).click();
  await page.getByRole('button', { name: '添加贴纸', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  const module = page.locator('[data-widget-id="stickers"]');
  const box = (await module.getByTestId('sticker-canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .35);
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('Hello world! مرحباً 日本語');
  await expect(module.getByRole('status')).toHaveText('已保存');
  await page.locator('[data-guide="settings"]').click();
  const artwork = module.locator('.sticker-object__text');
  const original = await artwork.evaluate(element => ({
    font: getComputedStyle(element).fontFamily,
    geometry: element.parentElement!.getAttribute('style'),
    measure: element.closest('.sticker-canvas__stage')!.querySelector('[data-measure-id]')!.getBoundingClientRect().width
  }));
  for (const language of SUPPORTED_LANGUAGES) {
    await page.locator('#settings-language').click();
    await page.getByRole('option', { name: LOCALES[language].name, exact: true }).click();
    expect(await artwork.evaluate(element => ({
      font: getComputedStyle(element).fontFamily,
      geometry: element.parentElement!.getAttribute('style'),
      measure: element.closest('.sticker-canvas__stage')!.querySelector('[data-measure-id]')!.getBoundingClientRect().width
    }))).toEqual(original);
    // Remounting exercises the measurement/autosave boundary, not only CSS.
    await page.reload();
    await expect(artwork).toContainText('Hello world! مرحباً 日本語');
    expect(await artwork.locator('..').getAttribute('style')).toBe(original.geometry);
    await page.locator('[data-guide="settings"]').click();
  }
});
