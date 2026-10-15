import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nowly:onboarding-seen', 'true'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

async function addModule(page: Page) {
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加模块', exact: true }).click();
  const removeCalendar = page.getByRole('button', { name: '移除日历', exact: true });
  if (await removeCalendar.count()) await removeCalendar.click();
  await page.getByRole('button', { name: '添加贴纸', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
}

async function addText(page: Page, text: string) {
  const module = page.locator('[data-widget-id="stickers"]');
  const canvas = module.getByTestId('sticker-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .35);
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  const input = page.getByRole('textbox', { name: '文字内容', exact: true });
  await input.fill(text);
  return { module, input };
}

test('adds and edits text in place, then reloads the autosaved canvas', async ({ page }) => {
  await addModule(page);
  const { module, input } = await addText(page, '专注当下');
  await page.getByRole('combobox', { name: '文字样式', exact: true }).click();
  await page.getByRole('option', { name: '粗体', exact: true }).click();
  await expect(module).toContainText('已保存');
  expect(await module.getByRole('dialog').count()).toBe(0);
  await page.reload();
  await expect(page.locator('[data-widget-id="stickers"]')).toContainText('专注当下');
});

test('shows layers and save status only while hovering the sticker module', async ({ page }) => {
  await addModule(page);
  const { module, input } = await addText(page, '悬停提示');
  const layers = module.getByRole('button', { name: '图层', exact: true });
  const status = module.getByRole('status');
  await expect(status).toHaveText('已保存');
  await page.mouse.move(1, 1);
  await expect(input).toBeFocused();
  await expect(layers).toBeHidden();
  await expect(status).toBeHidden();
  await module.locator('.card-header').hover();
  await expect(layers).toBeVisible();
  await expect(status).toBeVisible();
  await layers.click();
  const list = module.locator('.sticker-widget__layer-list');
  await expect(list).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(list).toBeHidden();
  await expect(status).toBeHidden();
  await module.locator('.card-header').hover();
  await expect(list).toBeVisible();
  await expect(status).toHaveText('已保存');
  await expect(module.getByTestId('sticker-object')).toHaveCount(1);
});

test('toolbar dropdowns show complete option labels', async ({ page }) => {
  await addModule(page);
  await addText(page, '下拉文字完整显示');
  for (const name of ['文字样式', '字号', '对齐', '不透明度（%）', '图层']) {
    const trigger = page.getByRole('combobox', { name, exact: true });
    await trigger.click();
    const popup = page.locator('.select-popup');
    const labels = await popup.locator('.select-option .select-value').evaluateAll(elements =>
      elements.map(element => ({ text: element.textContent, width: element.clientWidth, content: element.scrollWidth })));
    for (const label of labels) expect(label.width, `${name}: ${label.text}`).toBeGreaterThanOrEqual(label.content);
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
    await trigger.click();
  }
});

test('layer list fits complete labels within the module', async ({ page }) => {
  await addModule(page);
  const { module } = await addText(page, '欢迎使用 Nowly，今天也要专注当下');
  await module.getByRole('button', { name: '图层', exact: true }).click();
  const list = module.locator('.sticker-widget__layer-list');
  const label = list.getByRole('button');
  await expect(label).toBeVisible();
  const metrics = await label.evaluate(element => {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return { textWidth: text.width, availableWidth: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2,
      height: element.clientHeight, contentHeight: element.scrollHeight };
  });
  expect(metrics.textWidth).toBeLessThanOrEqual(metrics.availableWidth + 1);
  expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.height);
  const bounds = (await list.boundingBox())!;
  const moduleBounds = (await module.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(moduleBounds.x + moduleBounds.width);
  await label.click();
  await expect(list).toHaveCount(0);
  await expect(module.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue('欢迎使用 Nowly，今天也要专注当下');
});

test('saved text enters inline editing on a single click', async ({ page }) => {
  await addModule(page);
  const { module } = await addText(page, '单击与双击测试');
  await expect(module).toContainText('已保存');
  await page.reload();
  const object = module.getByTestId('sticker-object');
  const input = module.getByRole('textbox', { name: '文字内容', exact: true });
  const addMenu = module.getByRole('button', { name: '添加文字', exact: true });
  await expect(object).toHaveText('单击与双击测试');
  await expect(object).not.toHaveClass(/sticker-object--selected/);
  await object.locator('.sticker-object__text').click();
  await expect(object).toHaveClass(/sticker-object--selected/);
  await expect(module.getByRole('toolbar', { name: '对象属性', exact: true })).toBeVisible();
  await expect(input).toBeVisible();
  await expect(addMenu).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('单击与双击测试');
  await expect(addMenu).toHaveCount(0);
  await input.fill('双击后修改');
  await input.press('Escape');
  await expect(module).toContainText('已保存');
  await page.reload();
  await expect(object).toHaveText('双击后修改');
});

test('supports image upload and object style controls', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  const canvas = module.getByTestId('sticker-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * .45, box.y + box.height * .45);
  await page.getByRole('button', { name: '上传图片', exact: true }).click();
  const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type="file"][accept=".png,.jpg,.jpeg,.webp"]').setInputFiles({ name: 'sticker.png', mimeType: 'image/png', buffer: transparentPng });
  await expect(module.locator('.sticker-object__image')).toBeVisible();
  await module.getByRole('combobox', { name: '图片样式', exact: true }).click();
  await page.getByRole('option', { name: '圆角', exact: true }).click();
  await expect(module.locator('.sticker-object__image--rounded')).toBeVisible();
  await expect(module).toContainText('已保存');
  await module.getByRole('button', { name: '替换图片', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: transparentPng });
  await expect(module.getByTestId('sticker-object')).toHaveCount(1);
  await expect(module).toContainText('已保存');
  await page.reload();
  await expect(module.locator('.sticker-object__image--rounded img')).toBeVisible();
  expect(await module.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test('cancels a pointer gesture without creating an object', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  const canvas = module.getByTestId('sticker-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(module.locator('[data-testid="sticker-object"]')).toHaveCount(0);
});

test('hides editing controls in wallpaper mode', async ({ page }) => {
  await addModule(page);
  await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
  const module = page.locator('[data-widget-id="stickers"]');
  await expect(module.getByTestId('sticker-canvas')).toBeVisible();
  await expect(module.getByRole('button', { name: '添加文字', exact: true })).toHaveCount(0);
  await expect(module.locator('input[type="file"]')).toHaveCount(0);
});

test('moves, resizes and cancels real object gestures with a bounded toolbar', async ({ page }) => {
  await addModule(page);
  const { module, input } = await addText(page, '拖动测试');
  await input.press('Escape');
  const object = module.getByTestId('sticker-object');
  let box = (await object.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => object.evaluate(element => element.hasPointerCapture(1))).toBe(true);
  const canvas = (await module.getByTestId('sticker-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width + 10, canvas.y + canvas.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 4 });
  await page.mouse.up();
  const moved = (await object.boundingBox())!;
  expect(await object.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  expect(moved.x).toBeGreaterThan(box.x + 5);
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width / 2 + 8, moved.y + moved.height / 2 + 8);
  await module.getByTestId('sticker-canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  box = (await object.boundingBox())!;
  expect(Math.abs(box.x - moved.x)).toBeLessThan(1);
  await expect(module.getByRole('button', { name: '添加文字', exact: true })).toHaveCount(0);
  const handle = (await module.locator('.sticker-object__handle--resize').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 8, handle.y + handle.height / 2 + 8, { steps: 4 });
  await page.mouse.up();
  expect((await object.boundingBox())!.width).toBeGreaterThan(box.width);
  const toolbar = (await module.getByRole('toolbar', { name: '对象属性' }).boundingBox())!;
  const bounds = (await module.locator('.sticker-widget__body').boundingBox())!;
  expect(toolbar.x).toBeGreaterThanOrEqual(bounds.x);
  expect(toolbar.y).toBeGreaterThanOrEqual(bounds.y);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  await expect(module).toContainText('已保存');
});

test('adapts text and exposes one scrollable row with color opacity and layer menus', async ({ page }) => {
  await addModule(page);
  const { module, input } = await addText(page, '你好，今天。');
  await expect(module).toContainText('已保存');
  expect(await input.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const object = module.getByTestId('sticker-object');
  const initial = (await object.boundingBox())!;
  await module.getByRole('combobox', { name: '字号', exact: true }).click();
  await page.getByRole('option', { name: '64', exact: true }).click();
  await expect.poll(async () => (await object.boundingBox())!.height).toBeGreaterThan(initial.height);
  await input.fill('你好，今天\n继续专注');
  await expect.poll(async () => (await object.boundingBox())!.height).toBeGreaterThan(initial.height * 2);
  await expect(module.getByText('更多', { exact: true })).toHaveCount(0);
  await expect(module.locator('input[type="number"]')).toHaveCount(0);
  const row = module.locator('.sticker-object-tools__row');
  const toolbarWidth = await module.getByRole('toolbar', { name: '对象属性' }).evaluate(element => element.clientWidth);
  const moduleWidth = await module.locator('.sticker-widget__body').evaluate(element => element.clientWidth);
  expect(toolbarWidth).toBeLessThanOrEqual(moduleWidth);
  if (moduleWidth < 600) expect(await row.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const positions = await row.locator(':scope > *').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(10);
  await module.getByRole('button', { name: '文字颜色', exact: true }).click();
  const hex = page.getByRole('textbox', { name: /十六进制|HEX|Hex/ });
  await hex.fill('#F06445');
  await hex.press('Tab');
  await page.keyboard.press('Escape');
  await expect(module.getByRole('toolbar', { name: '对象属性' })).toBeVisible();
  await module.getByRole('combobox', { name: '不透明度（%）', exact: true }).click();
  await page.getByRole('option', { name: '50%', exact: true }).click();
  await expect(module.locator('.sticker-object__text')).toHaveCSS('opacity', '0.5');
  await module.getByRole('combobox', { name: '图层', exact: true }).click();
  await page.getByRole('option', { name: '置顶', exact: true }).click();
  await module.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(module.getByRole('button', { name: '解锁', exact: true })).toBeVisible();
  await expect(module.getByRole('combobox', { name: '字号' })).toBeDisabled();
  await module.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(module).toContainText('已保存');
});

test('saves an IME draft when outside dismissal removes the composing editor', async ({ page }) => {
  await addModule(page);
  const { module, input } = await addText(page, 'before');
  await expect(module).toContainText('已保存');
  await input.selectText();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '输入', selectionStart: 2, selectionEnd: 2 });
  await expect(input).toHaveValue('输入');
  await module.getByRole('heading', { name: '贴纸', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(module).toContainText('已保存');
  await page.reload();
  await expect(module.getByTestId('sticker-object')).toHaveText('输入');
  await session.detach();
});

test('hiding and re-adding keeps the work and layout editing cannot add objects', async ({ page }) => {
  await addModule(page);
  const { module } = await addText(page, '保留作品');
  await expect(module).toContainText('已保存');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  const canvas = (await module.getByTestId('sticker-canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width * .8, canvas.y + canvas.height * .8);
  await expect(module.getByRole('toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: '添加模块', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '移除贴纸', exact: true }).click();
  await page.getByRole('button', { name: '添加贴纸', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(module).toContainText('保留作品');
});
