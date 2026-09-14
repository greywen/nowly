import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __statusCommands: string[];
    __statusArgs: Array<{ command: string; args: unknown }>;
  }
}

const FIXED_TIME = '2026-09-12T09:30:00';

// The rail's two native sizes. Every viewport here is one of them, because the
// webview has exactly the room the native window gives it and a viewport that
// disagrees would prove nothing about what the user sees.
const COLLAPSED = { width: 288, height: 40 };
const EXPANDED = { width: 288, height: 288 };

const snapshot = {
  sampledAt: FIXED_TIME,
  localDate: '2026-09-12',
  events: [] as unknown[],
  externalEvents: [] as unknown[],
  tasks: [] as unknown[],
  focus: {
    status: 'idle',
    remainingSeconds: 0,
    plannedSeconds: 0,
    sessionId: null,
    stageSequence: 0,
    stageChangedAt: null
  },
  reminders: [] as unknown[],
  notificationDisplay: 'detail'
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1', title: '产品发布评审', startAt: '2026-09-12T09:40', endAt: '2026-09-12T10:30', allDay: false,
    category: 'work', color: '#4FC9DA', note: '', reminders: [15, 5], createdAt: 'x', updatedAt: 'x',
    recurrence: null, startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null,
    occurrenceStartAt: null, isOverridden: false, subscriptionId: null,
    ...overrides
  };
}

// An unacknowledged reminder stage: the 15-minute stage is open at 09:30.
const reminderSnapshot = { ...snapshot, events: [event()] };

// Business state with nothing unseen: the capsule carries the summary rather
// than one notification's detail.
const passiveSnapshot = {
  ...snapshot,
  events: [event({ title: '晚间复盘', startAt: '2026-09-12T19:00', endAt: '2026-09-12T19:30', reminders: [] })]
};

const focusSnapshot = {
  ...snapshot,
  focus: {
    status: 'running',
    remainingSeconds: 600,
    plannedSeconds: 1500,
    sessionId: 'session-1',
    stageSequence: 1,
    // A session the user started themselves counts as seen immediately, and
    // nothing collapses on a timer, so it stays on the capsule while it runs.
    stageChangedAt: '2026-09-12T09:00:00+08:00'
  }
};

type OpenPayload = { source: 'island' | 'nowly'; identity: string | null };

/**
 * Native decides when the sheet is open, so the mock has to say so explicitly.
 * `open` replays the event native emits after it has already resized the window,
 * which is why the expanded tests also use the expanded viewport.
 */
async function installRail(page: Page, data: unknown = snapshot, open: OpenPayload | null = null, draggable = false) {
  await page.addInitScript(({ snapshot, open, draggable }) => {
    window.__statusCommands = [];
    window.__statusArgs = [];
    let callbackId = 0;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'quick-panel-handle' },
          currentWebview: { label: 'quick-panel-handle' }
        },
        transformCallback: (callback: unknown) => {
          callbackId += 1;
          Object.assign(window, { [`_${callbackId}`]: callback });
          return callbackId;
        },
        invoke: async (command: string, args?: { event?: string; handler?: number }) => {
          if (command === 'get_status_island_snapshot') return snapshot;
          if (command === 'begin_status_island_drag') return draggable;
          if (open && command === 'plugin:event|listen'
            && args?.event === 'status-island-details-open' && args.handler) {
            window.setTimeout(() => {
              const callback = (window as unknown as Record<string, unknown>)[`_${args.handler}`];
              if (typeof callback === 'function') callback({ event: args.event, payload: open });
            }, 0);
          }
          if (command !== 'plugin:event|listen' && command !== 'plugin:event|unlisten') {
            window.__statusCommands.push(command);
            window.__statusArgs.push({ command, args });
          }
          return 1;
        }
      }
    });
  }, { snapshot: data, open, draggable });
}

function commands(page: Page) {
  return page.evaluate(() => window.__statusCommands);
}

// The last call wins: the capsule reports `null` on mount, before the first
// snapshot resolves, and the settled identity immediately after.
function lastArgs(page: Page, command: string) {
  return page.evaluate(
    name => window.__statusArgs.filter(entry => entry.command === name).pop()?.args,
    command
  );
}

for (const scale of [1, 1.5, 2]) {
  test.describe(`collapsed rail at ${scale}x`, () => {
    test.use({ viewport: COLLAPSED, deviceScaleFactor: scale });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(FIXED_TIME));
      await installRail(page, reminderSnapshot);
      await page.goto('/');
    });

    test('splits the window into the capsule, the gap and the Nowly dot', async ({ page }) => {
      const trigger = page.getByRole('button', { name: /^产品发布评审 ·/ });
      await expect(trigger).toBeVisible();
      // 240 + 8 + 40. The 8px gap is a transparent dead zone: one native window
      // cannot be two shapes, so the sheet and the dot are drawn in the same one.
      expect(await page.locator('.status-rail__sheet').boundingBox())
        .toEqual({ x: 0, y: 0, width: 240, height: 40 });
      // Inside the sheet's 1px border, so the ring itself is not a click target.
      expect(await trigger.boundingBox()).toEqual({ x: 1, y: 1, width: 238, height: 38 });
      // The same pixel the open sheet puts it on: the head is what carries the
      // growth, so it may not move between the two sizes.
      expect(await page.locator('.status-island__icon').first().boundingBox())
        .toEqual({ x: 9, y: 8, width: 24, height: 24 });
      expect(await page.getByRole('button', { name: 'Nowly' }).boundingBox())
        .toEqual({ x: 248, y: 0, width: 40, height: 40 });
      // The sheet is laid out at its open size the whole time, so the collapsed
      // window has to clip it rather than gain a scrollbar.
      expect(await page.evaluate(() => ({
        scrollbar: window.innerWidth - document.documentElement.clientWidth,
        overflow: getComputedStyle(document.documentElement).overflowY
      }))).toEqual({ scrollbar: 0, overflow: 'hidden' });

      await trigger.click();
      expect(await commands(page)).toContain('toggle_status_island_details');
    });

    test('opens the other half from the Nowly dot', async ({ page }) => {
      await page.getByRole('button', { name: 'Nowly' }).click();

      // The same sheet, different content. Native picks which, so the webview
      // only has to say which half was pressed.
      expect(await commands(page)).toContain('toggle_nowly_panel');
      expect(await commands(page)).not.toContain('toggle_status_island_details');
    });

    test('reports the unacknowledged reminder to native as primary', async ({ page }) => {
      await expect(page.getByRole('button', { name: /^产品发布评审 ·/ })).toBeVisible();

      await expect.poll(() => lastArgs(page, 'set_status_island_primary'))
        .toEqual({ identity: 'event:event-1:2026-09-12T09:40:reminder:15' });
    });
  });
}

test.describe('an empty day', () => {
  test.use({ viewport: COLLAPSED });

  test('keeps the capsule and says so, instead of shrinking to a stub', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page);
    await page.goto('/');

    // The rail is one object at one size. An empty day is something the surface
    // reports, not a reason for it to become a different shape.
    await expect(page.locator('.status-rail')).toHaveAttribute('data-mode', 'idle');
    expect(await page.locator('.status-rail__sheet').boundingBox())
      .toEqual({ x: 0, y: 0, width: 240, height: 40 });
    await expect(page.locator('.status-island .status-island__copy strong')).toHaveText('今天没有安排');
    await expect(page.locator('.status-island .status-island__copy > span')).toHaveText('0 项日程 · 0 项待办');
    // Nothing to count and nothing to acknowledge.
    await expect(page.locator('.status-island__signal')).toHaveCount(0);
    await expect(page.locator('.status-island__dismiss[data-at="collapsed"]')).toHaveCount(0);
    // Still openable: the sheet explains the empty day.
    await page.getByRole('button', { name: '今天没有安排 · 0 项日程 · 0 项待办' }).click();
    expect(await commands(page)).toContain('toggle_status_island_details');
  });
});

test.describe('summary content', () => {
  test.use({ viewport: COLLAPSED });

  test('shows the aggregate on the same slots a detail uses', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot);
    await page.goto('/');

    await expect(page.getByLabel('Nowly 状态岛')).toBeVisible();
    await expect(page.locator('.status-island')).toHaveAttribute('data-mode', 'summary');

    // Colour never carries the meaning alone, and the text is a phrase rather
    // than a bare digit: "1" would not say one of what.
    await expect(page.locator('.status-island .status-island__copy strong')).toHaveText('日程 1 项');
    // The meta line is always the day's aggregate, so it reads the same from one
    // minute to the next instead of reflowing as counts change.
    await expect(page.locator('.status-island .status-island__copy > span')).toHaveText('今日汇总 · 共 1 项');

    await page.mouse.move(120, 20);
    expect(await commands(page)).toContain('hover_status_island_details');
    // Native owns the 300ms delay, so hovering never acknowledges on its own.
    expect(await commands(page)).not.toContain('acknowledge_status_island_reminder');
  });

  test('shows the grab cursor only after a long press starts dragging', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, null, true);
    await page.goto('/');

    const island = page.locator('.status-island__trigger');
    const nowly = page.locator('.status-rail__nowly');
    await expect(island).toHaveCSS('cursor', 'default');
    await expect(nowly).toHaveCSS('cursor', 'default');

    const box = await island.boundingBox();
    if (!box) throw new Error('status island trigger is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);

    await expect(island).toHaveCSS('cursor', 'grabbing');
    await expect(nowly).toHaveCSS('cursor', 'grabbing');
    await page.mouse.up();
  });

  test('offers no dismissal: an aggregate is not one notification to close', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot);
    await page.goto('/');

    await expect(page.locator('.status-island__dismiss[data-at="collapsed"]')).toHaveCount(0);
    // The badge/dismiss lane stays reserved even so, otherwise the copy would
    // gain width in summary mode and visibly shift as the mode changed.
    await expect(page.locator('.status-rail__header > .status-island'))
      .toHaveCSS('padding-right', '54px');
  });

  test('exposes focus progress as text, not colour alone', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, focusSnapshot);
    await page.goto('/');

    const progress = page.getByRole('progressbar', { name: '专注进度' });
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '1500');
    await expect(progress).toHaveAttribute('aria-valuenow', '600');
    await expect(progress).toHaveAttribute('aria-valuetext', '专注进行中，剩余 10 分钟');
    // The countdown is the readout, so it is on screen as text too.
    await expect(progress).toContainText('10:00');
    await expect(page.getByRole('button', { name: /专注进行中，剩余 10 分钟/ })).toBeVisible();
  });
});

test.describe('closing one notification', () => {
  test.use({ viewport: COLLAPSED });

  test('routes closing the detail to native and does not open the sheet', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, reminderSnapshot);
    await page.goto('/');

    const dismiss = page.getByRole('button', { name: '暂时隐藏：产品发布评审' });
    await expect(dismiss).toHaveCSS('opacity', '0');
    await page.locator('.status-rail__sheet').hover();
    await expect(dismiss).toHaveCSS('opacity', '1');
    await page.mouse.move(-10, -10);
    await expect(dismiss).toHaveCSS('opacity', '0');

    const trigger = page.getByRole('button', { name: /^产品发布评审 ·/ });
    await trigger.focus();
    await expect(dismiss).toHaveCSS('opacity', '1');
    await expect(trigger).toHaveCSS('box-shadow', /inset/);
    await dismiss.click();

    const dismissed = await page.evaluate(() =>
      window.__statusArgs.find(entry => entry.command === 'dismiss_status_island_reminder')?.args);
    expect(dismissed).toEqual({ identity: 'event:event-1:2026-09-12T09:40:reminder:15' });
    // Closing downgrades the capsule to the summary; it must not open the sheet.
    expect(await commands(page)).not.toContain('toggle_status_island_details');
  });
});

test.describe('the open sheet', () => {
  test.use({ viewport: EXPANDED });

  test('is the capsule grown: the head stays put and the rest is uncovered', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    const rail = page.locator('.status-rail');
    await expect(rail).toHaveAttribute('data-open', 'true');
    // Polled, because the growth is a real 220ms transition rather than a swap.
    await expect.poll(() => page.locator('.status-rail__sheet').boundingBox())
      .toEqual({ x: 0, y: 0, width: 288, height: 288 });
    // The continuity anchor: the icon is on the same pixel it occupies collapsed,
    // so the sheet reads as the capsule grown rather than a panel that replaced it.
    // y=8 is dead centre of the 40px capsule; x=9 is the 8px head padding inside
    // the 1px border.
    expect(await page.locator('.status-island__icon').first().boundingBox())
      .toEqual({ x: 9, y: 8, width: 24, height: 24 });
    // The dot is absorbed and the always-on dismiss takes the space it left.
    await expect(page.getByRole('button', { name: 'Nowly' })).toHaveCSS('opacity', '0');
    const dismiss = page.locator('.status-island__dismiss[data-at="expanded"]');
    await expect(dismiss).toHaveCSS('opacity', '1');
    expect(await dismiss.boundingBox()).toEqual({ x: 252, y: 6, width: 28, height: 28 });
    // The sheet's own body drops the frame and the title the head already carries.
    const details = page.getByRole('region', { name: '此刻详情' });
    await expect(details).toBeVisible();
    await expect(page.locator('.status-island__panel-title')).toHaveCount(0);
    // Content scrolls inside the fixed window rather than growing it.
    expect(await page.evaluate(() => ({
      width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight - document.documentElement.clientHeight
    }))).toEqual({ width: 0, height: 0 });
  });

  test('animates only its own width and height, at the approved timing', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    const rail = page.locator('.status-rail');
    await expect(rail).toHaveAttribute('data-anim', 'grow');
    const sheet = page.locator('.status-rail__sheet');
    // design.md §10 names the whitelist and the durations. Anything else moving
    // would make the sheet read as a popup rather than the capsule growing.
    await expect(sheet).toHaveCSS('transition-property', 'width, height');
    await expect(sheet).toHaveCSS('transition-duration', '0.22s, 0.22s');
    await expect(sheet).toHaveCSS('transition-timing-function',
      'cubic-bezier(0.22, 1, 0.36, 1), cubic-bezier(0.22, 1, 0.36, 1)');
    await expect(sheet).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });

  test('swaps to the Nowly half without stacking a second surface', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'nowly', identity: null });
    await page.goto('/');

    await expect(page.locator('.status-rail')).toHaveAttribute('data-source', 'nowly');
    // One sheet, one head: the status copy hands the slot over rather than both
    // being on screen at once.
    await expect(page.locator('.status-rail__nowly-head')).toHaveCSS('opacity', '1');
    await expect(page.locator('.status-rail__header > .status-island')).toHaveCSS('opacity', '0');
    await expect(page.getByText('内容待定')).toBeVisible();
    await expect(page.getByRole('button', { name: '打开日程：晚间复盘' })).toHaveCount(0);
  });

  test('routes sheet actions and Escape through native commands', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    await page.getByRole('button', { name: '打开日程：晚间复盘' }).click();
    await page.keyboard.press('Escape');

    expect(await commands(page)).toEqual(expect.arrayContaining([
      'open_status_island_event',
      'close_status_island_details'
    ]));
    // No AI entry remains anywhere in the sheet.
    expect(await commands(page)).not.toContain('open_quick_panel');
    await expect(page.getByText('问 Nowly')).toHaveCount(0);
  });

  test('offers focus controls with accessible progress', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, focusSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    await expect(page.getByRole('progressbar', { name: '专注进度' }))
      .toHaveAttribute('aria-valuetext', '专注进行中，剩余 10 分钟');

    await page.getByRole('button', { name: '暂停专注' }).click();
    expect(await commands(page)).toContain('pause_status_island_focus');
  });

  test('does not animate at all under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    // The exception in design.md §10 is opt-out, not mandatory: asked for no
    // motion, the rail simply is its new size.
    await expect(page.locator('.status-rail__sheet')).toHaveCSS('transition-duration', '0s, 0s');
    await expect(page.locator('.status-rail__panel')).toHaveCSS('transition-duration', '0s');
    expect(await page.locator('.status-rail__sheet').boundingBox())
      .toEqual({ x: 0, y: 0, width: 288, height: 288 });
  });

  test('uses an opaque surface under reduced transparency', async ({ page }) => {
    await page.emulateMedia({ reducedTransparency: 'reduce' });
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await installRail(page, passiveSnapshot, { source: 'island', identity: null });
    await page.goto('/');

    const background = await page.locator('.status-rail__sheet')
      .evaluate(element => getComputedStyle(element).backgroundColor);
    expect(background).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\)/);
  });
});
