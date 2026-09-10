import { expect, test } from '@playwright/test';
import type { AssistantConfig, Plan, Action } from '../src/assistant/types';
import type { CalendarEvent } from '../src/calendar/calendar-model';

// Isolated native IPC fixtures. These exercise UI integration, not SQLite or a
// real model; those boundaries have independent Rust tests.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nowly:onboarding-seen', 'true');
    let config: AssistantConfig = { endpoint: 'https://fixture.invalid/v1', model: 'fixture-model', hasKey: true, permissions: { calendar: true, tasks: true, external: false } };
    const plans = new Map<string, Plan>(); const calls: string[] = []; let events: CalendarEvent[] = [];
    Reflect.set(window, '__ASSISTANT_TEST_CALLS__', calls);
    const makePlan = (actions: Action[]): Plan => {
      const plan: Plan = { id: crypto.randomUUID(), status: 'pending', revision: 1, createdAt: Date.now(), expiresAt: Date.now() + 300000, actions,
        changes: actions.map((action, i) => {
          const fields = 'draft' in action ? action.draft : 'patch' in action ? action.patch : {};
          return { key: `calendar:fixture-${i}:`, kind: action.kind, title: String(fields.title ?? '早会'), before: null,
            after: { id: `fixture-${i}`, title: '早会', startAt: '2026-09-09T08:00', endAt: '2026-09-09T09:00', allDay: false,
              category: 'work', color: '#4fc9da', note: '', reminders: [0], recurrence: null, seriesId: null, seriesStartAt: null,
              occurrenceStartAt: null, isOverridden: false, startTz: 'Asia/Shanghai', endTz: 'Asia/Shanghai', rrule: null, createdAt: '', updatedAt: '', ...fields } };
        }), warnings: ['仅修改本地数据；确认前不会提交。'], options: {} };
      plans.set(plan.id, plan); return plan;
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: Record<string, any> = {}) => {
        const dispatch = async () => {
        calls.push(command);
        if (command === 'assistant_get_config') return config;
        if (command === 'assistant_save_config') {
          if (args.config.model === 'fixture-failure') throw { message: '自动检测失败；原设置未更改。\nAnthropic Messages：HTTP 401\nOpenAI Chat Completions：HTTP 404\nGemini generateContent：HTTP 403\nOpenAI Responses：HTTP 404\nAzure OpenAI：HTTP 404\nOllama：HTTP 404' };
          config = { ...args.config, hasKey: !args.clearKey, protocol: 'openaiChat', detectedEndpoint: args.config.endpoint }; return config;
        }
        if (command === 'assistant_interpret') {
          if (args.request.message === '8点') return { kind: 'clarify', message: '上午还是晚上 8 点？', records: [], plan: null };
          return { kind: 'plan', message: '检查后确认', records: [], plan: makePlan([{ kind: 'createEvent', draft: { title: '早会', startAt: '2026-09-09T08:00', reminders: [0] } }]) };
        }
        if (command === 'assistant_cancel_request') return;
        if (command === 'assistant_revise') return makePlan(args.actions);
        if (command === 'assistant_history') return [...plans.values()];
        if (command === 'assistant_cancel_plan') { plans.get(args.planId)!.status = 'cancelled'; return; }
        if (command === 'assistant_execute') {
          const p = plans.get(args.planId)!;
          if (p.status !== 'pending') throw { message: '预览失效' };
          p.status = 'committed'; events = p.changes.map(c => c.after as unknown as CalendarEvent);
          return p;
        }
        if (command === 'assistant_undo') { const p = plans.get(args.planId)!; p.status = 'undone'; events = []; return p; }
        if (command === 'assistant_status') return plans.get(args.planId);
        if (command === 'get_app_settings') return { wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced', weekStart: 'monday', dateFormat: 'localized', showWeekends: true, hideTopbarInWallpaper: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true };
        if (command === 'get_task_workspace_snapshot') return { tasks: [], lanes: [], tags: [], collaborators: [], linkingEnabled: true, defaultLaneId: 'kanban-lane-todo', completionLaneId: 'kanban-lane-done', viewPreferences: {} };
        if (command === 'list_events_in_range') return events;
        if (['list_tasks', 'list_notes', 'list_calendar_subscriptions', 'list_external_events_in_range', 'list_extensions', 'list_dev_modules', 'list_monitors'].includes(command)) return [];
        if (command === 'list_module_layout') return [{ id: 'calendar', x: 0, y: 0, w: 7, h: 8 }, { id: 'matrix', x: 7, y: 0, w: 5, h: 5 }, { id: 'notes', x: 7, y: 5, w: 5, h: 3 }];
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
        throw { message: `Unsupported fixture command: ${command}` };
        };
        // IPC serializes values; a fixture must not share mutable backend
        // object identities with React state.
        return structuredClone(await dispatch());
      },
      transformCallback: (callback: (payload: unknown) => void) => { const id = Math.floor(Math.random() * 2 ** 32); Reflect.set(window, `_${id}`, callback); return id; }
    } });
  });
  await page.goto('/');
});

test('edits a chat card, confirms once, refreshes the calendar, then undoes from history', async ({ page }, info) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('周三8点提醒我早会'); await input.press('Enter');
  const panel = page.getByRole('region', { name: '当前聊天' });
  await expect(panel.getByRole('button', { name: '确认执行 1 项' })).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__ASSISTANT_TEST_CALLS__').filter((c: string) => c === 'assistant_execute').length)).toBe(0);
  await expect(panel.getByText('2026-09-09 08:00', { exact: true })).toBeVisible();
  await panel.getByRole('textbox', { name: '标题 1' }).fill('团队早会');
  await expect(panel.getByRole('button', { name: '确认执行 1 项' })).toBeDisabled();
  await panel.getByRole('button', { name: '更新预览' }).click();
  await expect(panel.getByRole('textbox', { name: '标题 1' })).toHaveValue('团队早会');
  expect(await panel.evaluate(node => node.scrollTop)).toBe(0);
  await page.screenshot({ path: info.outputPath('assistant-preview.png') });
  await panel.getByRole('button', { name: '确认执行 1 项' }).click();
  await expect(panel.getByRole('region', { name: '操作状态：已执行' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__ASSISTANT_TEST_CALLS__').filter((c: string) => c === 'assistant_execute').length)).toBe(1);
  await page.getByRole('button', { name: '收起助手' }).click();
  await expect(page.getByRole('button', { name: /团队早会/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '操作记录' }).click();
  await page.screenshot({ path: info.outputPath('assistant-history.png') });
  await page.getByRole('button', { name: '撤销团队早会' }).click();
  await expect(page.getByRole('region', { name: '操作记录' }).getByText('已撤销')).toBeVisible();
  const bounds = await page.locator('.assistant-composer').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.body.scrollHeight <= innerHeight && document.body.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps current chat and operation history as separate views', async ({ page }, info) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  const panel = page.locator('.assistant-panel');
  const historyButton = page.getByRole('button', { name: '操作记录', exact: true });

  await input.focus();
  await expect(panel).toHaveAttribute('data-state', 'chat');
  await expect(panel.getByRole('heading', { name: '当前聊天' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('assistant-current-chat.png') });

  await historyButton.click();
  await expect(panel).toHaveAttribute('data-state', 'history');
  await expect(panel.getByRole('heading', { name: '操作记录' })).toBeVisible();
  await expect(panel.getByRole('tab', { name: '近 7 天' })).toBeVisible();
  await expect(panel).toBeVisible();

  await historyButton.click();
  await expect(panel).toHaveAttribute('data-state', 'chat');
  await expect(panel.getByRole('heading', { name: '当前聊天' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(panel).toBeHidden();
});

test('clarifies, preserves draft, hides during layout editing, and keeps connection settings in the model tab', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('8点'); await input.press('Enter');
  await expect(page.getByText('上午还是晚上 8 点？')).toBeVisible();
  await input.fill('上午8点'); await input.press('Escape');
  await expect(input).toHaveValue('上午8点');
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(input).toBeHidden();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(input).toHaveValue('上午8点');
  await expect(page.getByRole('button', { name: 'AI 设置' })).toHaveCount(0);
  await page.getByRole('button', { name: '打开设置' }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByRole('tab', { name: '模型设置' }).click();
  await expect(settings.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(input).toHaveValue('上午8点');
});

test('embeds in the topbar and expands over the workspace without reserving layout space', async ({ page }, info) => {
  const dock = page.locator('.assistant-dock');
  const topbar = page.getByRole('banner');
  const workspace = page.locator('.workspace');
  await expect(dock).toBeVisible();
  const bounds = await workspace.boundingBox();
  const composer = await page.locator('.assistant-composer').boundingBox();
  const topbarBounds = await topbar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.y + bounds!.height).toBe(viewport.height);
  expect(await topbar.evaluate((header, assistant) => header.contains(assistant), await dock.elementHandle())).toBe(true);
  expect(composer!.y).toBeGreaterThanOrEqual(topbarBounds!.y);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(topbarBounds!.y + topbarBounds!.height);
  expect(composer!.x + composer!.width / 2).toBe(viewport.width / 2);

  // Nothing to report yet, so the panel offers no way in.
  await expect(page.getByRole('region', { name: '当前聊天' })).toBeHidden();
  await expect(page.getByRole('button', { name: '展开', exact: true })).toHaveCount(0);
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('周三8点提醒我早会'); await input.press('Enter');
  const panel = page.getByRole('region', { name: '当前聊天' });
  await expect(panel).toBeVisible();
  const panelBounds = await panel.boundingBox();
  expect(panelBounds!.y).toBeGreaterThanOrEqual(topbarBounds!.y + topbarBounds!.height);
  expect(panelBounds!.y + panelBounds!.height).toBeLessThanOrEqual(viewport.height);
  expect(await workspace.boundingBox()).toEqual(bounds);
  await page.screenshot({ path: info.outputPath('assistant-topbar.png') });
  await page.getByRole('button', { name: '收起助手' }).click();
  await expect(page.getByRole('region', { name: '当前聊天' })).toBeHidden();
  await expect(page.getByRole('button', { name: '展开', exact: true })).toHaveCount(0);
  expect(await workspace.boundingBox()).toEqual(bounds);
  await page.getByRole('button', { name: '编辑布局', exact: true }).click();
  await expect(dock).toBeHidden();
  const hiddenActions = await page.locator('.top-actions').boundingBox();
  const topbarPaddingRight = await topbar.evaluate(node => Number.parseFloat(getComputedStyle(node).paddingRight));
  expect(hiddenActions!.x + hiddenActions!.width).toBe(viewport.width - topbarPaddingRight);
  expect(await workspace.boundingBox()).toEqual(bounds);
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await expect(dock).toBeVisible();
  expect(await workspace.boundingBox()).toEqual(bounds);
});

test('keeps the topbar assistant clear of navigation actions at narrow widths', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 768 });
  await expect(page.locator('.date-copy')).toBeHidden();
  let composer = await page.locator('.assistant-composer').boundingBox();
  let actions = await page.locator('.top-actions').boundingBox();
  expect(composer!.x + composer!.width + 12).toBeLessThanOrEqual(actions!.x);

  await page.setViewportSize({ width: 981, height: 768 });
  await expect(page.locator('.date-copy')).toBeVisible();
  composer = await page.locator('.assistant-composer').boundingBox();
  actions = await page.locator('.top-actions').boundingBox();
  expect(composer!.x + composer!.width + 12).toBeLessThanOrEqual(actions!.x);
});

test('shows keyboard focus in the topbar assistant', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  const composer = page.locator('.assistant-composer');
  await input.focus();
  expect(await composer.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');

  await page.keyboard.press('Tab');
  const history = page.getByRole('button', { name: '操作记录' });
  await expect(history).toBeFocused();
  expect(await history.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
});

test('swaps the send button for voice input without animated decoration', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await expect(page.getByRole('button', { name: '语音输入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送请求' })).toHaveCount(0);
  await input.fill('周三8点提醒我早会');
  await expect(page.getByRole('button', { name: '发送请求' })).toBeVisible();
  await expect(page.getByRole('button', { name: '语音输入' })).toHaveCount(0);
  const composer = page.locator('.assistant-composer');
  expect(await composer.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none');
  expect(await composer.evaluate(node => node.getBoundingClientRect().height)).toBe(58);
  // Icons in the composer and the panel header share one vertical column.
  await input.press('Enter');
  const panel = page.getByRole('region', { name: '当前聊天' });
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  const mark = await page.locator('.assistant-composer-mark').boundingBox();
  const stateIcon = await page.locator('.assistant-state-icon').boundingBox();
  expect(stateIcon!.x).toBe(mark!.x);
  expect(stateIcon!.width).toBe(mark!.width);
  expect(await page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--radius-md').trim())).toBe('10px');
  expect(await page.locator('.assistant-composer-mark').evaluate(node => getComputedStyle(node).borderRadius)).toBe('10px');
  expect(await page.locator('.assistant-state-icon').evaluate(node => getComputedStyle(node).borderRadius)).toBe('10px');
});

test('keeps the assistant panel and controls free of motion', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('周三8点提醒我早会'); await input.press('Enter');
  const panel = page.locator('.assistant-panel');
  await expect(panel).toBeVisible();
  const standard = await panel.evaluate(node => {
    const style = getComputedStyle(node);
    return { animation: style.animationName, duration: style.transitionDuration, transform: style.transform };
  });
  expect(standard).toEqual({ animation: 'none', duration: '0s', transform: 'none' });

  const record = page.getByRole('button', { name: '操作记录', exact: true });
  const recordBox = await record.boundingBox();
  await page.mouse.move(recordBox!.x + recordBox!.width / 2, recordBox!.y + recordBox!.height / 2);
  await page.mouse.down();
  const pressed = await record.evaluate(node => {
    const style = getComputedStyle(node);
    return { duration: style.transitionDuration, transform: style.transform };
  });
  expect(pressed).toEqual({ duration: '0s', transform: 'none' });
  await page.mouse.up();
});

test('keeps preview actions anchored while change details scroll', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('周三8点提醒我早会'); await input.press('Enter');
  const actions = page.locator('.assistant-actions');
  await expect(actions).toBeVisible();
  expect(await actions.evaluate(node => getComputedStyle(node).position)).toBe('sticky');
  const panel = page.getByRole('region', { name: '当前聊天' });
  expect(await panel.locator('.assistant-panel-header').evaluate(node => getComputedStyle(node).flexShrink)).toBe('0');
  await expect.poll(() => panel.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  const actionsBox = await actions.boundingBox(); const panelBox = await panel.boundingBox();
  expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
});

test('keyboard time edits cannot confirm the old plan', async ({ page }) => {
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('周三8点提醒我早会'); await input.press('Enter');
  await page.getByRole('button', { name: '开始 1时间', exact: true }).click();
  const hour = page.getByRole('spinbutton', { name: '小时' });
  await hour.focus(); await hour.press('ArrowUp');
  await expect(hour).toHaveAttribute('aria-valuenow', '9');
  // Programmatic focus mirrors tab navigation, with no pointerdown to commit
  // the picker accidentally before the boundary is checked.
  const confirm = page.getByRole('button', { name: '确认执行 1 项' });
  await expect(confirm).toBeDisabled();
  await hour.press('Enter');
  await expect(page.getByRole('button', { name: '开始 1时间', exact: true })).toContainText('09:00');
  await page.getByRole('button', { name: '更新预览' }).click();
  await expect(confirm).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, '__ASSISTANT_TEST_CALLS__').includes('assistant_execute'))).toBe(false);
});

test('automatic connection settings require no protocol and remain inside the viewport', async ({ page }, info) => {
  await page.getByRole('button', { name: '打开设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await dialog.getByRole('tab', { name: '模型设置' }).click();
  const panel = dialog.locator('.assistant-form');
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  await expect(panel.getByLabel('Model ID')).toBeVisible();
  await panel.getByLabel('Model ID').fill('fixture-failure');
  await panel.getByRole('button', { name: '检测并保存连接' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveText('连接失败，请检查 API 地址、Key 和 Model ID 后重试。');
  await expect(panel.getByLabel('Model ID')).toHaveValue('fixture-failure');
  await panel.getByRole('alert').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('assistant-detection-errors.png') });
  await panel.getByLabel('Model ID').fill('fixture-model');
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await panel.getByRole('button', { name: '检测并保存连接' }).click();
  await expect(panel.getByText('接口已自动识别，连接与权限已保存。')).toBeVisible();
  await panel.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:11434');
  await panel.getByLabel('Model ID').fill('fixture');
  await panel.getByRole('checkbox', { name: '清除已保存的 Key' }).check();
  await panel.getByRole('button', { name: '清除 Key 并保存' }).click();
  await expect(panel.getByText('连接与权限已保存。')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('8点'); await input.press('Enter');
  await expect(page.getByText('上午还是晚上 8 点？')).toBeVisible();
});
