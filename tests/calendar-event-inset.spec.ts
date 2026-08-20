import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = '2026-07-15T09:42:00.000Z';
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now);
        // @ts-expect-error forward Date constructor arguments
        else super(...args);
      }
      static now() { return new RealDate(now).getTime(); }
    }
    // @ts-expect-error pin the application clock
    Date = FixedDate;
    const events = [
      { id: 'event-span', title: '今天', startAt: '2026-07-08T00:00', endAt: '2026-07-10T23:59', allDay: true, category: 'work', color: 'blue', linkedTaskId: null, note: '', createdAt: now, updatedAt: now },
      { id: 'event-inset', title: '边框测试日程', startAt: '2026-07-08T09:00', endAt: '2026-07-08T10:00', allDay: false, category: 'work', color: 'blue', linkedTaskId: null, note: '', createdAt: now, updatedAt: now },
      { id: 'event-standalone', title: '独立单日日程', startAt: '2026-07-11T09:00', endAt: '2026-07-11T10:00', allDay: false, category: 'work', color: 'blue', linkedTaskId: null, note: '', createdAt: now, updatedAt: now }
    ];
    const settings = { wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced', weekStart: 'monday', dateFormat: 'localized', showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true };
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'list_events_in_range') return events;
          if (command === 'list_tasks' || command === 'list_notes') return [];
          if (command === 'list_extensions') return [];
          if (command === 'get_app_settings') return settings;
          // Reject so useModuleLayout falls back to the default layout (which
          // includes the calendar); returning a non-array would yield an empty
          // layout and the calendar would never render.
          if (command === 'list_module_layout') throw new Error('use default layout');
          return 'ok';
        },
        transformCallback: (callback: unknown) => { const id = 1; Reflect.set(window, `_${id}`, callback); return id; }
      }
    });
  });
  await page.goto('/');
});

test('month event stays inset from both calendar cell borders', async ({ page }) => {
  const event = page.getByRole('button', { name: /边框测试日程/ }).first();
  const cell = page.locator('[data-iso-date="2026-07-08"]');
  await expect(event).toBeVisible();

  const eventBox = (await event.boundingBox())!;
  const cellBox = (await cell.boundingBox())!;
  expect(eventBox.x - cellBox.x).toBeGreaterThanOrEqual(3);
  expect(cellBox.x + cellBox.width - (eventBox.x + eventBox.width)).toBeGreaterThanOrEqual(3);
});

test('today cell is warm subtle without outline and month event content starts top-left', async ({ page }) => {
  const todayCell = page.locator('[data-iso-date="2026-07-15"]');
  const event = page.getByRole('button', { name: /边框测试日程/ }).first();
  await expect(todayCell).toBeVisible();
  await expect(event).toBeVisible();

  const todayStyles = await todayCell.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { backgroundColor: styles.backgroundColor, boxShadow: styles.boxShadow };
  });
  expect(todayStyles.backgroundColor).toBe('rgb(253, 244, 214)');
  expect(todayStyles.boxShadow).toBe('none');

  const eventStyles = await event.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { justifyContent: styles.justifyContent, textAlign: styles.textAlign };
  });
  expect(eventStyles.justifyContent).toBe('flex-start');
  expect(eventStyles.textAlign).toBe('left');

  const eventBox = (await event.boundingBox())!;
  const eventCellBox = (await page.locator('[data-iso-date="2026-07-08"]').boundingBox())!;
  expect(eventBox.y - eventCellBox.y).toBeLessThan(72);
});

test('first spanning and standalone events share the same month-cell top inset', async ({ page }) => {
  const spanningEvent = page.getByRole('button', { name: /全天 今天/ }).first();
  const standaloneEvent = page.getByRole('button', { name: /独立单日日程/ }).first();
  const spanningCell = page.locator('[data-iso-date="2026-07-08"]');
  const standaloneCell = page.locator('[data-iso-date="2026-07-11"]');
  await expect(spanningEvent).toBeVisible();
  await expect(standaloneEvent).toBeVisible();

  const spanningBox = (await spanningEvent.boundingBox())!;
  const standaloneBox = (await standaloneEvent.boundingBox())!;
  const spanningCellBox = (await spanningCell.boundingBox())!;
  const standaloneCellBox = (await standaloneCell.boundingBox())!;
  expect(Math.round(spanningBox.y - spanningCellBox.y)).toBe(
    Math.round(standaloneBox.y - standaloneCellBox.y)
  );
});

test('single-day event sits 4px below a spanning event in the same day cell', async ({ page }) => {
  const spanningEvent = page.getByRole('button', { name: /全天 今天/ }).first();
  const singleEvent = page.getByRole('button', { name: /边框测试日程/ }).first();
  await expect(spanningEvent).toBeVisible();
  await expect(singleEvent).toBeVisible();

  const spanningBox = (await spanningEvent.boundingBox())!;
  const singleBox = (await singleEvent.boundingBox())!;
  expect(Math.round(singleBox.y - (spanningBox.y + spanningBox.height))).toBe(4);
});

test('multi-day and single-day events share the same text left inset', async ({ page }) => {
  const spanningEvent = page.getByRole('button', { name: /全天 今天/ }).first();
  const singleEvent = page.getByRole('button', { name: /边框测试日程/ }).first();
  await expect(spanningEvent).toBeVisible();
  await expect(singleEvent).toBeVisible();

  const paddingLeftOf = (element: Element) => getComputedStyle(element).paddingLeft;
  const spanningPadding = await spanningEvent.evaluate(paddingLeftOf);
  const singlePadding = await singleEvent.evaluate(paddingLeftOf);
  expect(spanningPadding).toBe(singlePadding);
});

test('calendar events show grab on the chip body and pointer on the title', async ({ page }) => {
  const spanningEvent = page.getByRole('button', { name: /全天 今天/ }).first();
  const singleEvent = page.getByRole('button', { name: /边框测试日程/ }).first();
  await expect(spanningEvent).toBeVisible();
  await expect(singleEvent).toBeVisible();

  const cursorOf = (element: Element) => getComputedStyle(element).cursor;
  // The chip body (empty colored area) signals it can be dragged.
  expect(await spanningEvent.evaluate(cursorOf)).toBe('grab');
  expect(await singleEvent.evaluate(cursorOf)).toBe('grab');
  // The title text signals it can be clicked to open the event.
  const titleCursorOf = (element: Element) =>
    getComputedStyle(element.querySelector('.event__title')!).cursor;
  expect(await spanningEvent.evaluate(titleCursorOf)).toBe('pointer');
  expect(await singleEvent.evaluate(titleCursorOf)).toBe('pointer');
});
