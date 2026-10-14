import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('nowly:onboarding-seen')) {
      localStorage.setItem('nowly:onboarding-seen', 'true');
    }
  });
  await page.goto('/');
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

test('edits and reloads a text canvas, keeps cancellation isolated and supports layers', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  await module.getByRole('button', { name: '添加文字', exact: true }).click();
  expect((await page.getByRole('dialog').boundingBox())!.width).toBe(1040);
  await page.getByRole('dialog').getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('文字内容', { exact: true }).fill('专注当下\n慢慢来');
  await page.getByLabel('字号', { exact: true }).fill('40');
  await page.getByRole('button', { name: '粗体', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(module).toContainText('专注当下');
  await expect(module.getByRole('button', { name: '编辑贴纸', exact: true })).toBeFocused();
  await page.reload();
  await expect(module).toContainText('专注当下');
  await module.getByRole('button', { name: '编辑贴纸', exact: true }).click();
  await page.locator('.sticker-layers__item').first().click();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.locator('.sticker-layers__item')).toHaveCount(2);
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(page.getByLabel('横坐标')).toBeDisabled();
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await page.getByLabel('文字内容', { exact: true }).fill('未保存文字');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(module).not.toContainText('未保存文字');
  await expect(module.locator('[data-testid="sticker-object"]')).toHaveCount(1);
});

test('persists a transparent image and its style across reload', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  await module.getByRole('button', { name: '添加图片', exact: true }).click();
  const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DAAAAEAQEARwbK3gAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type="file"][accept=".png,.jpg,.jpeg,.webp"]').setInputFiles({
    name: 'sticker.png', mimeType: 'image/png', buffer: transparentPng
  });
  await expect(page.locator('.sticker-layers__item')).toHaveCount(1);
  for (const [label, style] of [['圆角', 'rounded'], ['圆形（裁切）', 'circle'], ['原图', 'original']]) {
    await page.getByRole('combobox', { name: '图片样式', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.locator(`.sticker-object__image--${style}`)).toBeVisible();
  }
  await page.getByRole('combobox', { name: '图片样式', exact: true }).click();
  await page.getByRole('option', { name: '相纸', exact: true }).click();
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.locator('.sticker-layers__item')).toHaveCount(2);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(module.locator('.sticker-object__image--photo img')).toHaveCount(2);
  await expect(module.locator('.sticker-object__image--photo img').first()).toBeVisible();
  await page.reload();
  await expect(module.locator('.sticker-object__image--photo img')).toHaveCount(2);
  expect(await module.locator('img').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await module.getByRole('button', { name: '编辑贴纸', exact: true }).click();
  await page.locator('.sticker-layers__item').first().click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(module.locator('.sticker-object__image--photo img')).toBeVisible();
});

test('moves and resizes objects with real pointer input, cancels a gesture and validates text overflow', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  await module.getByRole('button', { name: '编辑贴纸', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('文字内容', { exact: true }).fill('拖动测试');
  // Keep the editing canvas in view while interacting with actual pointer geometry.
  await page.locator('.good-dialog__body').evaluate(element => { element.scrollTop = 0; });
  const box = (await page.locator('.sticker-object').boundingBox())!;
  await page.mouse.move(box.x + 16, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 46, box.y + 36, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.getByLabel('横坐标', { exact: true }).inputValue())).toBeGreaterThan(200);
  const startX = Number(await page.getByLabel('横坐标', { exact: true }).inputValue());
  const moved = (await page.locator('.sticker-object').boundingBox())!;
  await page.mouse.move(moved.x + 16, moved.y + 16);
  await page.mouse.down();
  await page.mouse.move(moved.x + 36, moved.y + 36, { steps: 3 });
  await page.locator('[data-testid="sticker-canvas"]').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(page.getByLabel('横坐标', { exact: true })).toHaveValue(String(startX));
  const handle = (await page.locator('.sticker-object__handle--resize').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 24, handle.y + handle.height / 2 + 12, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.getByLabel('宽度', { exact: true }).inputValue())).toBeGreaterThan(360);
  await page.getByLabel('旋转角度', { exact: true }).fill('15');
  await page.getByLabel('不透明度（%）', { exact: true }).fill('0');
  await page.locator('.sticker-layers__item').first().click();
  await page.getByLabel('不透明度（%）', { exact: true }).fill('100');
  await page.getByLabel('高度', { exact: true }).fill('24');
  await page.getByLabel('文字内容', { exact: true }).fill('需要更大文本框\n这一行不能被裁掉');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('文字超出文本框');
  await page.getByLabel('高度', { exact: true }).fill('200');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('hiding and re-adding preserves work and wallpaper hides editing controls', async ({ page }) => {
  await addModule(page);
  const module = page.locator('[data-widget-id="stickers"]');
  await module.getByRole('button', { name: '编辑贴纸', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('文字内容', { exact: true }).fill('我的贴纸');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await page.getByRole('button', { name: '添加模块', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '移除贴纸', exact: true }).click();
  await expect(module).toHaveCount(0);
  await page.getByRole('button', { name: '添加贴纸', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(module).toContainText('我的贴纸');
  await page.getByRole('button', { name: '设为壁纸', exact: true }).click();
  await expect(module.locator('.card-header')).not.toBeVisible();
  await expect(module.getByRole('button', { name: '编辑贴纸', exact: true })).toHaveCount(0);
  await module.locator('.sticker-object__text').dblclick();
  await expect(module.getByRole('button', { name: '编辑贴纸', exact: true })).toBeVisible();
});

test('stacks editor controls on a narrow window while preserving logical text geometry', async ({ page }) => {
  await addModule(page);
  await page.setViewportSize({ width: 640, height: 768 });
  const module = page.locator('[data-widget-id="stickers"]');
  await module.getByRole('button', { name: '编辑贴纸', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('文字内容', { exact: true }).fill('狭窄窗口也能编辑');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBe(608);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  await page.locator('.sticker-editor__canvas').scrollIntoViewIfNeeded();
  const canvas = (await page.locator('.sticker-editor__canvas').boundingBox())!;
  const sidebar = (await page.locator('.sticker-editor__sidebar').boundingBox())!;
  expect(sidebar.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  await expect(page.getByLabel('字号', { exact: true })).toHaveValue('32');
  await expect(page.getByLabel('宽度', { exact: true })).toHaveValue('360');
  await expect(page.getByLabel('高度', { exact: true })).toHaveValue('160');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(module).toContainText('狭窄窗口也能编辑');
});
