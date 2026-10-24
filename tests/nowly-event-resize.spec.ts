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
        id: 'ev-long',
        title: '评审会',
        startAt: '2026-07-15T04:00',
        endAt: '2026-07-15T06:00',
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
    (window as any).__LIST_CALLS__ = 0;
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      value: { unregisterListener: () => undefined }
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: any = {}) => {
          if (command === 'list_events_in_range') {
            (window as any).__LIST_CALLS__ += 1;
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
          if (command === 'list_categories') return [];
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

test('stretches a timed event to a later hour in day view via its bottom handle', async ({ page }) => {
  await page.getByRole('button', { name: '天', exact: true }).click();
  const chip = page.getByRole('button', { name: /晨会/ }).first();
  await expect(chip).toBeVisible();

  // The grip at the bottom center only shows while the pointer is over the chip.
  const handle = chip.locator('.day-grid__resize-handle');
  const gripOpacity = () => handle.evaluate((element) => getComputedStyle(element, '::after').opacity);
  await expect.poll(gripOpacity).toBe('0');
  await chip.hover();
  await expect.poll(gripOpacity).toBe('0.55');

  // 07:00–08:00 covers the 07:00 row; pull its handle into the lower part of
  // the 10:00 row, which is nearest the 11:00 line.
  const box = (await handle.boundingBox())!;
  const target = page.locator('[data-hour="10"]');
  const targetBox = (await target.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.75, { steps: 12 });
  await page.mouse.up();

  // The end lands on the 11:00 line; the start stays put.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as any).__RESIZE_CALLS__?.map((c: any) => `${c.draft.startAt}/${c.draft.endAt}`)
      )
    )
    .toContain('2026-07-15T07:00/2026-07-15T11:00');
  await expect(chip).toContainText('07:00 – 11:00');
});

test('keeps a day-view event stretched after its bottom handle is released', async ({ page }) => {
  await page.getByRole('button', { name: '天', exact: true }).click();
  const chip = page.getByRole('button', { name: /评审会/ }).first();
  await expect(chip).toBeVisible();
  const rest = (await chip.boundingBox())!;
  const row4 = (await page.locator('[data-hour="4"]').boundingBox())!;
  const row6 = (await page.locator('[data-hour="6"]').boundingBox())!;
  // 04:00–06:00 covers the 04:00 and 05:00 rows.
  expect(rest.y).toBeGreaterThanOrEqual(row4.y);
  expect(rest.y + rest.height).toBeGreaterThan(row4.y + row4.height * 1.8);
  expect(rest.y + rest.height).toBeLessThanOrEqual(row6.y);

  const handle = chip.locator('.day-grid__resize-handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The lower part of the 06:00 row is nearest the 07:00 line.
  await page.mouse.move(box.x + box.width / 2, row6.y + row6.height * 0.75, { steps: 8 });

  // While held, the whole block grows down by the 06:00 row and shows the new end.
  await expect(chip).toContainText('04:00 – 07:00');
  const stretched = (await chip.boundingBox())!;
  expect(stretched.y).toBeCloseTo(rest.y, 0);
  expect(stretched.height - rest.height).toBeCloseTo(row6.height, 0);

  const listsBeforeDrop = await page.evaluate(() => (window as any).__LIST_CALLS__ as number);
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as any).__RESIZE_CALLS__?.map((c: any) => `${c.draft.startAt}/${c.draft.endAt}`)
      )
    )
    .toContain('2026-07-15T04:00/2026-07-15T07:00');
  // Once the saved events reload, the block keeps its new length instead of springing back.
  await expect.poll(() => page.evaluate(() => (window as any).__LIST_CALLS__ as number)).toBeGreaterThan(listsBeforeDrop);
  await expect(chip).toContainText('04:00 – 07:00');
  await expect.poll(async () => Math.round((await chip.boundingBox())!.height)).toBe(Math.round(stretched.height));
});

test('shrinks a day-view event when its bottom handle is pulled up', async ({ page }) => {
  await page.getByRole('button', { name: '天', exact: true }).click();
  const chip = page.getByRole('button', { name: /评审会/ }).first();
  await expect(chip).toBeVisible();
  const rest = (await chip.boundingBox())!;
  const row5 = (await page.locator('[data-hour="5"]').boundingBox())!;

  const handle = chip.locator('.day-grid__resize-handle');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The upper part of the 05:00 row is nearest the 05:00 line.
  await page.mouse.move(box.x + box.width / 2, row5.y + row5.height * 0.25, { steps: 8 });

  // While held, the block gives up the 05:00 row and shows the earlier end; its top stays put.
  await expect(chip).toContainText('04:00 – 05:00');
  const shrunk = (await chip.boundingBox())!;
  expect(shrunk.y).toBeCloseTo(rest.y, 0);
  expect(rest.height - shrunk.height).toBeCloseTo(row5.height, 0);

  const listsBeforeDrop = await page.evaluate(() => (window as any).__LIST_CALLS__ as number);
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as any).__RESIZE_CALLS__?.map((c: any) => `${c.draft.startAt}/${c.draft.endAt}`)
      )
    )
    .toContain('2026-07-15T04:00/2026-07-15T05:00');
  await expect.poll(() => page.evaluate(() => (window as any).__LIST_CALLS__ as number)).toBeGreaterThan(listsBeforeDrop);
  await expect(chip).toContainText('04:00 – 05:00');
  await expect.poll(async () => Math.round((await chip.boundingBox())!.height)).toBe(Math.round(shrunk.height));
});
