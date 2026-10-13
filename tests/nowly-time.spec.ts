import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Alarm, AlarmNotice, ClockMode, WorldClock } from '../src/time/time-model';

const storageKey = 'nowly:browser-backend';
test.setTimeout(60_000);
test.use({ timezoneId: 'UTC' });
const clock = (id: string, mode: ClockMode = 'digital', timeZone = 'UTC'): WorldClock => ({
  id, label: `城市 ${id}`, timeZone, mode, hourCycle: 'h23', showSeconds: false,
  showLabel: false, showDate: false, showDifference: false
});

type Fixture = {
  clocks?: WorldClock[];
  density?: string;
  rect?: { w: number; h: number };
  alarmNotices?: AlarmNotice[];
};

async function boot(page: Page, fixture: Fixture = {}, bar = false) {
  await page.addInitScript(({ key, fixture }) => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    localStorage.setItem('nowly.language', 'zh');
    // Do not reset persisted edits when the page reloads.
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      settings: { wallpaperEnabled: false, density: fixture.density ?? 'balanced' },
      moduleLayout: [{ id: 'time', x: 0, y: 0, w: fixture.rect?.w ?? 4, h: fixture.rect?.h ?? 3 }],
      timeSettings: { clocks: fixture.clocks }, alarms: [], alarmNotices: fixture.alarmNotices ?? []
    }));
  }, { key: storageKey, fixture: { ...fixture, clocks: fixture.clocks ?? [clock('local', 'digital', 'local')] } });
  if (bar) {
    // Keep the actual browser backend, changing only the native window identity.
    await page.route('**/src/main.tsx*', async route => {
      const response = await route.fetch();
      const original = await response.text();
      const body = original.replace(/\b(?:const|let|var) browserOnly\s*=/,
        `installBrowserTauriBackend();
        const ipc = window.__TAURI_INTERNALS__;
        ipc.metadata = { currentWindow: { label: 'quick-panel-handle' }, currentWebview: { label: 'quick-panel-handle' } };
        const browserInvoke = ipc.invoke;
        let generation = 0;
        ipc.invoke = async (command, args = {}) => {
          if (command === 'set_status_island_primary' || command === 'set_status_island_presence') return;
          if (command === 'toggle_status_island_details') return browserInvoke('plugin:event|emit', {
            event: 'status-island-details-open', payload: { generation: ++generation, source: 'island', identity: args.identity, hovered: false }
          });
          return browserInvoke(command, args);
        };
        const browserOnly =`);
      expect(body, 'Bar fixture must install before window routing').not.toBe(original);
      await route.fulfill({ response, body });
    });
  }
  await page.goto('/', { waitUntil: 'commit' });
  // Navigation commit precedes Vite's module graph and the initial IPC load.
  // Establish the real surface readiness before testing widget behavior.
  await expect(bar ? page.getByRole('main', { name: 'Nowly Bar', exact: true }) : page.getByRole('button', { name: '打开设置', exact: true }))
    .toBeVisible({ timeout: 45_000 });
}

async function stored(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey) as Promise<{
    timeSettings: { clocks: WorldClock[] }; alarms: Alarm[]; alarmNotices: AlarmNotice[];
  }>;
}

async function openTimeSettings(page: Page) {
  await page.getByTestId('time-widget').getByRole('button', { name: '时间设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '时间设置', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.time-clock-settings-card')).toHaveCount((await stored(page)).timeSettings.clocks.length);
  return dialog;
}

async function select(card: Locator, name: string, option: string) {
  await card.getByRole('combobox', { name, exact: true }).click();
  await card.getByRole('option', { name: option, exact: true }).click();
}

async function saveClocks(dialog: Locator) {
  await expect(dialog.getByRole('button', { name: '保存时间设置', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('已保存');
}

for (const mode of ['digital', 'analog', 'mixed'] as const) {
  test(`pure ${mode} hides optional information and exposes the module add icon`, async ({ page }) => {
    await boot(page, { clocks: [clock('东京', mode, 'Asia/Tokyo')] });
    const widget = page.getByTestId('time-widget');
    await expect(widget).toHaveAttribute('data-clock-count', '1');
    const tile = widget.getByTestId('time-clock');
    await expect(tile).toHaveAttribute('data-clock-mode', mode);
    await expect(tile).toHaveAccessibleName(/城市 东京 \d{2}:\d{2}/);
    await expect(widget.getByTestId('time-clock-digital')).toHaveCount(mode === 'analog' ? 0 : 1);
    await expect(widget.getByTestId('time-clock-face')).toHaveCount(mode === 'digital' ? 0 : 1);
    await expect(widget.locator('.time-clock__label, .time-clock__meta')).toHaveCount(0);
    await expect(widget.getByRole('button')).toHaveCount(2);
    await expect(widget.getByRole('button', { name: '时间设置', exact: true })).toBeVisible();
    const add = widget.getByRole('button', { name: '添加闹钟', exact: true });
    await expect(add).toHaveCSS('background-color', 'rgb(248, 246, 242)');
    await expect(add).toHaveCSS('width', '40px');
    await expect(add).toHaveCSS('height', '40px');
    await expect(add.locator('svg')).toHaveCSS('width', '18px');
    await add.hover();
    await expect(add).toHaveCSS('background-color', 'rgb(246, 241, 233)');
    await expect(widget.getByRole('tab')).toHaveCount(0);
    if (mode !== 'analog') {
      await expect(widget.getByTestId('time-clock-digital')).toHaveText(/^\d{2}:\d{2}$/);
      await expect(widget.getByTestId('time-clock-digital')).toHaveCSS('font-variant-numeric', 'tabular-nums');
    }
    if (mode !== 'digital') {
      const hand = widget.locator('.time-clock-face__hand--minute');
      await expect(hand).toHaveCSS('transition-duration', '0s');
      await expect(hand).toHaveCSS('animation-name', 'none');
    }
  });
}

test('multiple clocks remain readable at 2x2, 4x3, wide and short sizes in every density', async ({ page }) => {
  test.setTimeout(90_000);
  const rectangles = [{ w: 2, h: 2 }, { w: 4, h: 3 }, { w: 10, h: 3 }, { w: 6, h: 2 }];
  await boot(page);
  for (const density of ['compact', 'balanced', 'comfortable']) {
    for (const rect of rectangles) {
      await page.evaluate(({ key, density, rect, clocks }) => {
        const fixture = JSON.parse(localStorage.getItem(key)!);
        localStorage.setItem(key, JSON.stringify({ ...fixture, settings: { ...fixture.settings, density },
          moduleLayout: [{ id: 'time', x: 0, y: 0, ...rect }], timeSettings: { clocks } }));
      }, { key: storageKey, density, rect, clocks: [clock('UTC', 'digital'), clock('Tokyo', 'analog', 'Asia/Tokyo'), clock('Kathmandu', 'mixed', 'Asia/Kathmandu'), clock('NewYork', 'mixed', 'America/New_York')].map(item => ({ ...item, showLabel: true, showDate: true, showDifference: true })) });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const widget = page.getByTestId('time-widget');
      await expect(widget).toHaveAttribute('data-clock-count', '4');
      await expect(widget.getByTestId('time-clock')).toHaveCount(4);
      await expect.soft.poll(() => widget.evaluate(element => {
        const tiles = [...element.querySelectorAll('.time-clock')];
        const errors: string[] = [];
        const body = element.querySelector('[data-testid="time-widget-body"]')!;
        const viewport = body.getBoundingClientRect();
        const scrolls = getComputedStyle(body).overflowY === 'auto';
        for (const tile of tiles) {
          const bounds = tile.getBoundingClientRect();
          if (bounds.left < viewport.left - 1 || bounds.right > viewport.right + 1) errors.push('horizontal clipping');
          if (!scrolls && (bounds.top < viewport.top - 1 || bounds.bottom > viewport.bottom + 1)) errors.push('vertical clipping without body scrolling');
          for (const content of tile.querySelectorAll('.time-clock-face, .time-clock__time')) {
            const box = content.getBoundingClientRect();
            if (box.left < bounds.left - 1 || box.right > bounds.right + 1) errors.push(`${content.className}: content ${Math.round(box.width)}px outside ${Math.round(bounds.width)}px tile`);
            if (content.scrollWidth > content.clientWidth + 1) errors.push('truncated time');
            if (content.classList.contains('time-clock__time') && parseFloat(getComputedStyle(content).fontSize) < 13.6) errors.push('unreadable type');
          }
        }
        for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i].getBoundingClientRect(), b = tiles[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) errors.push('overlapping tiles');
        }
        return errors;
      }), { message: `${density} ${rect.w}x${rect.h}` }).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }
});

test('clock settings add, reorder, remove, save dynamically and survive reload', async ({ page }) => {
  await boot(page);
  const dialog = await openTimeSettings(page);
  const cards = dialog.locator('.time-clock-settings-card');
  await expect(cards.first().getByRole('button', { name: /^删除/ })).toBeDisabled();
  await dialog.getByRole('button', { name: '添加时钟', exact: true }).click();
  await cards.nth(1).getByRole('textbox', { name: '显示名称', exact: true }).fill('伦敦');
  await cards.nth(1).getByRole('combobox', { name: '时区', exact: true }).click();
  await cards.nth(1).getByRole('searchbox', { name: '搜索时区', exact: true }).fill('伦敦');
  await cards.nth(1).getByRole('option', { name: '伦敦', exact: true }).click();
  await select(cards.nth(1), '显示模式', '混合');
  await cards.nth(1).locator('summary').click();
  await select(cards.nth(1), '小时制', '12 小时');
  await cards.nth(1).getByRole('checkbox', { name: '显示秒', exact: true }).check();
  await cards.nth(1).getByRole('checkbox', { name: '显示城市', exact: true }).check();
  await cards.nth(1).getByRole('button', { name: '上移 伦敦', exact: true }).click();
  await saveClocks(dialog);
  await expect(page.getByTestId('time-widget')).toHaveAttribute('data-clock-count', '2');
  await expect(page.getByTestId('time-clock').first()).toHaveAttribute('data-time-zone', 'Europe/London');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const widget = page.getByTestId('time-widget');
  await expect(widget).toHaveAttribute('data-clock-count', '2');
  await expect(widget.getByTestId('time-clock-digital').first()).toHaveText(/\d{1,2}:\d{2}:\d{2} (AM|PM)/);
  const reopened = await openTimeSettings(page);
  await reopened.locator('.time-clock-settings-card').nth(1).getByRole('button', { name: /^删除/ }).click();
  await saveClocks(reopened);
  await expect(widget).toHaveAttribute('data-clock-count', '1');
  await page.reload();
  await expect(widget.getByTestId('time-clock').first()).toHaveAttribute('data-time-zone', 'Europe/London');
  expect((await stored(page)).timeSettings.clocks).toHaveLength(1);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '时间设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '时间设置', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '显示名称', exact: true })).toHaveValue('伦敦');
});

test('clock appearance controls persist stacked manual sizing and date layout', async ({ page }) => {
  await boot(page, { rect: { w: 6, h: 5 } });
  const dialog = await openTimeSettings(page);
  const card = dialog.locator('.time-clock-settings-card').first();
  await select(card, '布局', '上下排列');
  await select(card, '字号模式', '手动字号');
  await card.getByRole('slider').fill('128');
  await expect(page.getByTestId('time-clock')).toHaveAttribute('data-clock-layout', 'stacked');
  await expect(page.getByTestId('time-clock-digital').locator('span')).toHaveCount(2);
  await expect(dialog).toBeVisible();
  await saveClocks(dialog);
  expect((await stored(page)).timeSettings.clocks[0]).toMatchObject({ layout: 'stacked', fontMode: 'manual', fontSize: 128 });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const reopened = await openTimeSettings(page);
  const savedCard = reopened.locator('.time-clock-settings-card').first();
  await expect(savedCard.getByRole('slider')).toHaveValue('128');
  await select(savedCard, '布局', '时间与日期');
  await saveClocks(reopened);
  expect((await stored(page)).timeSettings.clocks[0].layout).toBe('date');
});

test('module add icon opens a new alarm and enabled indicators update immediately', async ({ page }) => {
  await boot(page);
  const widget = page.getByTestId('time-widget');
  const add = widget.getByRole('button', { name: '添加闹钟', exact: true });
  await add.click();
  const dialog = page.getByRole('dialog', { name: '时间设置', exact: true });
  await expect(dialog.getByRole('tab', { name: /^闹钟/ })).toHaveAttribute('aria-selected', 'true');
  const editor = dialog.locator('.time-alarm-editor');
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('晨间提醒');
  await editor.getByRole('textbox', { name: '小时', exact: true }).fill('');
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(editor).toContainText('小时必须是 0 到 23');
  expect((await stored(page)).alarms).toEqual([]);
  await editor.getByRole('textbox', { name: '小时', exact: true }).fill('9');
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(dialog.locator('.time-alarm-row')).toHaveCount(1);
  await expect(widget.locator('.time-widget__alarm')).toBeVisible();
  await dialog.locator('.time-alarm-row').getByRole('checkbox').uncheck();
  await expect(widget.locator('.time-widget__alarm')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(add).toBeFocused();
});

test('time comparison converts a local instant without changing saved clocks', async ({ page }) => {
  await boot(page, { clocks: [clock('UTC'), clock('Kathmandu', 'mixed', 'Asia/Kathmandu')] });
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('tab', { name: '时差对照', exact: true }).click();
  const input = dialog.getByLabel('本地日期时间', { exact: true });
  await input.fill('2026-01-15T23:30');
  await expect(dialog.locator('.time-comparison-row')).toHaveCount(2);
  await expect(dialog.locator('.time-comparison-row').first()).toContainText('23:30');
  await expect(dialog.locator('.time-comparison-row').nth(1)).toContainText('05:15');
  await expect(dialog.locator('.time-comparison-row').nth(1)).toContainText('2026-01-16');
  await expect(dialog).toContainText('UTC+05:45');
  expect((await stored(page)).timeSettings.clocks.map(item => item.timeZone)).toEqual(['UTC', 'Asia/Kathmandu']);
  await dialog.getByRole('button', { name: '回到现在', exact: true }).click();
  await expect(input).not.toHaveValue('2026-01-15T23:30');
});

test('local alarms support all repeat rules, editing, disable, delete and reload independently of calendar', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2099-01-14T08:00:00Z'));
  await boot(page);
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('tab', { name: /^闹钟/ }).click();
  for (const repeat of ['一次', '每天', '工作日', '自选星期']) {
    await dialog.getByRole('button', { name: '添加闹钟', exact: true }).click();
    const editor = dialog.locator('.time-alarm-editor');
    await editor.getByRole('textbox', { name: '标题', exact: true }).fill(`测试${repeat}`);
    await editor.getByRole('textbox', { name: '小时', exact: true }).fill('10');
    await editor.getByRole('textbox', { name: '分钟', exact: true }).fill('15');
    await select(editor, '重复', repeat);
    if (repeat === '一次') {
      await editor.getByRole('button', { name: '日期', exact: true }).click();
      await editor.locator('[data-date="2099-01-15"]').click();
    }
    if (repeat === '自选星期') {
      for (const day of ['周二', '周三', '周四', '周五']) await editor.getByRole('checkbox', { name: day, exact: true }).uncheck();
      await editor.getByRole('checkbox', { name: '周六', exact: true }).check();
    }
    await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
    await expect(editor.getByRole('button', { name: '结束编辑', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '结束编辑', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await expect(dialog.locator('.time-alarm-row')).toHaveCount(4);
  const repeats = (await stored(page)).alarms.map(alarm => alarm.repeat);
  expect(repeats).toEqual([{ kind: 'once', date: '2099-01-15' }, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] }, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, { kind: 'weekly', weekdays: [1, 6] }]);
  const daily = dialog.locator('.time-alarm-row').filter({ hasText: '测试每天' });
  await daily.getByRole('checkbox').uncheck();
  await expect.poll(async () => (await stored(page)).alarms.find(item => item.title === '测试每天')?.enabled).toBe(false);
  await daily.getByRole('button', { name: '编辑 测试每天', exact: true }).click();
  await dialog.locator('.time-alarm-editor').getByRole('textbox', { name: '标题', exact: true }).fill('修改每天');
  await expect.poll(async () => (await stored(page)).alarms.some(item => item.title === '修改每天')).toBe(true);
  await dialog.getByRole('button', { name: '结束编辑', exact: true }).click();
  const deleteButton = dialog.getByRole('button', { name: '删除 测试工作日', exact: true });
  await deleteButton.click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.locator('.time-alarm-row')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: '添加闹钟', exact: true })).toBeFocused();
  await page.reload();
  const reopened = await openTimeSettings(page);
  await reopened.getByRole('tab', { name: /^闹钟/ }).click();
  await expect(reopened.locator('.time-alarm-row')).toHaveCount(3);
  await expect(reopened.locator('.time-alarm-row').filter({ hasText: '修改每天' }).getByRole('checkbox')).not.toBeChecked();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).events, storageKey)).toEqual([]);
});

test('alarm validation retains drafts and rejects past dates and empty custom weekdays', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-14T08:00:00Z'));
  await boot(page);
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('tab', { name: /^闹钟/ }).click();
  await dialog.getByRole('button', { name: '添加闹钟', exact: true }).click();
  const editor = dialog.locator('.time-alarm-editor');
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('保留草稿');
  await select(editor, '重复', '一次');
  await editor.getByRole('button', { name: '日期', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(editor.getByRole('button', { name: '日期', exact: true })).toBeFocused();
  await expect(editor.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('保留草稿');
  await editor.getByRole('button', { name: '日期', exact: true }).click();
  await editor.locator('[data-date="2026-01-13"]').click();
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(editor).toContainText('一次性闹钟不能早于当前时间');
  await select(editor, '重复', '自选星期');
  for (const day of ['周一', '周二', '周三', '周四', '周五']) await editor.getByRole('checkbox', { name: day, exact: true }).uncheck();
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(editor).toContainText('自选星期不能为空');
  await expect(editor.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('保留草稿');
  expect((await stored(page)).alarms).toEqual([]);
});

test('Bar confirms one seeded alarm and snoozes another without scheduling in the browser', async ({ page }) => {
  const notice = (id: string, title: string): AlarmNotice => ({ id, title, kind: 'alarm', dueAt: new Date(Date.now() - (id === 'tea' ? 1000 : 0)).toISOString(), alarmId: `alarm-${id}`, count: 1, rangeStart: '', rangeEnd: '' });
  await boot(page, { alarmNotices: [notice('tea', '喝茶'), notice('stretch', '伸展')] }, true);
  await expect(page.locator('.status-island')).toBeVisible({ timeout: 30_000 });
  await page.locator('.status-island__trigger').click();
  const tea = page.locator('.status-island__details[data-panel="alarm"]').filter({ hasText: '喝茶' });
  await expect(tea).toBeVisible();
  await tea.getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(async () => (await stored(page)).alarmNotices.map(item => item.id)).toEqual(['stretch']);
  await expect(page.locator('.status-island__trigger')).toHaveAccessibleName(/伸展/);
  await page.locator('.status-island__trigger').click();
  const stretch = page.locator('.status-island__details[data-panel="alarm"]').filter({ hasText: '伸展' });
  await stretch.getByRole('button', { name: '稍后 5 分钟', exact: true }).click();
  await expect.poll(async () => (await stored(page)).alarmNotices).toEqual([]);
  await page.reload();
  await expect(page.getByText('喝茶', { exact: true })).toHaveCount(0);
  await expect(page.getByText('伸展', { exact: true })).toHaveCount(0);
});
