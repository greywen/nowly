import { expect, test } from '@playwright/test';

// Runs on the browser shim backend (localStorage), so it also covers the shim's
// step rules; the board and the matrix share the same task data.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly:browser-backend')) {
      localStorage.setItem('nowly:browser-backend', JSON.stringify({
        alarmFormatVersion: 1,
        moduleLayout: [{ id: 'kanban', x: 0, y: 0, w: 6, h: 8 }, { id: 'matrix', x: 7, y: 0, w: 5, h: 8 }],
        // The board has no default lanes, so the spec brings its own.
        kanban: {
          lanes: [{ id: 'lane-todo', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
          cards: [], priorities: [], tags: []
        }
      }));
    }
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '泳道：待处理' })).toBeVisible();
});

test('edits steps in the shared task dialog and shows the count on the row and the card', async ({ page }) => {
  // Created on the board, so it shows on the card and in the matrix.
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  const titles = dialog.getByRole('button', { name: /^编辑步骤：/ });
  await dialog.getByLabel('任务标题').fill('发布 Nowly');
  const stepInput = dialog.getByRole('textbox', { name: '新步骤' });
  await stepInput.fill('起草');
  await stepInput.press('Enter');
  await stepInput.fill('评审');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  await stepInput.fill('上线');
  await stepInput.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(titles).toHaveText(['起草', '评审', '上线']);

  await dialog.getByRole('checkbox', { name: '完成步骤：起草' }).check();
  await dialog.getByRole('button', { name: '编辑步骤：评审' }).click();
  const edit = dialog.getByRole('textbox', { name: '步骤内容' });
  await edit.fill('终审');
  await edit.press('Enter');
  await expect(titles).toHaveText(['起草', '终审', '上线']);

  await dialog.getByRole('button', { name: '调整步骤顺序：上线' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('button', { name: '调整步骤顺序：上线' })).toBeFocused();
  await expect(titles).toHaveText(['起草', '上线', '终审']);

  // Same native drag dispatch as the kanban spec; the dragged key lives in
  // component state, and clientY puts the pointer in the lower half of row 2.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const handle = dialog.getByRole('button', { name: '调整步骤顺序：起草' });
  const target = dialog.locator('.task-step').nth(1);
  await handle.dispatchEvent('dragstart', { dataTransfer });
  const box = (await target.boundingBox())!;
  await target.dispatchEvent('dragover', { dataTransfer, clientX: box.x + 8, clientY: box.y + box.height - 2 });
  await dialog.locator('.task-steps__list').dispatchEvent('drop', { dataTransfer });
  await handle.dispatchEvent('dragend', { dataTransfer });
  await expect(titles).toHaveText(['上线', '起草', '终审']);

  await dialog.getByRole('button', { name: '删除步骤：终审' }).click();
  await expect(dialog.getByRole('progressbar', { name: '步骤' })).toHaveAttribute('aria-valuetext', '已完成 1/2 个步骤');
  await dialog.getByRole('button', { name: '保存任务' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('.task-row', { hasText: '发布 Nowly' }).locator('.task-step-count')).toContainText('1/2');
  await expect(page.getByRole('article', { name: '任务：发布 Nowly' }).locator('.task-step-count')).toContainText('1/2');

  await page.reload();
  await page.getByRole('button', { name: '编辑任务：发布 Nowly' }).click();
  const reopened = page.getByRole('dialog', { name: '编辑任务' });
  await expect(reopened.getByRole('button', { name: /^编辑步骤：/ })).toHaveText(['上线', '起草']);
  await expect(reopened.getByRole('checkbox', { name: '标记步骤为未完成：起草' })).toBeChecked();
});

test('keeps tasks created in the matrix off the kanban board', async ({ page }) => {
  await page.getByRole('button', { name: '新增任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog.getByRole('combobox', { name: '看板泳道' })).toHaveCount(0);
  await dialog.getByLabel('任务标题').fill('只在四象限');
  await dialog.getByRole('button', { name: '保存任务' }).click();
  await expect(page.locator('.task-row', { hasText: '只在四象限' })).toBeVisible();
  await expect(page.getByRole('article', { name: '任务：只在四象限' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.task-row', { hasText: '只在四象限' })).toBeVisible();
  await expect(page.getByRole('article', { name: '任务：只在四象限' })).toHaveCount(0);
});

test('saves a step still in the input when creating from the kanban toolbar', async ({ page }) => {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.getByLabel('任务标题').fill('整理周报');
  await dialog.getByRole('textbox', { name: '新步骤' }).fill('收集数据');
  await dialog.getByRole('button', { name: '保存任务' }).click();
  await expect(page.getByRole('article', { name: '任务：整理周报' }).locator('.task-step-count')).toContainText('0/1');
});
