import { expect, test } from '@playwright/test';

const labels = ['截图快捷键', '截图历史快捷键', '新建日程', '新建四象限任务', '新建便签'];

test('all shortcut controls share clear actions and preserve unset bindings after reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    localStorage.setItem('nowly.language', 'zh');
  });
  await page.goto('/');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('tab', { name: '快捷键', exact: true }).click();
  await expect(dialog.locator('.shortcut-recorder__field')).toHaveCount(5);
  await expect(dialog.getByRole('textbox', { name: labels[0], exact: true })).toHaveValue('Ctrl+Alt+A');
  await expect(dialog.getByRole('textbox', { name: labels[1], exact: true })).toHaveValue('Ctrl+Alt+H');

  const fieldBounds = [];
  for (const label of labels) {
    const input = dialog.getByRole('textbox', { name: label, exact: true });
    const clear = dialog.getByRole('button', { name: `清除「${label}」快捷键`, exact: true });
    await expect(input).toHaveAttribute('placeholder', '未设置');
    await expect(input).toHaveCSS('height', '48px');
    await expect(clear).toHaveCSS('width', '40px');
    await expect(clear).toHaveCSS('height', '40px');
    fieldBounds.push((await input.boundingBox())!);
    if (await clear.isEnabled()) await clear.click();
    await expect(input).toHaveValue('');
    await expect(clear).toBeDisabled();
  }
  for (const bounds of fieldBounds) {
    expect(bounds.x).toBe(fieldBounds[0].x);
    expect(bounds.width).toBe(fieldBounds[0].width);
  }
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog.getByRole('tab', { name: '快捷键', exact: true }).click();
  for (const label of labels) {
    await expect(dialog.getByRole('textbox', { name: label, exact: true })).toHaveValue('');
  }

  const capture = dialog.getByRole('textbox', { name: labels[0], exact: true });
  await capture.focus();
  await capture.press('Control+Alt+A');
  await expect(capture).toHaveValue('Ctrl+Alt+A');
  const note = dialog.getByRole('textbox', { name: '新建便签', exact: true });
  await note.focus();
  await note.press('Control+Alt+A');
  await expect(dialog.getByRole('alert')).toHaveText('快捷键不能与其他快捷键重复。');
  await expect(note).toHaveValue('');
  await note.press('Control+Alt+N');
  await expect(note).toHaveValue('Ctrl+Alt+N');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await capture.focus();
  await capture.press('Delete');
  await expect(capture).toHaveValue('');
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog.getByRole('tab', { name: '快捷键', exact: true }).click();
  await expect(capture).toHaveValue('');
  await expect(note).toHaveValue('Ctrl+Alt+N');
});
