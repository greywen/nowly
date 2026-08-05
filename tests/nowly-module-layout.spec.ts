import { expect, test, type Page } from '@playwright/test';

// The workspace is a free-form 12x8 tiling grid. In edit mode a module can be
// dragged to any free cell and resized from its bottom-right handle down to its
// own minimum size; moves/resizes that would leave the grid or overlap another
// module are rejected. This spec drives real pointer events in Chrome (jsdom
// unit tests can't exercise the live grid geometry).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Start every run from the default layout.
    try {
      window.localStorage.removeItem('nowly.module-layout');
    } catch {
      // ignore
    }
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'get_app_settings') return settings;
          if (command === 'list_events_in_range') return [];
          if (command === 'list_tasks') return [];
          if (command === 'list_notes') return [];
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

// Reads the persisted layout so assertions test the committed result, not just
// the visual box.
async function storedRect(page: Page, id: string) {
  return page.evaluate((widgetId) => {
    const raw = window.localStorage.getItem('nowly.module-layout');
    if (!raw) return null;
    const layout = JSON.parse(raw) as Array<{ id: string; x: number; y: number; w: number; h: number }>;
    return layout.find((item) => item.id === widgetId) ?? null;
  }, id);
}

async function enterEditMode(page: Page) {
  await page.getByRole('button', { name: '编辑布局' }).click();
}

// The stride of one grid cell in CSS pixels, measured from the live grid box.
async function cellStride(page: Page) {
  const grid = page.getByTestId('module-grid');
  const box = (await grid.boundingBox())!;
  return { col: box.width / 12, row: box.height / 8 };
}

function frame(page: Page, id: string) {
  return page.locator(`.module-frame[data-widget-id="${id}"]`);
}

test('shrinks the calendar with the resize handle and it stays shrunk', async ({ page }) => {
  await enterEditMode(page);
  const calendar = frame(page, 'calendar');
  const handle = calendar.getByTestId('module-frame-resize');
  const start = (await handle.boundingBox())!;
  const stride = await cellStride(page);

  // Calendar starts at 7x8; drag the handle up-left by ~2 cols / ~3 rows.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 - stride.col * 2,
    start.y + start.height / 2 - stride.row * 3,
    { steps: 12 }
  );
  await page.mouse.up();

  // It settles smaller (5x5) and does NOT revert to 7x8.
  await expect.poll(async () => await storedRect(page, 'calendar')).toMatchObject({ w: 5, h: 5 });
});

test('does not shrink the calendar below its minimum size', async ({ page }) => {
  await enterEditMode(page);
  const calendar = frame(page, 'calendar');
  const handle = calendar.getByTestId('module-frame-resize');
  const start = (await handle.boundingBox())!;
  const stride = await cellStride(page);

  // Drag far past the minimum (calendar min is 5x4). Should clamp, not vanish.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 - stride.col * 10,
    start.y + start.height / 2 - stride.row * 10,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect.poll(async () => await storedRect(page, 'calendar')).toMatchObject({ w: 5, h: 4 });
});

test('moves the notes module into a freed cell', async ({ page }) => {
  await enterEditMode(page);

  // Free the top-right by shrinking the calendar first (7x8 -> 5x4).
  const calHandle = frame(page, 'calendar').getByTestId('module-frame-resize');
  const calStart = (await calHandle.boundingBox())!;
  const stride = await cellStride(page);
  await page.mouse.move(calStart.x + calStart.width / 2, calStart.y + calStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    calStart.x + calStart.width / 2 - stride.col * 2,
    calStart.y + calStart.height / 2 - stride.row * 4,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect.poll(async () => await storedRect(page, 'calendar')).toMatchObject({ w: 5, h: 4 });

  // Now drag notes (bottom-right 5x3 at x=7,y=5) left into the freed column 0.
  // Moves only start from the drag handle now, not the body.
  const notes = frame(page, 'notes');
  const handle = notes.getByTestId('module-frame-handle');
  const notesBox = (await handle.boundingBox())!;
  await page.mouse.move(notesBox.x + notesBox.width / 2, notesBox.y + notesBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    notesBox.x + notesBox.width / 2 - stride.col * 7,
    notesBox.y + notesBox.height / 2 - stride.row * 1,
    { steps: 12 }
  );
  await page.mouse.up();

  // It lands somewhere in the freed left/lower area, not back at x=7.
  await expect.poll(async () => (await storedRect(page, 'notes'))?.x).not.toBe(7);
});

test('rejects a move that would overlap another module', async ({ page }) => {
  await enterEditMode(page);

  // Default layout is fully tiled; dragging notes onto the calendar can't land.
  // notes sits at x=7,y=5,w=5,h=3 -> grid-column '8 / span 5', grid-row '6 / span 3'.
  const notes = frame(page, 'notes');
  await expect(notes).toHaveCSS('grid-column-start', '8');

  const handle = notes.getByTestId('module-frame-handle');
  const box = (await handle.boundingBox())!;
  const stride = await cellStride(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - stride.col * 7, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  // A rejected move commits nothing (storage stays empty) and the frame stays
  // at its default column.
  await expect(notes).toHaveCSS('grid-column-start', '8');
  await expect.poll(async () => await storedRect(page, 'notes')).toBeNull();
});
