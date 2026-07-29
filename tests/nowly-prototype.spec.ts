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

test('uses the authoritative Good design tokens without legacy effects', async () => {
  const html = await readFile(prototypePath, 'utf8');
  const normalized = html.toLowerCase();

  for (const token of ['#4fc9da', '#30a6b6', '#f8f6f2', '#f6f1e9', '#211f1c', '#716d66', '#968e7e', '#eaeaea']) {
    expect(normalized).toContain(token);
  }
  for (const legacy of ['#009ef7', '#181c32', '#7e8299', 'backdrop-filter', 'radial-gradient', 'linear-gradient']) {
    expect(normalized).not.toContain(legacy);
  }
  expect(normalized).not.toContain('data-action="toggle-theme"');
  expect(normalized).not.toContain('桌面融合');
});

test('applies Good card, button, and typography rules', async ({ page }) => {
  await loadPrototype(page);
  const styles = await page.evaluate(() => {
    const card = getComputedStyle(document.querySelector('.card')!);
    const primary = getComputedStyle(document.querySelector('.btn-primary')!);
    const body = getComputedStyle(document.body);
    return {
      cardBackground: card.backgroundColor,
      cardBorder: card.borderColor,
      cardRadius: card.borderRadius,
      cardShadow: card.boxShadow,
      buttonBackground: primary.backgroundColor,
      buttonRadius: primary.borderRadius,
      bodyBackground: body.backgroundColor,
      bodyFontSize: body.fontSize,
      bodyLineHeight: body.lineHeight
    };
  });
  expect(styles).toEqual({
    cardBackground: 'rgb(255, 255, 255)',
    cardBorder: 'rgb(234, 234, 234)',
    cardRadius: '15.2px',
    cardShadow: 'none',
    buttonBackground: 'rgb(79, 201, 218)',
    buttonRadius: '15.2px',
    bodyBackground: 'rgb(248, 246, 242)',
    bodyFontSize: '16px',
    bodyLineHeight: '24px'
  });
});

test('stacks events vertically inside the current-day cell', async ({ page }) => {
  await loadPrototype(page);
  const layout = await page.locator('[data-calendar-day][aria-current="date"]').evaluate((element) => {
    const events = [...element.querySelectorAll('.event')].map((event) => event.getBoundingClientRect());
    return {
      display: getComputedStyle(element).display,
      eventTops: events.map((event) => event.top),
      eventWidths: events.map((event) => event.width),
      cellWidth: element.getBoundingClientRect().width
    };
  });
  expect(layout.display).toBe('block');
  expect(new Set(layout.eventTops).size).toBe(layout.eventTops.length);
  expect(layout.eventWidths.every((width) => width > layout.cellWidth * 0.8)).toBe(true);
});

test('keeps visible interface text at or above 13.6px', async ({ page }) => {
  await loadPrototype(page);
  const undersized = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const hasDirectText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      return hasDirectText && node.offsetParent !== null && parseFloat(style.fontSize) < 13.6 && !node.classList.contains('sr-only');
    })
    .map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim() })));
  expect(undersized).toEqual([]);
});

test('globally disables motion and smooth scrolling', async ({ page }) => {
  await loadPrototype(page);
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.btn')!);
    return {
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
    };
  });
  expect(values).toEqual({ animationName: 'none', transitionDuration: '0s', scrollBehavior: 'auto' });
});

for (const viewport of [
  { name: 'minimum', width: 1366, height: 768 },
  { name: 'standard', width: 1920, height: 1080 },
  { name: 'large', width: 2560, height: 1440 },
  { name: 'ultra-wide', width: 5120, height: 1440 },
  { name: 'ultra-tall', width: 2560, height: 2880 }
]) {
  test(`fills the viewport without page overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPrototype(page);
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell')!.getBoundingClientRect();
      const workspace = document.querySelector('.workspace')!.getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        shellWidth: shell.width,
        shellHeight: shell.height,
        workspaceRightGap: innerWidth - workspace.right
      };
    });
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.shellWidth).toBe(metrics.viewportWidth);
    expect(metrics.shellHeight).toBe(metrics.viewportHeight);
    expect(metrics.workspaceRightGap).toBeLessThanOrEqual(36);
  });
}

test('does not cap the content width or height', async ({ page }) => {
  await page.setViewportSize({ width: 5120, height: 2880 });
  await loadPrototype(page);
  const values = await page.evaluate(() => {
    const inner = getComputedStyle(document.querySelector('.app-shell__inner')!);
    return { maxWidth: inner.maxWidth, maxHeight: inner.maxHeight };
  });
  expect(values).toEqual({ maxWidth: 'none', maxHeight: 'none' });
});

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

test('uses Good Custom Solid structure for every checkbox and radio', async ({ page }) => {
  await loadPrototype(page);
  const inputs = page.locator('input[type="checkbox"], input[type="radio"]');
  expect(await inputs.count()).toBeGreaterThan(0);
  const invalid = await inputs.evaluateAll((elements) => elements.filter((element) => {
    const wrapper = element.closest('.form-check');
    return !element.classList.contains('form-check-input') ||
      !wrapper?.classList.contains('form-check-custom') ||
      !wrapper.classList.contains('form-check-solid');
  }).length);
  expect(invalid).toBe(0);
});

test('renders Good solid checkbox states', async ({ page }) => {
  await loadPrototype(page);
  const checkbox = page.getByLabel('完成任务：发布 Nowly v0.1');
  const unchecked = await checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.width, height: style.height, background: style.backgroundColor, border: style.borderWidth, radius: style.borderRadius };
  });
  expect(unchecked).toEqual({ width: '28px', height: '28px', background: 'rgb(218, 211, 195)', border: '0px', radius: '7.2px' });
  await checkbox.check();
  const checked = await checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, image: style.backgroundImage };
  });
  expect(checked.background).toBe('rgb(79, 201, 218)');
  expect(checked.image).toContain('data:image/svg+xml');
});

test('removes the browser fieldset border around Good radio groups', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  const border = await page.getByRole('group', { name: '所属象限' }).evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(border).toBe('0px');
});

test('renders Good solid radio states', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  const radio = page.getByRole('radio', { name: '重要且紧急' });
  const style = await radio.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { width: computed.width, height: computed.height, background: computed.backgroundColor, radius: computed.borderRadius, image: computed.backgroundImage };
  });
  expect(style.width).toBe('28px');
  expect(style.height).toBe('28px');
  expect(style.background).toBe('rgb(79, 201, 218)');
  expect(style.radius).toBe('50%');
  expect(style.image).toContain('data:image/svg+xml');
});

test('replaces native date inputs with two Good date picker triggers', async ({ page }) => {
  await loadPrototype(page);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const eventDate = page.getByRole('button', { name: '日期' });
  await expect(eventDate).toContainText('2026 年 7 月 23 日');
  await expect(eventDate).toHaveAttribute('data-date-picker', '');
  await expect(eventDate).toHaveAttribute('aria-haspopup', 'dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  await expect(page.getByRole('button', { name: '截止日期' })).toContainText('2026 年 7 月 23 日');
});

test('opens one shared Good single-date popup with a 42-day grid', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  await page.getByRole('button', { name: '日期' }).click();
  const picker = page.getByRole('dialog', { name: '选择日期' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('columnheader')).toHaveCount(7);
  await expect(picker.locator('[data-date-cell]')).toHaveCount(42);
  await expect(picker.getByRole('gridcell', { name: '2026年7月23日' })).toHaveAttribute('aria-selected', 'true');
});

test('selects a date, closes the picker, and restores trigger focus', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const trigger = page.getByRole('button', { name: '日期' });
  await trigger.click();
  await page.getByRole('dialog', { name: '选择日期' }).getByRole('gridcell', { name: '2026年7月24日' }).click();
  await expect(trigger).toContainText('2026 年 7 月 24 日');
  await expect(trigger).toHaveAttribute('data-value', '2026-07-24');
  await expect(page.getByRole('dialog', { name: '选择日期' })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('keeps the date picker below the business dialog header', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  await page.getByRole('button', { name: '截止日期' }).click();
  const positions = await page.evaluate(() => {
    const picker = document.querySelector('.date-picker-popup')!.getBoundingClientRect();
    const header = document.querySelector('[data-dialog="task"] .dialog-header')!.getBoundingClientRect();
    return { pickerTop: picker.top, headerBottom: header.bottom };
  });
  expect(positions.pickerTop).toBeGreaterThanOrEqual(positions.headerBottom);
});

test('supports date picker month, today, clear, escape, and keyboard selection', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const trigger = page.getByRole('button', { name: '日期' });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: '选择日期' });
  await picker.getByRole('button', { name: '下一个月' }).click();
  await expect(picker).toContainText('2026 年 8 月');
  await picker.getByRole('button', { name: '今天' }).click();
  await expect(trigger).toHaveAttribute('data-value', '2026-07-23');
  await trigger.click();
  await picker.getByRole('button', { name: '清除' }).click();
  await expect(trigger).toContainText('选择日期');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await trigger.click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('data-value', '2026-07-24');
});

test('replaces native time inputs with two Good time picker triggers', async ({ page }) => {
  await loadPrototype(page);
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const start = page.getByRole('button', { name: '开始时间' });
  const end = page.getByRole('button', { name: '结束时间' });
  await expect(start).toHaveAttribute('data-value', '14:00');
  await expect(end).toHaveAttribute('data-value', '15:00');
  await expect(start).toHaveAttribute('aria-haspopup', 'dialog');
});

test('opens one shared Good time popup with spinbuttons and quick values', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  await page.getByRole('button', { name: '开始时间' }).click();
  const picker = page.getByRole('dialog', { name: '选择时间' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('spinbutton', { name: '小时' })).toHaveAttribute('aria-valuenow', '14');
  await expect(picker.getByRole('spinbutton', { name: '分钟' })).toHaveAttribute('aria-valuenow', '0');
  for (const value of ['09:00','09:30','12:00','14:00','15:00','18:00']) await expect(picker.getByRole('button', { name: value })).toBeVisible();
});

test('adjusts and selects Good time picker values', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const start = page.getByRole('button', { name: '开始时间' });
  await start.click();
  const picker = page.getByRole('dialog', { name: '选择时间' });
  await picker.getByRole('button', { name: '增加小时' }).click();
  await picker.getByRole('button', { name: '增加分钟' }).click();
  await expect(picker.getByRole('spinbutton', { name: '小时' })).toHaveText('15');
  await expect(picker.getByRole('spinbutton', { name: '分钟' })).toHaveText('05');
  await picker.getByRole('button', { name: '18:00' }).click();
  await expect(start).toHaveAttribute('data-value', '18:00');
  await start.click();
  await picker.getByRole('button', { name: '清除' }).click();
  await expect(start).toContainText('选择时间');
  await start.click();
  await picker.getByRole('button', { name: '现在' }).click();
  await expect(start).toHaveAttribute('data-value', '09:40');
});

test('keeps the time picker inside the business dialog safe area', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  await page.getByRole('button', { name: '开始时间' }).click();
  const positions = await page.evaluate(() => {
    const popup = document.querySelector('.time-picker-popup')!.getBoundingClientRect();
    const dialog = document.querySelector('[data-dialog="event"]')!.getBoundingClientRect();
    const header = document.querySelector('[data-dialog="event"] .dialog-header')!.getBoundingClientRect();
    return { popupTop: popup.top, popupBottom: popup.bottom, dialogBottom: dialog.bottom, headerBottom: header.bottom };
  });
  expect(positions.popupTop).toBeGreaterThanOrEqual(positions.headerBottom);
  expect(positions.popupBottom).toBeLessThanOrEqual(positions.dialogBottom - 12);
});

test('supports time picker keyboard controls and popup mutual exclusion', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const start = page.getByRole('button', { name: '开始时间' });
  await start.click();
  const picker = page.getByRole('dialog', { name: '选择时间' });
  const hour = picker.getByRole('spinbutton', { name: '小时' });
  await hour.press('ArrowUp');
  await expect(hour).toHaveText('15');
  await hour.press('PageDown');
  await expect(hour).toHaveText('09');
  await hour.press('Home');
  await expect(hour).toHaveText('00');
  await hour.press('End');
  await expect(hour).toHaveText('23');
  await hour.press('Enter');
  await expect(start).toHaveAttribute('data-value', '23:00');
  await start.click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(start).toBeFocused();
  await page.getByRole('button', { name: '日期' }).click();
  await expect(page.getByRole('dialog', { name: '选择日期' })).toBeVisible();
  await start.focus();
  await start.press('Enter');
  await expect(page.getByRole('dialog', { name: '选择日期' })).toBeHidden();
  await expect(picker).toBeVisible();
});

test('dialog forms expose approved fields and actions', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '14:00 设计评审' }).click();
  const eventDialog = page.getByRole('dialog', { name: '编辑日程' });
  await expect(eventDialog.getByLabel('日程标题')).toHaveValue('设计评审');
  await expect(eventDialog.getByRole('button', { name: '日期' })).toHaveAttribute('data-value', '2026-07-23');
  await expect(eventDialog.getByRole('button', { name: '开始时间' })).toHaveAttribute('data-value', '14:00');
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
  await page.getByRole('button', { name: '展开原型控制器' }).click();
  await page.getByRole('button', { name: '重置演示状态' }).click();
  await expect(task).not.toBeChecked();
  await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
  await expect(page.getByText('演示状态已重置')).toHaveText('演示状态已重置');
  await expect(page.getByRole('button', { name: '展开原型控制器' })).toBeVisible();
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

test('settings categories switch accessible tab panels', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const modulesTab = page.getByRole('tab', { name: '模块显示' });
  await modulesTab.click();
  await expect(modulesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '模块显示' })).toBeVisible();
  await expect(page.getByText('日历模块')).toBeVisible();
});

test('settings uses static Good appearance options', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog.getByLabel('信息密度')).toBeVisible();
  await expect(dialog.getByLabel('周起始日')).toBeVisible();
  await expect(dialog.getByLabel('日期格式')).toBeVisible();
  await expect(dialog.getByLabel('显示周末')).toBeVisible();
  await expect(dialog.getByText('背景模式')).toHaveCount(0);
  await expect(dialog.getByText('卡片透明度')).toHaveCount(0);
});

test('dialogs use the Good modal surface', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const values = await page.getByRole('dialog', { name: '设置' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, shadow: style.boxShadow };
  });
  expect(values.background).toBe('rgb(255, 255, 255)');
  expect(values.border).toBe('rgb(234, 234, 234)');
  expect(values.radius).toBe('15.2px');
  expect(values.shadow).not.toBe('none');
});

test('traps keyboard focus inside an open dialog', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  const last = dialog.getByRole('button', { name: '保存设置' });
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('button, input, textarea, select').first()).toBeFocused();
});
