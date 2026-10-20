import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly:browser-backend')) localStorage.setItem('nowly:browser-backend', JSON.stringify({ alarmFormatVersion: 1, notes: [], moduleLayout: [{ id: 'notes', x: 0, y: 0, w: 12, h: 8 }] }));
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '新增便签' })).toBeVisible();
});

test('creates with existing compact controls, persists, edits and deletes', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  await expect(page.getByLabel('便签标题')).toHaveCount(0);
  await page.locator('#note-content').fill('产品原则\n保持简单');
  await page.getByRole('button', { name: '便签颜色', exact: true }).click();
  await page.getByRole('textbox', { name: '十六进制颜色值' }).fill('#4F55DA');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '新建便签' })).toBeVisible();
  await page.getByRole('combobox', { name: '便签图标' }).click();
  await page.getByRole('option', { name: '⭐ 星标' }).click();
  await expect(page.getByRole('combobox', { name: '便签图标' })).toHaveText('⭐');
  await page.getByRole('checkbox', { name: '置顶便签' }).check();
  await page.getByRole('button', { name: '保存便签' }).click();
  await expect(page.locator('.note-title__text')).toHaveText('产品原则');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nowly:browser-backend')!).notes[0]);
  expect(saved).toMatchObject({ color: '#4F55DA', pinned: true, icon: 'star' });
  expect(saved).not.toHaveProperty('title');
  await page.reload();
  await expect(page.locator('.note-title__text')).toHaveText('产品原则');
  await page.getByRole('button', { name: '查看全部便签' }).click();
  await page.getByRole('button', { name: '编辑便签：产品原则' }).click();
  await expect(page.getByRole('combobox', { name: '便签图标' })).toHaveText('⭐');
  await page.locator('#note-content').fill('新原则\n保持简单并专注');
  await page.getByRole('button', { name: '保存便签' }).click();
  await page.getByRole('button', { name: '编辑便签：新原则' }).click();
  await page.getByRole('button', { name: '删除便签', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '永久删除“新原则”？' })).toContainText('无法恢复');
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(page.locator('.notes-manager-list .note')).toHaveCount(0);
});

test('centers the note icon and updates its preview when selecting or clearing', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  const trigger = page.getByRole('combobox', { name: '便签图标' });
  const expectCentered = async () => {
    await expect.poll(() => trigger.evaluate(element => {
      const button = element.getBoundingClientRect();
      const icon = element.querySelector('svg, .note-dialog__icon')!.getBoundingClientRect();
      return Math.max(
        Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2),
        Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)
      );
    })).toBeLessThanOrEqual(1);
  };
  await expectCentered();
  for (const option of [{ name: '😀 大笑', symbol: '😀' }, { name: '⭐ 星标', symbol: '⭐' }]) {
    await trigger.click();
    await page.getByRole('option', { name: option.name, exact: true }).click();
    await expect(trigger).toHaveText(option.symbol);
    await expectCentered();
  }
  await trigger.click();
  await page.getByRole('option', { name: '无图标', exact: true }).click();
  await expect(trigger).toHaveText('');
  await expect(trigger.locator('svg')).toBeVisible();
  await expectCentered();
});

test('drops legacy titles without rewriting content and preserves empty notes', async ({ page }) => {
  const content = JSON.stringify({ v: 1, ops: [{ insert: '\n正文首行\n正文内容\n', attributes: { bold: true } }] });
  await page.evaluate(content => {
    const store = JSON.parse(localStorage.getItem('nowly:browser-backend')!);
    store.notes = [{ id: 'legacy', title: '旧标题', content, color: '#E8C444', pinned: false, styleVariant: 1, icon: '', createdAt: 't', updatedAt: 't' }, { id: 'empty', title: '仅标题', content: '', color: '#E8C444', pinned: false, styleVariant: 0, icon: '', createdAt: 't', updatedAt: 't' }];
    localStorage.setItem('nowly:browser-backend', JSON.stringify(store));
  }, content);
  await page.reload();
  await expect(page.locator('.note-title__text').filter({ hasText: '正文首行' })).toBeVisible();
  await expect(page.locator('.note-title__text').filter({ hasText: '无标题便笺' })).toBeVisible();
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('nowly:browser-backend')!).notes);
  expect(notes[0].content).toBe(content);
  expect(notes.every((note: Record<string, unknown>) => !('title' in note))).toBe(true);
});

test('rejects blank notes and keeps existing option popovers mutually exclusive', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  await page.getByRole('button', { name: '保存便签' }).click();
  await expect(page.getByRole('alert')).toContainText('请输入便笺内容');
  await page.getByRole('button', { name: '便签颜色', exact: true }).click();
  await page.getByRole('combobox', { name: '便签图标' }).click();
  await expect(page.getByRole('dialog', { name: '自定义颜色' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '新建便签' })).toBeVisible();
  await page.getByRole('combobox', { name: '便签图标' }).click();
  await page.getByRole('button', { name: '便签颜色', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '自定义颜色' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '新建便签' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
});

test('keeps the taller original editor and footer bounded on narrow and short windows', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  await page.locator('#note-content').waitFor();
  await expect(page.locator('.ql-toolbar button.ql-formula')).toBeVisible();
  for (const size of [{ width: 390, height: 844 }, { width: 1024, height: 600 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('.note-dialog')!;
      const footer = dialog.querySelector<HTMLElement>('.good-dialog__footer')!;
      return { box: dialog.getBoundingClientRect().toJSON(), overflow: dialog.scrollWidth > dialog.clientWidth || footer.scrollWidth > footer.clientWidth, editor: document.getElementById('note-content')!.getBoundingClientRect().height };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.box.bottom).toBeLessThanOrEqual(size.height + 1);
    expect(layout.box.top).toBeGreaterThanOrEqual(0);
    expect(layout.editor).toBeGreaterThanOrEqual(199);
  }
});

test('allows an image-only note and uses the module fallback title', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  await expect(page.locator('#note-content')).toBeVisible();
  await page.locator('.rich-editor__file-input').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFk0AAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#note-content img')).toBeVisible();
  await page.getByRole('button', { name: '保存便签' }).click();
  await expect(page.locator('.note-title__text')).toHaveText('无标题便笺');
  await page.reload();
  await expect(page.locator('.note-title__text')).toHaveText('无标题便笺');
});

test('switches to the sticky board and remembers it', async ({ page }) => {
  await page.getByRole('button', { name: '新增便签' }).click();
  await page.locator('#note-content').fill('产品原则\n保持简单');
  await page.getByRole('button', { name: '保存便签' }).click();
  await page.getByRole('button', { name: '便签显示设置' }).click();
  await page.getByRole('radio', { name: '便利贴视图' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByTestId('notes-board')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('notes-board')).toBeVisible();
  await expect(page.locator('.sticky-note__title')).toHaveText('产品原则');
});
