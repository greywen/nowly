import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly.language', 'zh');
    localStorage.setItem('nowly:onboarding-seen', 'true');
    localStorage.setItem('nowly:browser-backend', JSON.stringify({
      alarmFormatVersion: 1,
      moduleLayout: [
        { id: 'kanban', x: 0, y: 0, w: 6, h: 8 },
        { id: 'matrix', x: 6, y: 0, w: 6, h: 8 }
      ],
      kanban: {
        lanes: [{ id: 'lane-todo', name: '待处理', color: '#4FC9DA', position: 0, createdAt: 'x', updatedAt: 'x' }],
        cards: [], priorities: [], tags: []
      },
      tasks: [{
        id: 'matrix-click', title: '整卡交互验证', description: '', priority: 'important_urgent',
        dueDate: '2026-11-23', completed: false, completedAt: null, laneId: null,
        boardPosition: 0, tagIds: [], steps: [{ id: 's1', title: '核对', completed: false }],
        createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z'
      }]
    }));
  });
  await page.goto('/');
  await expect(page.locator('.task-row', { hasText: '整卡交互验证' })).toBeVisible();
});

test('opens from padding, metadata and step count, restores focus, and isolates completion', async ({ page }) => {
  const row = page.locator('.task-row', { hasText: '整卡交互验证' });
  const title = row.getByRole('button', { name: '编辑任务：整卡交互验证' });
  const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });

  await row.click({ position: { x: 3, y: 3 } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('任务标题')).toHaveValue('整卡交互验证');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(title).toBeFocused();

  for (const selector of ['.task-row__meta', '.task-step-count']) {
    await row.locator(selector).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(title).toBeFocused();
  }
  await title.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await title.press('Space');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');

  await row.locator('.task-row__check').click();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(dialog).toBeHidden();
  await row.getByRole('checkbox').uncheck();
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog).toBeHidden();
});

test('drags from the title to another quadrant and from padding into the board without opening', async ({ page }) => {
  const row = page.locator('.task-row', { hasText: '整卡交互验证' });
  const title = row.getByRole('button', { name: '编辑任务：整卡交互验证' });
  const quadrant = page.getByRole('region', { name: '重要不紧急', exact: true });
  const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });

  // Real mouse movement exercises native drag activation and the release click.
  await title.dragTo(quadrant);
  await expect(quadrant.locator('.task-row')).toContainText('整卡交互验证');
  await expect(dialog).toBeHidden();
  await row.click({ position: { x: 3, y: 3 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');

  await row.dragTo(page.getByRole('region', { name: '泳道：待处理' }), {
    sourcePosition: { x: 3, y: 3 }
  });
  await expect(page.getByRole('article', { name: '任务：整卡交互验证' })).toBeVisible();
  await expect(row.locator('.task-lane-chip')).toContainText('待处理');
  await expect(dialog).toBeHidden();
  await row.locator('.task-lane-chip').click();
  await expect(dialog).toBeVisible();
});

test('keeps a same-quadrant drop and Escape cancellation out of the editor', async ({ page }) => {
  const row = page.locator('.task-row', { hasText: '整卡交互验证' });
  const quadrant = page.getByRole('region', { name: '重要且紧急', exact: true });
  const dialog = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await row.dragTo(quadrant, { sourcePosition: { x: 3, y: 3 } });
  await expect(quadrant.locator('.task-row')).toContainText('整卡交互验证');
  await expect(dialog).toBeHidden();

  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height + 20, { steps: 5 });
  await expect(row).toHaveClass(/task-row--dragging/);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(row).not.toHaveClass(/task-row--dragging/);
  await expect(dialog).toBeHidden();
  await row.getByRole('button', { name: '编辑任务：整卡交互验证' }).press('Enter');
  await expect(dialog).toBeVisible();
});
