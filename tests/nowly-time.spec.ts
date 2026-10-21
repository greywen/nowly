import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultTimeSettings, type Alarm, type AlarmNotice, type ClockMode, type TimeSettings, type WorldClock } from '../src/time/time-model';

const storageKey = 'nowly:browser-backend';
test.setTimeout(60_000);
test.use({ timezoneId: 'UTC' });
const clock = (id: string, timeZone = 'UTC'): WorldClock => ({
  id, label: `城市 ${id}`, timeZone
});

type Fixture = {
  clocks?: WorldClock[];
  mode?: ClockMode;
  density?: string;
  rect?: { w: number; h: number };
  alarmNotices?: AlarmNotice[];
};

async function boot(page: Page, fixture: Fixture = {}, bar = false) {
  await page.addInitScript(({ key, fixture }) => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    if (!localStorage.getItem('nowly.language')) localStorage.setItem('nowly.language', 'zh');
    // Do not reset persisted edits when the page reloads.
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      settings: { wallpaperEnabled: false, density: fixture.density ?? 'balanced' },
      moduleLayout: [{ id: 'time', x: 0, y: 0, w: fixture.rect?.w ?? 4, h: fixture.rect?.h ?? 3 }],
      alarmFormatVersion: 1,
      timeSettings: { ...fixture.timeSettings, clocks: fixture.clocks }, alarms: [], alarmNotices: fixture.alarmNotices ?? []
    }));
  }, { key: storageKey, fixture: { ...fixture, clocks: fixture.clocks ?? [clock('local', 'local')], timeSettings: { ...defaultTimeSettings(), appearance: { ...defaultTimeSettings().appearance, mode: fixture.mode ?? 'digital' } } } });
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
    timeSettings: TimeSettings; alarms: Alarm[]; alarmNotices: AlarmNotice[];
  }>;
}

async function openTimeSettings(page: Page) {
  await page.getByTestId('time-module').getByRole('button', { name: '时间设置', exact: true }).click();
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

test('header add opens alarm creation at the current time and persists after confirmation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T15:17:42Z'));
  await boot(page);
  const add = page.getByTestId('time-module').getByRole('button', { name: '添加闹钟', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  const dialog = page.getByRole('dialog', { name: '时间设置', exact: true });
  await expect(dialog.getByRole('tab', { name: '闹钟', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: '时间', exact: true })).toHaveText('15:17');
  expect((await stored(page)).alarms).toHaveLength(0);
  await dialog.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect.poll(async () => (await stored(page)).alarms).toEqual([
    expect.objectContaining({ hour: 15, minute: 17, repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] } })
  ]);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(add).toBeFocused();
  await page.reload();
  expect((await stored(page)).alarms).toHaveLength(1);
});

for (const mode of ['digital', 'analog', 'mixed'] as const) {
  test(`pure ${mode} hides optional information and keeps tabs in settings`, async ({ page }) => {
    await boot(page, { mode, clocks: [clock('东京', 'Asia/Tokyo')] });
    const widget = page.getByTestId('time-widget');
    await expect(widget).toHaveAttribute('data-clock-count', '1');
    const tile = widget.getByTestId('time-clock');
    await expect(tile).toHaveAttribute('data-clock-mode', mode);
    await expect(tile).toHaveAccessibleName(/城市 东京 \d{2}:\d{2}/);
    await expect(widget.getByTestId('time-clock-digital')).toHaveCount(mode === 'analog' ? 0 : 1);
    await expect(widget.getByTestId('time-clock-face')).toHaveCount(mode === 'digital' ? 0 : 1);
    await expect(widget.locator('.time-clock__label, .time-clock__meta')).toHaveCount(0);
    const module = page.getByTestId('time-module');
    await expect(module.getByRole('button', { name: '时间设置', exact: true })).toBeVisible();
    await expect(module.getByRole('button', { name: '专注统计', exact: true })).toHaveCount(0);
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
          moduleLayout: [{ id: 'time', x: 0, y: 0, ...rect }], timeSettings: { ...fixture.timeSettings, appearance: { ...fixture.timeSettings.appearance, mode: 'mixed', showLabel: true, showDate: true, showDifference: true }, clocks } }));
      }, { key: storageKey, density, rect, clocks: [clock('UTC'), clock('Tokyo', 'Asia/Tokyo'), clock('Kathmandu', 'Asia/Kathmandu'), clock('NewYork', 'America/New_York')] });
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
  await select(dialog, '显示模式', '混合');
  await select(dialog, '小时制', '12 小时');
  await dialog.getByRole('checkbox', { name: '显示秒', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '显示城市', exact: true }).check();
  await cards.nth(1).getByRole('button', { name: '上移 伦敦', exact: true }).click();
  await saveClocks(dialog);
  await expect(page.getByTestId('time-widget')).toHaveAttribute('data-clock-count', '2');
  await expect(page.getByTestId('time-clock').first()).toHaveAttribute('data-time-zone', 'Europe/London');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const widget = page.getByTestId('time-widget');
  await expect(widget).toHaveAttribute('data-clock-count', '2');
  await expect(widget.getByTestId('time-clock-digital').first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(widget.getByTestId('time-clock-period').first()).toHaveText(/上午|下午/);
  const reopened = await openTimeSettings(page);
  await reopened.locator('.time-clock-settings-card').nth(1).getByRole('button', { name: /^删除/ }).click();
  await saveClocks(reopened);
  await expect(widget).toHaveAttribute('data-clock-count', '1');
  await page.reload();
  await expect(widget.getByTestId('time-clock').first()).toHaveAttribute('data-time-zone', 'Europe/London');
  expect((await stored(page)).timeSettings.clocks).toHaveLength(1);
  await openTimeSettings(page);
  await expect(page.getByRole('textbox', { name: '显示名称', exact: true })).toHaveValue('伦敦');
});

test('twelve-hour periods stay small at the bottom-right across layouts and languages', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date('2026-10-21T02:02:09Z'));
  await boot(page, { rect: { w: 12, h: 6 }, clocks: [clock('UTC'), clock('NewYork', 'America/New_York')] });
  const cases = [
    { language: 'zh', mode: 'digital', layout: 'horizontal', showSeconds: false, rect: { w: 12, h: 6 } },
    { language: 'en', mode: 'digital', layout: 'stacked', showSeconds: true, rect: { w: 6, h: 6 } },
    { language: 'ar', mode: 'digital', layout: 'horizontal', showSeconds: true, rect: { w: 4, h: 3 } },
    { language: 'zh', mode: 'mixed', layout: 'horizontal', showSeconds: false, rect: { w: 6, h: 6 } },
    { language: 'zh', mode: 'analog', layout: 'horizontal', showSeconds: false, rect: { w: 6, h: 6 } }
  ] as const;
  for (const appearance of cases) {
    await page.evaluate(({ key, appearance }) => {
      localStorage.setItem('nowly.language', appearance.language);
      const fixture = JSON.parse(localStorage.getItem(key)!);
      fixture.moduleLayout = [{ id: 'time', x: 0, y: 0, ...appearance.rect }];
      fixture.timeSettings.appearance = { ...fixture.timeSettings.appearance, ...appearance,
        hourCycle: 'h12', showDate: true, fontMode: 'manual', fontSize: 128 };
      localStorage.setItem(key, JSON.stringify(fixture));
    }, { key: storageKey, appearance });
    await page.reload();
    const tiles = page.getByTestId('time-clock');
    await expect(tiles).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const tile = tiles.nth(index);
      const period = tile.getByTestId('time-clock-period');
      await expect(period).toBeVisible();
      await expect(period).toHaveCSS('font-size', '11.05px');
      await expect(period).toHaveText(appearance.language === 'zh' ? (index === 0 ? '上午' : '下午') : appearance.language === 'en' ? (index === 0 ? 'AM' : 'PM') : (index === 0 ? 'ص' : 'م'));
      const reading = tile.locator('.time-clock__reading');
      const readingBox = (await reading.boundingBox())!;
      const periodBox = (await period.boundingBox())!;
      if (appearance.mode === 'analog') {
        expect(Math.abs(periodBox.y + periodBox.height - readingBox.y - readingBox.height)).toBeLessThan(1);
      }
      expect(periodBox.x).toBeGreaterThanOrEqual(readingBox.x);
      expect(periodBox.x + periodBox.width).toBeLessThanOrEqual(readingBox.x + readingBox.width + 1);
      if (appearance.mode !== 'analog') {
        const digits = tile.getByTestId('time-clock-digital');
        const expected = await page.evaluate(({ language, showSeconds, timeZone }) => {
          const parts = new Intl.DateTimeFormat(language, { timeZone, hourCycle: 'h12', hour: '2-digit', minute: '2-digit', second: showSeconds ? '2-digit' : undefined }).formatToParts(new Date('2026-10-21T02:02:09Z'));
          return parts.filter(part => part.type === 'hour' || part.type === 'minute' || part.type === 'second').map(part => part.value).join(':');
        }, { language: appearance.language, showSeconds: appearance.showSeconds, timeZone: index === 0 ? 'UTC' : 'America/New_York' });
        await expect(digits).toHaveText(appearance.layout === 'stacked' ? expected.replaceAll(':', '') : expected);
        const digitsBox = (await digits.boundingBox())!;
        expect(periodBox.x).toBeGreaterThanOrEqual(digitsBox.x + digitsBox.width);
        const baseline = async (element: Locator) => element.evaluate(target => {
          const marker = document.createElement('span');
          marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
          target.appendChild(marker);
          const y = marker.getBoundingClientRect().top;
          marker.remove();
          return y;
        });
        const lastDigits = appearance.layout === 'stacked' ? digits.locator('span').last() : digits;
        expect(Math.abs(await baseline(lastDigits) - await baseline(period))).toBeLessThan(1);
        const tileBox = (await tile.boundingBox())!;
        expect(readingBox.x + readingBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width + 1);
      }
    }
    expect((await stored(page)).timeSettings.appearance.hourCycle).toBe('h12');
  }
});

test('global appearance controls persist stacked manual sizing and independent dates', async ({ page }) => {
  await boot(page, { rect: { w: 6, h: 5 } });
  const dialog = await openTimeSettings(page);
  await select(dialog, '布局', '上下排列');
  await select(dialog, '字号模式', '手动字号');
  await dialog.getByRole('slider').fill('128');
  await expect(page.getByTestId('time-clock')).toHaveAttribute('data-clock-layout', 'stacked');
  await expect(page.getByTestId('time-clock-digital').locator('span')).toHaveCount(2);
  await expect(dialog).toBeVisible();
  await saveClocks(dialog);
  expect((await stored(page)).timeSettings.appearance).toMatchObject({ layout: 'stacked', fontMode: 'manual', fontSize: 128 });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  const reopened = await openTimeSettings(page);
  await expect(reopened.getByRole('slider')).toHaveValue('128');
  await reopened.getByRole('checkbox', { name: '显示日期', exact: true }).check();
  await saveClocks(reopened);
  expect((await stored(page)).timeSettings.appearance).toMatchObject({ layout: 'stacked', showDate: true });
});

test('settings alarm tab creates alarms and enabled indicators update immediately', async ({ page }) => {
  await boot(page);
  const widget = page.getByTestId('time-widget');
  const settings = page.getByTestId('time-module').getByRole('button', { name: '时间设置', exact: true });
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('tab', { name: /^闹钟/ }).click();
  await dialog.getByRole('button', { name: '添加闹钟', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: /^闹钟/ })).toHaveAttribute('aria-selected', 'true');
  const editor = dialog.locator('.time-alarm-editor');
  await expect(editor).toBeVisible();
  const layout = await editor.evaluate(element => {
    const box = (selector: string) => {
      const bounds = element.querySelector(selector)!.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom };
    };
    return {
      main: box('.time-alarm-editor__main'), repeat: box('.time-alarm-editor__repeat'), actions: box('.time-alarm-editor__actions'),
      enabled: box('.time-alarm-editor__main .form-check'), repeating: box('.time-alarm-editor__repeat .form-check'),
      title: box('.time-alarm-editor__main .time-field'), weekdays: box('.time-weekday-fieldset'),
      time: box('.time-alarm-editor__main > :last-child')
    };
  });
  expect(Math.abs(layout.enabled.x - layout.repeating.x)).toBeLessThan(1);
  expect(Math.abs(layout.title.x - layout.weekdays.x)).toBeLessThan(1);
  expect(Math.abs(layout.time.right - layout.actions.right)).toBeLessThan(1);
  expect(layout.main.bottom).toBeLessThan(layout.repeat.y);
  expect(layout.repeat.bottom).toBeLessThan(layout.actions.y);
  await expect(editor.locator('.time-weekday-chip__label')).toHaveText(['日', '一', '二', '三', '四', '五', '六']);
  await expect(editor.locator('.time-alarm-editor__next')).toHaveCount(0);
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('晨间提醒');
  await expect(dialog.getByRole('tab', { name: '闹钟', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '日期', exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: '时间', exact: true }).click();
  await editor.getByRole('spinbutton', { name: '分钟', exact: true }).fill('17');
  for (const unit of ['小时', '分钟']) {
    const field = editor.getByRole('spinbutton', { name: unit, exact: true });
    await field.focus();
    await expect(field).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(field).toHaveCSS('box-shadow', 'none');
    const stepper = field.locator('..');
    await expect(stepper).toHaveCSS('border-top-color', 'rgb(79, 201, 218)');
    await editor.getByRole('button', { name: `增加${unit}`, exact: true }).focus();
    await expect(stepper).toHaveCSS('border-top-color', 'rgb(79, 201, 218)');
    const decrease = await editor.getByRole('button', { name: `减少${unit}`, exact: true }).boundingBox();
    const input = await editor.getByRole('spinbutton', { name: unit, exact: true }).boundingBox();
    const increase = await editor.getByRole('button', { name: `增加${unit}`, exact: true }).boundingBox();
    expect(decrease!.width).toBe(40);
    expect(increase!.width).toBe(40);
    expect(input!.width).toBeGreaterThanOrEqual(48);
    expect(decrease!.x + decrease!.width).toBeLessThanOrEqual(input!.x + 1);
    expect(input!.x + input!.width).toBeLessThanOrEqual(increase!.x + 1);
    expect(Math.abs(decrease!.y - increase!.y)).toBeLessThan(1);
  }
  expect((await stored(page)).alarms).toEqual([]);
  await editor.getByRole('button', { name: '确定', exact: true }).click();
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(dialog.locator('.time-alarm-row')).toHaveCount(1);
  await expect(widget.locator('.time-widget__alarm')).toBeVisible();
  await expect(dialog.locator('.time-alarm-editor')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '编辑 晨间提醒', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByRole('button', { name: '添加闹钟', exact: true })).toBeFocused();
  expect((await stored(page)).alarms[0].minute).toBe(17);
  await dialog.locator('.time-alarm-row').getByRole('checkbox').uncheck();
  await expect(widget.locator('.time-widget__alarm')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(settings).toBeFocused();
});

test('settings tabs never change display, focus continues when switching and display persists across reload', async ({ page }) => {
  await boot(page);
  const dialog = await openTimeSettings(page);
  await expect(dialog.getByRole('tab')).toHaveCount(3);
  await expect(dialog.getByRole('tab', { name: '时差对照' })).toHaveCount(0);
  await dialog.getByRole('tab', { name: '专注时段', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: '时间', exact: true })).toBeChecked();
  await expect(dialog.getByRole('button', { name: /统计/ })).toHaveCount(0);
  const duration = dialog.getByRole('spinbutton');
  await duration.fill('45');
  await dialog.getByRole('radio', { name: '专注时段', exact: true }).check();
  await saveClocks(dialog);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const module = page.getByTestId('time-module');
  await expect(module).toHaveAttribute('data-display-content', 'focus');
  await expect(module.getByRole('button', { name: '专注统计', exact: true })).toBeVisible();
  await expect(module).toContainText('45:00');
  expect(await module.locator('.focus-timer').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(150);
  await module.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(module.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const settings = await openTimeSettings(page);
  await settings.getByRole('radio', { name: '时间', exact: true }).check();
  await saveClocks(settings);
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(module.locator('.time-module__focus-status')).toContainText('专注中');
  await expect(module.getByRole('button', { name: '专注统计' })).toHaveCount(0);
  await page.reload();
  await expect(module).toHaveAttribute('data-display-content', 'clocks');
  expect((await stored(page)).timeSettings.focusPreferences.defaultMinutes).toBe(45);
});

test('focus body fills the module and keeps timer controls visible at minimum and default sizes', async ({ page }) => {
  await boot(page);
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('radio', { name: '专注时段', exact: true }).check();
  await saveClocks(dialog);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  for (const rect of [{ w: 4, h: 3 }, { w: 2, h: 2 }]) {
    await page.evaluate(({ key, rect }) => {
      const store = JSON.parse(localStorage.getItem(key)!);
      store.moduleLayout = [{ id: 'time', x: 0, y: 0, ...rect }];
      localStorage.setItem(key, JSON.stringify(store));
    }, { key: storageKey, rect });
    await page.reload();
    const module = page.getByTestId('time-module');
    await expect(module.getByRole('button', { name: '开始专注', exact: true })).toBeVisible();
    const geometry = await module.evaluate(element => {
      const content = element.querySelector('.time-module__content:not([hidden])')!.getBoundingClientRect();
      const focus = element.querySelector('.focus-timer')!.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('.focus-timer__body button, .focus-timer__display')].filter(control => control.getBoundingClientRect().height > 0);
      return { height: focus.height, delta: Math.abs(content.height - focus.height), clipped: controls.some(control => {
        const rect = control.getBoundingClientRect();
        return rect.top < bounds.top || rect.bottom > bounds.bottom + 1 || rect.left < bounds.left || rect.right > bounds.right + 1;
      }) };
    });
    expect(geometry.height).toBeGreaterThan(50);
    expect(geometry.delta).toBeLessThanOrEqual(1);
    expect(geometry.clipped).toBe(false);
  }
});

test('compact settings uses global controls, a 760px dialog and responds on narrow screens', async ({ page }) => {
  await boot(page);
  const dialog = await openTimeSettings(page);
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBe(760);
  await expect(dialog.locator('.time-settings-grid--appearance')).toHaveCSS('grid-template-columns', /.+ .+ .+/);
  await dialog.getByRole('button', { name: '添加时钟', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '显示模式', exact: true })).toHaveCount(1);
  await expect(dialog.locator('.time-clock-settings-card').getByRole('combobox', { name: '显示模式' })).toHaveCount(0);
  await select(dialog, '字号模式', '手动字号');
  const slider = dialog.getByRole('slider');
  const sliderWidthRatio = await slider.evaluate(element => element.getBoundingClientRect().width / element.parentElement!.getBoundingClientRect().width);
  expect(sliderWidthRatio).toBeGreaterThan(0.9);
  await expect(slider).toHaveAttribute('min', '32');
  await expect(slider).toHaveAttribute('max', '160');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('97');
  await page.setViewportSize({ width: 420, height: 800 });
  const overflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
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
    await editor.getByRole('button', { name: '时间', exact: true }).click();
    await editor.getByRole('spinbutton', { name: '小时', exact: true }).fill('10');
    await editor.getByRole('spinbutton', { name: '分钟', exact: true }).fill('17');
    await editor.getByRole('button', { name: '确定', exact: true }).click();
    if (repeat === '一次') await editor.getByRole('checkbox', { name: '重复闹钟', exact: true }).uncheck();
    if (repeat === '每天') {
      for (const day of ['周六', '周日']) await editor.getByRole('checkbox', { name: day, exact: true }).check();
    }
    if (repeat === '自选星期') {
      for (const day of ['周二', '周三', '周四', '周五']) await editor.getByRole('checkbox', { name: day, exact: true }).uncheck();
      await editor.getByRole('checkbox', { name: '周六', exact: true }).check();
    }
    await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: `编辑 测试${repeat}`, exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('button', { name: '添加闹钟', exact: true })).toBeFocused();
  }
  await expect(dialog.locator('.time-alarm-row')).toHaveCount(4);
  const repeats = (await stored(page)).alarms.map(alarm => alarm.repeat);
  expect(repeats).toEqual([{ kind: 'once' }, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] }, { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, { kind: 'weekly', weekdays: [1, 6] }]);
  await expect(dialog.getByRole('tab', { name: '闹钟', exact: true })).toBeVisible();
  const daily = dialog.locator('.time-alarm-row').filter({ hasText: '测试每天' });
  await daily.getByRole('checkbox').uncheck();
  await expect.poll(async () => (await stored(page)).alarms.find(item => item.title === '测试每天')?.enabled).toBe(false);
  await daily.getByRole('button', { name: '编辑 测试每天', exact: true }).click();
  await expect(daily.locator('.time-alarm-editor')).toHaveCount(1);
  await expect(dialog.locator('.time-alarm-editor')).toHaveCount(1);
  await daily.locator('.time-alarm-editor').getByRole('textbox', { name: '标题', exact: true }).fill('修改每天');
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

test('alarm validation retains drafts, cancels unconfirmed time and rejects empty weekdays', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-14T08:00:00Z'));
  await boot(page);
  const dialog = await openTimeSettings(page);
  await dialog.getByRole('tab', { name: /^闹钟/ }).click();
  await dialog.getByRole('button', { name: '添加闹钟', exact: true }).click();
  const editor = dialog.locator('.time-alarm-editor');
  await editor.getByRole('textbox', { name: '标题', exact: true }).fill('保留草稿');
  const time = editor.getByRole('button', { name: '时间', exact: true });
  await time.click();
  await editor.getByRole('spinbutton', { name: '分钟', exact: true }).fill('27');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(time).toBeFocused();
  await expect(time).toContainText('09:00');
  await expect(editor.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('保留草稿');
  for (const day of ['周一', '周二', '周三', '周四', '周五']) await editor.getByRole('checkbox', { name: day, exact: true }).uncheck();
  await editor.getByRole('button', { name: '创建闹钟', exact: true }).click();
  await expect(editor).toContainText('自选星期不能为空');
  await expect(editor.getByRole('textbox', { name: '标题', exact: true })).toHaveValue('保留草稿');
  expect((await stored(page)).alarms).toEqual([]);
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await editor.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await time.click();
  const panel = await editor.getByRole('dialog').boundingBox();
  const bounds = await dialog.boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
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
