import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const prototypePath = resolve(process.cwd(), 'docs/prototypes/nowly-final-uiux.html');

async function loadPrototype(page: Page) {
  const html = await readFile(prototypePath, 'utf8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

test('renders the complete single-screen Nowly shell', async ({ page }) => {
  await loadPrototype(page);
  await expect(page).toHaveTitle('Nowly · 最终 UI/UX 原型');
  await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  await expect(page.getByText('今天有 3 个日程 · 2 个重要任务 · 2 条便签')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-grid"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="quadrant-grid"]')).toHaveCount(1);
});

test('shows balanced-density calendar, quadrant, and note content', async ({ page }) => {
  await loadPrototype(page);
  await expect(page.locator('[data-calendar-day]')).toHaveCount(35);
  await expect(page.locator('[data-calendar-day][aria-current="date"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /14:00 设计评审/ })).toBeVisible();
  await expect(page.locator('[data-quadrant]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' })).toBeVisible();
  await expect(page.locator('[data-note-card]')).toHaveCount(2);
  await expect(page.getByText('产品原则')).toBeVisible();
});

test('uses inline icon symbols instead of emoji function icons', async ({ page }) => {
  await loadPrototype(page);
  expect(await page.locator('svg[aria-hidden="true"] use').count()).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText(/📅|✅|📝|⚙️|📌/);
});

test('switches between light and desktop blend modes', async ({ page }) => {
  await loadPrototype(page);
  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换到桌面融合模式' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'desktop');
  await expect(page.getByRole('button', { name: '切换到浅色渐变模式' })).toBeVisible();
});

for (const viewport of [
  { name: 'compact', width: 1366, height: 768 },
  { name: 'standard', width: 1920, height: 1080 },
  { name: 'large', width: 2560, height: 1440 }
]) {
  test(`has no page overflow at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPrototype(page);
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  });
}

test('opens all five dialogs from primary interface entry points', async ({ page }) => {
  await loadPrototype(page);
  const cases = [
    { trigger: '2026年7月23日，星期四', dialog: '7 月 23 日 · 星期四' },
    { trigger: '14:00 设计评审', dialog: '编辑日程' },
    { trigger: '编辑任务：发布 Nowly v0.1', dialog: '编辑任务' },
    { trigger: '编辑便签：产品原则', dialog: '编辑便签' },
    { trigger: '打开设置', dialog: '设置' }
  ];
  for (const item of cases) {
    await page.getByRole('button', { name: item.trigger }).first().click();
    const dialog = page.getByRole('dialog', { name: item.dialog });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('button, input, textarea, select').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

test('moves from date details to event editor and restores trigger focus', async ({ page }) => {
  await loadPrototype(page);
  const date = page.getByRole('button', { name: '2026年7月23日，星期四' });
  await date.click();
  const detail = page.getByRole('dialog', { name: '7 月 23 日 · 星期四' });
  await detail.getByRole('button', { name: '14:00 设计评审' }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(date).toBeFocused();
});

test('dialog forms expose approved fields and actions', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const eventDialog = page.getByRole('dialog', { name: '编辑日程' });
  await expect(eventDialog.getByLabel('日程标题')).toHaveValue('设计评审');
  await expect(eventDialog.getByLabel('开始时间')).toHaveValue('14:00');
  await expect(eventDialog.getByRole('button', { name: '保存日程' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  const taskDialog = page.getByRole('dialog', { name: '编辑任务' });
  await expect(taskDialog.getByRole('radio', { name: '重要且紧急' })).toBeChecked();
  await expect(taskDialog.getByRole('button', { name: '保存任务' })).toBeVisible();
});

test('toggles task completion and resets presentation state', async ({ page }) => {
  await loadPrototype(page);
  const task = page.getByLabel('完成任务：发布 Nowly v0.1');
  await task.check();
  await expect(task.locator('xpath=ancestor::*[@data-task-row]')).toHaveClass(/is-complete/);
  await page.getByRole('button', { name: '切换到桌面融合模式' }).click();
  await page.getByRole('button', { name: '展开原型控制器' }).click();
  await page.getByRole('button', { name: '重置演示状态' }).click();
  await expect(task).not.toBeChecked();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
});

test('prototype controller opens every dialog directly', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '展开原型控制器' }).click();
  for (const item of [
    ['预览日期详情', '7 月 23 日 · 星期四'],
    ['预览日程编辑', '编辑日程'],
    ['预览任务编辑', '编辑任务'],
    ['预览便签编辑', '编辑便签'],
    ['预览设置', '设置']
  ]) {
    await page.getByRole('button', { name: item[0] }).click();
    await expect(page.getByRole('dialog', { name: item[1] })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('calendar controls provide presentation month feedback', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '下一个月' }).click();
  await expect(page.getByRole('heading', { name: '2026 年 8 月' })).toBeVisible();
  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
});
