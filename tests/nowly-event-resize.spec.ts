import { expect, test } from '@playwright/test';

// Stretching a month-view event bar to a later day runs on pointer events with
// an explicit resize handle. Native HTML5 drag with a thin edge hit-zone was
// unreliable (especially in the Tauri webview) so the stretch rarely fired.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = '2026-07-15T09:42:00.000Z';
    // Pin the app clock to July 2026 so the seeded multi-day event is in view.
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now);
        // @ts-expect-error forward constructor args
        else super(...args);
      }
      static now() {
        return new RealDate(now).getTime();
      }
    }
    // @ts-expect-error replace global Date
    Date = FixedDate;

    let events: any[] = [
      {
        id: 'ev-multi',
        title: '产品冲刺',
        startAt: '2026-07-04T00:00',
        endAt: '2026-07-06T23:59',
        allDay: true,
        category: 'work',
        color: 'blue',
        linkedTaskId: null,
        subscriptionId: null,
        note: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ev-timed',
        title: '晨会',
        startAt: '2026-07-15T07:00',
        endAt: '2026-07-15T08:00',
        allDay: false,
        category: 'work',
        color: 'blue',
        linkedTaskId: null,
        subscriptionId: null,
        note: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ev-two-day',
        title: '短期计划',
        startAt: '2026-07-20T00:00',
        endAt: '2026-07-21T23:59',
        allDay: true,
        category: 'work',
        color: 'blue',
        linkedTaskId: null,
        subscriptionId: null,
        note: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ev-cross-week',
        title: 'test',
        startAt: '2026-09-13T23:00',
        endAt: '2026-09-14T00:00',
        allDay: false,
        category: 'work',
        color: 'blue',
        linkedTaskId: null,
        subscriptionId: null,
        note: '',
        createdAt: now,
        updatedAt: now
      }
    ];
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    (window as any).__RESIZE_CALLS__ = [];
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      value: { unregisterListener: () => undefined }
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: any = {}) => {
          if (command === 'list_events_in_range') {
            return events.filter((e) => e.startAt >= args.range.startAt && e.startAt < args.range.endAtExclusive);
          }
          if (command === 'update_event') {
            const id = args.target?.id ?? args.id;
            (window as any).__RESIZE_CALLS__.push({ id, draft: args.draft });
            const old = events.find((e) => e.id === id);
            const updated = { ...old, ...args.draft, updatedAt: now };
            events = events.map((e) => (e.id === id ? updated : e));
            return updated;
          }
          if (command === 'list_tasks') return [];
          if (command === 'list_notes') return [];
          if (command === 'list_extensions') return [];
          if (command === 'list_external_events_in_range') return [];
          if (command === 'list_calendar_subscriptions') return [];
          if (command === 'list_oauth_accounts') return [];
          if (command === 'list_focus_sessions') return [];
          if (command === 'get_task_workspace_snapshot') {
            return {
              tasks: [], lanes: [], tags: [], collaborators: [],
              linkingEnabled: true, defaultLaneId: null, completionLaneId: null,
              viewPreferences: {}
            };
          }
          if (command === 'get_app_settings') return settings;
          // Reject the layout query so the app falls back to its default
          // layout (which includes the calendar module the drag tests need).
          if (command === 'list_module_layout') throw new Error('use default layout');
          return 'ok';
        },
        transformCallback: (cb: (payload: unknown) => void) => {
          const id = 1;
          Reflect.set(window, `_${id}`, cb);
          return id;
        }
      }
    });
  });
  await page.goto('/');
});

test('stretches a multi-day event to a later day via the resize handle', async ({ page }) => {
  // The event spans a week boundary, so the resizable segment is the tail one.
  const bar = page.getByRole('button', { name: /产品冲刺/ }).last();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;

  // Grab the resize handle at the right edge and sweep to the 14th.
  const startX = box.x + box.width - 5;
  const startY = box.y + box.height / 2;
  const target = page.locator('[data-iso-date="2026-07-14"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 10, { steps: 12 });
  await page.mouse.up();

  // The write lands with the stretched end date.
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.endAt as string))
    )
    .toContainEqual(expect.stringContaining('2026-07-14'));
});

test('shrinks a two-day all-day event to one day with a quick drag', async ({ page }) => {
  const bar = page.getByRole('button', { name: /短期计划/ });
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  const target = page.locator('[data-iso-date="2026-07-20"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 10);
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.endAt as string))
    )
    .toContain('2026-07-20T23:59');
});

test('shrinks a Sunday-to-Monday cross-midnight event back to Sunday', async ({ page }) => {
  await page.getByRole('button', { name: '下一个月' }).click();
  await page.getByRole('button', { name: '下一个月' }).click();
  await expect(page.getByRole('heading', { name: '2026年9月' })).toBeVisible();

  const tailBar = page.getByRole('button', { name: /23:00 test/ }).last();
  await expect(tailBar).toBeVisible();
  const box = (await tailBar.boundingBox())!;
  const target = page.locator('[data-iso-date="2026-09-13"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 10);
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.endAt as string))
    )
    .toContain('2026-09-13T23:59');
});

test('moves a multi-day event to a later day by dragging its body', async ({ page }) => {
  // Grab the head segment (start day) and drag the whole bar forward one week.
  const bar = page.getByRole('button', { name: /产品冲刺/ }).first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;

  // Grab the middle of the bar (away from the resize handle) and drag to the 11th.
  const startX = box.x + Math.min(40, box.width / 2);
  const startY = box.y + box.height / 2;
  const target = page.locator('[data-iso-date="2026-07-11"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 10, { steps: 12 });
  await page.mouse.up();

  // The write moves the start date forward, keeping the 3-day span.
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.startAt as string))
    )
    .toContainEqual(expect.stringContaining('2026-07-11'));
});

test('moves a timed event to another day in week view by dragging', async ({ page }) => {
  // The view switcher is an icon segmented control; each button carries the
  // view's label as its accessible name.
  await page.getByRole('button', { name: '周', exact: true }).click();
  // The timed event sits on the 15th; drag its chip to the 17th column.
  const chip = page.getByRole('button', { name: /晨会/ }).first();
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  const target = page.locator('[data-iso-date="2026-07-17"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.startAt as string))
    )
    .toContainEqual(expect.stringContaining('2026-07-17'));
});

test('moves a timed event to another hour in day view by dragging', async ({ page }) => {
  await page.getByRole('button', { name: '天', exact: true }).click();
  // The timed event starts at 07:00; drag it down to the 10:00 row.
  const chip = page.getByRole('button', { name: /晨会/ }).first();
  await expect(chip).toBeVisible();
  const box = (await chip.boundingBox())!;
  const target = page.locator('[data-hour="10"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__RESIZE_CALLS__?.map((c: any) => c.draft.startAt as string))
    )
    .toContainEqual(expect.stringContaining('T10:00'));
});
