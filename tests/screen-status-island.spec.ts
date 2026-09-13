import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __statusCommands: string[];
  }
}

const snapshot = {
  sampledAt: '2026-09-12T09:30',
  events: [],
  externalEvents: [],
  tasks: [],
  focus: { status: 'idle', remainingSeconds: 0, sessionId: null }
};

const reminderEvent = {
  id: 'event-1', title: '产品发布评审', startAt: '2026-09-12T09:40', endAt: '2026-09-12T10:30', allDay: false,
  category: 'work', color: '#4FC9DA', note: '', reminders: [15, 5], createdAt: 'x', updatedAt: 'x', recurrence: null,
  startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, occurrenceStartAt: null,
  isOverridden: false, subscriptionId: null
};

async function installStatusWindow(page: Page, label: 'quick-panel-handle' | 'status-island-details', data = snapshot) {
  await page.addInitScript(({ label, snapshot }) => {
    window.__statusCommands = [];
    let callbackId = 0;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label }, currentWebview: { label } },
        transformCallback: (callback: unknown) => {
          callbackId += 1;
          Object.assign(window, { [`_${callbackId}`]: callback });
          return callbackId;
        },
        invoke: async (command: string, args?: { event?: string; handler?: number }) => {
          if (command === 'get_status_island_snapshot') return snapshot;
          if (command === 'plugin:event|listen' && args?.event === 'status-island-details-open' && args.handler) {
            window.setTimeout(() => {
              const callback = (window as unknown as Record<string, unknown>)[`_${args.handler}`];
              if (typeof callback === 'function') callback({ event: args.event, payload: null });
            }, 0);
          }
          if (command !== 'plugin:event|listen' && command !== 'plugin:event|unlisten') {
            window.__statusCommands.push(command);
          }
          return 1;
        }
      }
    });
  }, { label, snapshot: data });
}

for (const scale of [1, 1.5, 2]) {
  test.describe(`screen status island at ${scale}x`, () => {
    test.use({ viewport: { width: 288, height: 48 }, deviceScaleFactor: scale });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-09-12T09:30:00'));
      await installStatusWindow(page, 'quick-panel-handle', { ...snapshot, events: [reminderEvent] });
      await page.goto('/');
    });

    test('fills its exact native hit area and toggles details', async ({ page }) => {
      const trigger = page.getByRole('button', { name: /^产品发布评审 ·/ });
      await expect(trigger).toBeVisible();
      expect(await trigger.boundingBox()).toEqual({ x: 0, y: 0, width: 288, height: 48 });
      expect(await page.evaluate(() => ({
        width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight - document.documentElement.clientHeight
      }))).toEqual({ width: 0, height: 0 });

      await trigger.click();
      expect(await page.evaluate(() => window.__statusCommands)).toContain('toggle_status_island_details');
    });
  });
}

test.describe('screen home indicator', () => {
  test.use({ viewport: { width: 96, height: 13 } });

  test('replaces the island when no prompt exists', async ({ page }) => {
    await installStatusWindow(page, 'quick-panel-handle');
    await page.goto('/');

    const indicator = page.getByRole('button', { name: '打开 AI 快捷面板' });
    await expect(indicator).toBeVisible();
    expect(await indicator.boundingBox()).toEqual({ x: 0, y: 0, width: 96, height: 12 });
    expect(await indicator.locator('span').boundingBox()).toEqual({ x: 0, y: 7, width: 96, height: 5 });
    await page.mouse.move(48, 12.5);
    expect(await page.evaluate(() => window.__statusCommands)).not.toContain('open_quick_panel');
    await page.mouse.move(48, 10);
    expect(await page.evaluate(() => window.__statusCommands)).toContain('open_quick_panel');
    await expect(page.getByLabel('Nowly 状态岛')).toHaveCount(0);
  });
});

test.describe('screen status island dismissal', () => {
  test.use({ viewport: { width: 288, height: 48 } });

  test('dismisses only the current reminder stage', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-12T09:25:00'));
    await installStatusWindow(page, 'quick-panel-handle', {
      ...snapshot,
      events: [reminderEvent]
    });
    await page.goto('/');

    const dismiss = page.getByRole('button', { name: '暂时隐藏：产品发布评审' });
    await expect(dismiss).toHaveCSS('opacity', '0');
    await page.locator('.status-island__trigger-shell').hover();
    await expect(dismiss).toHaveCSS('opacity', '1');
    await page.mouse.move(-10, -10);
    await expect(dismiss).toHaveCSS('opacity', '0');
    const trigger = page.getByRole('button', { name: /^产品发布评审 ·/ });
    await trigger.focus();
    await expect(dismiss).toHaveCSS('opacity', '1');
    await expect(trigger).toHaveCSS('box-shadow', /inset/);
    await dismiss.click();

    await expect(page.getByRole('button', { name: '打开 AI 快捷面板' })).toBeVisible();
    expect(await page.evaluate(() => window.__statusCommands)).not.toContain('toggle_status_island_details');

    await page.reload();
    await expect(page.getByRole('button', { name: '打开 AI 快捷面板' })).toBeVisible();

    await page.clock.setFixedTime(new Date('2026-09-12T09:35:00'));
    await page.clock.runFor(1_000);
    await expect(page.getByRole('button', { name: /^产品发布评审 ·/ })).toBeVisible();
  });
});

test.describe('screen status island details', () => {
  test.use({ viewport: { width: 330, height: 240 } });

  test.beforeEach(async ({ page }) => {
    await installStatusWindow(page, 'status-island-details');
    await page.goto('/');
  });

  test('fills the native details window and supports actions and Escape', async ({ page }) => {
    const details = page.getByRole('region', { name: '此刻详情' });
    await expect(details).toBeVisible();
    expect(await details.boundingBox()).toEqual({ x: 0, y: 0, width: 330, height: 240 });
    expect(await details.evaluate(element => element.scrollHeight)).toBeLessThanOrEqual(240);

    await page.getByRole('button', { name: '开始专注' }).click();
    await page.getByRole('button', { name: '问 Nowly' }).click();
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => window.__statusCommands)).toEqual(expect.arrayContaining([
      'start_status_island_focus',
      'open_quick_panel',
      'close_status_island_details'
    ]));
  });

  test('removes transform motion under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const details = page.locator('.status-island__details');
    expect(await details.evaluate(element => getComputedStyle(element).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(details).toHaveCSS('transition-property', 'opacity');
  });
});
