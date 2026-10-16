import { expect, test } from '@playwright/test';

test('homepage motion reveals once and respects reduced motion in both languages', async ({ page }) => {
  for (const url of ['/', '/en/index.html']) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(url);
    await expect(page.locator('.hero__copy h1')).toHaveClass(/site__reveal/);
    const card = page.locator('.site__card').first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/site__reveal/);
    await expect(card).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => card.evaluate(el => getComputedStyle(el).transform)).toBe('none');
    await expect.poll(() => card.evaluate(el => getComputedStyle(el).animationDuration)).toBe('0.14s');
  }
});

test('homepage module showcase rotates, selects and pauses accessibly', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const showcase = page.getByRole('region', { name: '模块截图展示' });
  const image = showcase.locator('.hero__image');
  await expect(showcase.getByRole('button', { pressed: true })).toHaveText('工作桌面');
  const first = await image.getAttribute('src');
  await page.clock.fastForward(5000);
  await expect(image).not.toHaveAttribute('src', first!);
  await expect(showcase.locator('[data-playback]')).toHaveCount(0);
  await expect(showcase.locator('.hero__image-outgoing')).toHaveAttribute('aria-hidden', 'true');
  await showcase.getByRole('button', { name: '贴纸', exact: true }).click();
  await expect(image).toHaveAttribute('src', /stickers\.png$/);
  await expect(showcase.getByRole('button', { name: '贴纸', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('showcase suspends for hover and focus and resumes after leaving', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const showcase = page.getByRole('region', { name: '模块截图展示' });
  const image = showcase.locator('.hero__image');
  const first = await image.getAttribute('src');
  await showcase.hover();
  await page.clock.fastForward(10000);
  await expect(image).toHaveAttribute('src', first!);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(5000);
  await expect(image).not.toHaveAttribute('src', first!);
  await showcase.getByRole('button', { name: '工作桌面', exact: true }).focus();
  const focused = await image.getAttribute('src');
  await page.clock.fastForward(10000);
  await expect(image).toHaveAttribute('src', focused!);
  await page.getByRole('heading', { level: 1 }).click();
  await page.clock.fastForward(5000);
  await expect(image).not.toHaveAttribute('src', focused!);
});

test('all eight screenshots load, wrap around and retain a stable layout', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en/index.html');
  const showcase = page.getByRole('region', { name: 'Module screenshots' });
  const image = showcase.locator('.hero__image');
  await showcase.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
  const initial = await image.boundingBox();
  const sources = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1280)).toBe(true);
    sources.add((await image.getAttribute('src'))!);
    expect(await image.boundingBox()).toEqual(initial);
    await page.clock.fastForward(5000);
  }
  expect(sources.size).toBe(8);
  await expect(showcase.getByRole('button', { name: 'Workspace', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('language navigation switches the first image and all eight candidates', async ({ page }) => {
  for (const prefix of ['', 'en/', 'zh-CN/']) {
    await page.goto(`/${prefix}index.html`);
    const language = prefix === 'en/' ? 'en' : 'zh';
    await expect(page.locator('.hero__image')).toHaveAttribute('src', new RegExp(`screenshots/${language}/workspace\\.png$`));
    const buttons = page.locator('[data-slide]');
    await expect(buttons).toHaveCount(8);
    for (let i = 0; i < 8; i++) {
      await expect(buttons.nth(i)).toHaveAttribute('data-src', new RegExp(`screenshots/${language}/`));
      await buttons.nth(i).click();
      await expect(page.locator('.hero__image')).toHaveAttribute('src', (await buttons.nth(i).getAttribute('data-src'))!);
      await expect.poll(() => page.locator('.hero__image').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1280)).toBe(true);
    }
  }
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page.locator('.hero__image')).toHaveAttribute('src', /screenshots\/en\/workspace\.png$/);
  await page.getByRole('link', { name: '简体中文', exact: true }).click();
  await expect(page.locator('.hero__image')).toHaveAttribute('src', /screenshots\/zh\/workspace\.png$/);
});

test('homepage retains its first screenshot without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const prefix of ['', 'en/']) {
      await page.goto(`/${prefix}index.html`);
      await expect(page.locator('.hero__image')).toBeVisible();
      await expect(page.locator('.hero__image')).toHaveAttribute('src', new RegExp(`screenshots/${prefix ? 'en' : 'zh'}/workspace\\.png$`));
      await expect(page.locator('.hero__controls')).toBeHidden();
    }
  } finally { await context.close(); }
});

test('reduced motion disables automatic screenshot switching', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/en/index.html');
  const showcase = page.getByRole('region', { name: 'Module screenshots' });
  const image = showcase.locator('.hero__image');
  const first = await image.getAttribute('src');
  await page.clock.fastForward(15000);
  await expect(image).toHaveAttribute('src', first!);
  await showcase.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(image).toHaveAttribute('src', /kanban\.png$/);
});

const pages = ['index', 'download', 'guide', 'support', 'privacy', 'terms', 'data-deletion', 'calendar', 'tasks', 'notes', 'time', 'desktop', 'capture', 'connections'];

test('all languages, legal compatibility and narrow layouts work without remote assets', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4174')) remote.push(request.url()); });
  for (const prefix of ['', 'en/', 'zh-CN/']) {
    for (const name of pages) {
      const response = await page.goto(`/${prefix}${name}.html`);
      expect(response?.ok()).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('lang', prefix === 'en/' ? 'en' : 'zh-CN');
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontSize)).toBe('13px');
      expect(await page.locator('body').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(name + '\\.html$'));
    }
  }
  expect(remote).toEqual([]);
});

test('download, language, keyboard skip link and FAQ provide real navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('你的 Windows 个人工作桌面');
  await expect(page.locator('.hero__image')).toBeVisible();
  expect(await page.locator('.hero__image').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('.site__skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  await page.locator('summary').first().click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/en\/index.html$/);
  await page.getByRole('link', { name: '简体中文', exact: true }).click();
  await expect(page).toHaveURL(/\/index.html$/);
  await expect(page.locator('.hero__copy .site__button--primary')).toHaveAttribute('href', 'https://github.com/greywen/nowly/releases');
});