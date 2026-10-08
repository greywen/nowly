import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';

const FRAME_URL = '/__fixtures__/capture.png';
// Capture surfaces are their own Vite entry (vite.config.ts `screenshot`), not the
// app document: sharing main.tsx would put the dashboard on the startup budget.
const CAPTURE_DOCUMENT = '/screenshot.html';
const TIMEOUT = '\u622a\u56fe\u542f\u52a8\u8d85\u65f6\u3002';

type CaptureCall = {
  command: string;
  args: unknown;
  decoded: boolean | null;
};

type PixelRect = { x: number; y: number; width: number; height: number };
type CaptureScene = {
  originX: number;
  originY: number;
  windowCandidates: PixelRect[];
  holdOutput?: boolean;
  frameUrl?: string;
};

const TOP_WINDOW: PixelRect = { x: 80, y: 90, width: 360, height: 240 };
const WINDOW_SCENE: CaptureScene = {
  originX: -1366,
  originY: -200,
  windowCandidates: [TOP_WINDOW, { x: 30, y: 40, width: 600, height: 440 }]
};

// Only the native boundary is simulated. Routing, image loading/decoding and
// the rendered controls below are the real frontend.
async function installCaptureShell(
  page: Page,
  label: string,
  language = 'zh',
  scene: CaptureScene = { originX: 0, originY: 0, windowCandidates: [] }
) {
  await page.addInitScript(({ label, frameUrl, frameSize, language, scene }) => {
    localStorage.setItem('nowly.language', language);
    const calls: CaptureCall[] = [];
    const decoded = new WeakSet<HTMLImageElement>();
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return decode.call(this).then(() => { decoded.add(this); });
    };
    let callbackId = 0;
    let finish: ((error?: string) => void) | undefined;
    let finishOutput: ((error?: string) => void) | undefined;
    Object.assign(window, {
      __CAPTURE_TEST__: {
        calls,
        finish: (error?: string) => finish?.(error),
        finishOutput: (error?: string) => finishOutput?.(error)
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label },
          currentWebview: { label }
        },
        transformCallback: (callback: unknown) => {
          callbackId += 1;
          Object.assign(window, { [`_${callbackId}`]: callback });
          return callbackId;
        },
        convertFileSrc: () => frameUrl,
        invoke: async (command: string, args?: unknown) => {
          if (command.includes('capture') || command === 'start_screen_capture') {
            const image = document.querySelector<HTMLImageElement>('.screenshot-overlay__frame');
            calls.push({
              command,
              args: command === 'stage_capture_overlay'
                ? { byteLength: (args as Uint8Array).byteLength }
                : args ?? null,
              decoded: image ? decoded.has(image) : null
            });
          }
          if (command === 'start_screen_capture') {
            return new Promise<void>((resolve, reject) => {
              finish = error => error ? reject({ message: error }) : resolve();
            });
          }
          if (command === 'describe_capture_frame') {
            return {
              path: '7/0',
              ...frameSize,
              originX: scene.originX,
              originY: scene.originY,
              windowCandidates: scene.windowCandidates
            };
          }
          if (
            scene.holdOutput
            && (command === 'copy_capture_to_clipboard' || command === 'save_capture_to_file')
          ) {
            return new Promise<boolean | void>((resolve, reject) => {
              finishOutput = error => error
                ? reject({ message: error })
                : resolve(command === 'save_capture_to_file' ? false : undefined);
            });
          }
          if (command === 'get_status_island_snapshot') {
            return {
              sampledAt: '2026-09-30T12:00:00+08:00',
              localDate: '2026-09-30',
              events: [],
              externalEvents: [],
              tasks: [],
              focus: {
                status: 'idle',
                remainingSeconds: 0,
                plannedSeconds: 0,
                sessionId: null,
                stageSequence: 0,
                stageChangedAt: null
              },
              reminders: [],
              notificationMode: 'persistent',
              barButtons: ['screenshot']
            };
          }
          if (command === 'plugin:event|listen') return 1;
          return null;
        }
      }
    });
  }, {
    label,
    frameUrl: scene.frameUrl ?? FRAME_URL,
    frameSize: page.viewportSize()!,
    language,
    scene
  });
}

async function captureCalls(page: Page, command: string): Promise<CaptureCall[]> {
  return page.evaluate(command => {
    const state = Reflect.get(window, '__CAPTURE_TEST__') as { calls: CaptureCall[] };
    return state.calls.filter(call => call.command === command);
  }, command);
}

async function framePng(page: Page) {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    ['#e85b4f', '#349c8a', '#3677bc', '#f2cb61'].forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect((index % 2) * width / 2, Math.floor(index / 2) * height / 2, width / 2, height / 2);
    });
    return canvas.toDataURL('image/png').split(',')[1];
  }, page.viewportSize()!);
  return Buffer.from(base64, 'base64');
}

test('session-scoped window routes to the placeholder and acknowledges readiness', async ({ page }) => {
  await installCaptureShell(page, 'screenshot-session-7');
  await page.goto(CAPTURE_DOCUMENT);

  await expect(page.locator('.screenshot-session')).toBeVisible();
  await expect(page.locator('.screenshot-overlay')).toHaveCount(0);
  await expect.poll(async () => (await captureCalls(page, 'capture_window_ready')).length)
    .toBeGreaterThan(0);
  // Development StrictMode may repeat the effect; the native ACK is idempotent.
  for (const call of await captureCalls(page, 'capture_window_ready')) {
    expect(call).toEqual({ command: 'capture_window_ready', args: {}, decoded: null });
  }
  expect(await captureCalls(page, 'capture_window_failed')).toEqual([]);
  expect(await captureCalls(page, 'describe_capture_frame')).toEqual([]);
});

test('overlay acknowledges only a decoded local PNG and paints its real pixels', async ({ page }, testInfo) => {
  const png = await framePng(page);
  let releaseFrame!: () => void;
  let frameRequested = false;
  const frameGate = new Promise<void>(resolve => { releaseFrame = resolve; });
  await page.route(`**${FRAME_URL}`, async route => {
    frameRequested = true;
    await frameGate;
    await route.fulfill({ contentType: 'image/png', body: png });
  });
  await installCaptureShell(page, 'screenshot-overlay-7-0');
  try {
    await page.goto(CAPTURE_DOCUMENT, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.screenshot-overlay')).toBeVisible();
    await expect.poll(() => frameRequested).toBe(true);
    expect(await captureCalls(page, 'capture_window_ready')).toEqual([]);

    releaseFrame();
    await expect.poll(() => captureCalls(page, 'capture_window_ready')).toEqual([
      { command: 'capture_window_ready', args: {}, decoded: true }
    ]);
    const frame = page.locator('.screenshot-overlay__frame');
    const pixels = await frame.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(element, 0, 0);
      return {
        width: element.naturalWidth,
        height: element.naturalHeight,
        rgba: [
          [0, 0],
          [canvas.width - 1, 0],
          [0, canvas.height - 1],
          [canvas.width - 1, canvas.height - 1]
        ].flatMap(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data))
      };
    });
    expect(pixels).toEqual({
      ...page.viewportSize(),
      rgba: [232, 91, 79, 255, 52, 156, 138, 255, 54, 119, 188, 255, 242, 203, 97, 255]
    });
    const bounds = await page.locator('.screenshot-overlay').boundingBox();
    expect(bounds).toMatchObject({ x: 0, y: 0, ...page.viewportSize() });
    expect(await captureCalls(page, 'capture_window_failed')).toEqual([]);
    const path = testInfo.outputPath('overlay-ready.png');
    await page.screenshot({ path });
    await testInfo.attach('Decoded capture overlay', { path, contentType: 'image/png' });
  } finally {
    releaseFrame();
  }
});

test('corrupt frame reports startup failure instead of readiness', async ({ page }) => {
  await page.route(`**${FRAME_URL}`, route => route.fulfill({
    contentType: 'image/png',
    body: 'invalid PNG bytes'
  }));
  await installCaptureShell(page, 'screenshot-overlay-7-0');
  await page.goto(CAPTURE_DOCUMENT);

  await expect(page.locator('.screenshot-overlay')).toBeVisible();
  await expect.poll(() => captureCalls(page, 'capture_window_failed')).toHaveLength(1);
  expect((await captureCalls(page, 'capture_window_failed'))[0].args).toEqual({});
  expect(await captureCalls(page, 'capture_window_ready')).toEqual([]);
  await expect(page.locator('.screenshot-overlay__note')).toBeVisible();
});

test('cross-origin local frame keeps magnifier pixels readable', async ({ page }, testInfo) => {
  const frameUrl = 'http://nowly-frame.localhost/fixture.png';
  const png = await framePng(page);
  await page.route(frameUrl, route => route.fulfill({
    contentType: 'image/png',
    // This is the protocol's required CORS response. Native response coverage is
    // separate; the browser must also opt into CORS when loading the image.
    headers: {
      'Access-Control-Allow-Origin': new URL(page.url()).origin,
      Vary: 'Origin'
    },
    body: png
  }));
  await installCaptureShell(page, 'screenshot-overlay-7-0', 'en', {
    ...WINDOW_SCENE,
    frameUrl
  });
  await page.goto(CAPTURE_DOCUMENT);
  await expect.poll(() => captureCalls(page, 'capture_window_ready')).toEqual([
    { command: 'capture_window_ready', args: {}, decoded: true }
  ]);
  await page.mouse.move(155, 165);
  await expect(page.locator('.screenshot-magnifier__hex')).toHaveText('#E85B4F');
  const pixel = await page.locator('.screenshot-magnifier__grid')
    .evaluate((canvas: HTMLCanvasElement) => Array.from(
      canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
    ));
  expect(pixel).toEqual([232, 91, 79, 255]);
  const path = testInfo.outputPath('cross-origin-magnifier.png');
  await page.screenshot({ path });
  await testInfo.attach('Cross-origin capture colour sampling', { path, contentType: 'image/png' });
});

async function openSelectionSurface(page: Page, scene: CaptureScene = WINDOW_SCENE) {
  const png = await framePng(page);
  await page.route(`**${FRAME_URL}`, route => route.fulfill({
    contentType: 'image/png',
    body: png
  }));
  await installCaptureShell(page, 'screenshot-overlay-7-0', 'en', scene);
  await page.goto(CAPTURE_DOCUMENT);
  await expect.poll(() => captureCalls(page, 'capture_window_ready')).toEqual([
    { command: 'capture_window_ready', args: {}, decoded: true }
  ]);
  await expect(page.locator('.screenshot-session')).toHaveCount(0);
}

async function expectSelection(page: Page, rect: PixelRect) {
  await expect.poll(() => page.locator('.screenshot-selection__frame').evaluateAll(elements => {
    if (elements.length !== 1) return null;
    const { x, y } = elements[0].getBoundingClientRect();
    const style = getComputedStyle(elements[0]);
    // The content-box border is editor chrome, not selected image pixels.
    return { x, y, width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
  })).toEqual(rect);
}

async function selectTopWindow(page: Page) {
  await page.mouse.click(150, 150);
  await expectSelection(page, TOP_WINDOW);
  await expect(page.getByRole('toolbar')).toBeVisible();
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function selectRectangle(page: Page) {
  await drag(
    page,
    { x: TOP_WINDOW.x, y: TOP_WINDOW.y },
    { x: TOP_WINDOW.x + TOP_WINDOW.width, y: TOP_WINDOW.y + TOP_WINDOW.height }
  );
  await expectSelection(page, TOP_WINDOW);
  await expect(page.getByRole('toolbar')).toBeVisible();
}

async function addRectangle(page: Page) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, { x: 120, y: 120 }, { x: 190, y: 180 });
  await expect(page.locator('.screenshot-annotation[data-kind="rect"]')).toHaveCount(1);
}

async function cursorAt(page: Page): Promise<string> {
  // The computed value, so the inline cursor and any stylesheet rule are judged
  // together rather than trusting the attribute the component wrote.
  return page.locator('.screenshot-overlay').evaluate(
    element => getComputedStyle(element).cursor
  );
}

async function finishOutput(page: Page, error?: string) {  await page.evaluate(error => {
    (Reflect.get(window, '__CAPTURE_TEST__') as {
      finishOutput: (error?: string) => void;
    }).finishOutput(error);
  }, error);
}

test('decoded desktop highlights the topmost frozen window before click selection', async ({ page }, testInfo) => {
  await openSelectionSurface(page);
  await page.mouse.move(150, 150);

  await expectSelection(page, TOP_WINDOW);
  await expect(page.locator('.screenshot-selection__handle')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await page.mouse.move(55, 60);
  await expectSelection(page, WINDOW_SCENE.windowCandidates[1]);
  await page.mouse.move(900, 650);
  await expect(page.locator('.screenshot-selection__frame')).toHaveCount(0);
  await page.mouse.click(900, 650);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);

  await selectTopWindow(page);
  await expect(page.locator('.screenshot-selection__handle')).toHaveCount(8);
  const path = testInfo.outputPath('window-click-selection.png');
  await page.screenshot({ path });
  await testInfo.attach('Committed frozen-window selection', { path, contentType: 'image/png' });
});

test('a deliberate drag overrides the hovered window rectangle', async ({ page }) => {
  await openSelectionSurface(page);
  await page.mouse.move(150, 150);
  await expectSelection(page, TOP_WINDOW);
  await drag(page, { x: 150, y: 150 }, { x: 700, y: 500 });

  await expectSelection(page, { x: 150, y: 150, width: 550, height: 350 });
  await expect(page.locator('.screenshot-selection__handle')).toHaveCount(8);
  await expect(page.getByRole('toolbar')).toBeVisible();
});

test('aiming colour sampling includes the signed display origin without completing capture', async ({ page }) => {
  await openSelectionSurface(page);
  await page.mouse.move(155, 165);
  await page.keyboard.press('Control+c');

  await expect.poll(() => captureCalls(page, 'copy_capture_color')).toHaveLength(1);
  expect((await captureCalls(page, 'copy_capture_color'))[0].args).toEqual({
    x: WINDOW_SCENE.originX + 155,
    y: WINDOW_SCENE.originY + 165
  });
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
});

for (const interruption of ['Escape', 'pointercancel', 'lostpointercapture', 'blur'] as const) {
  test(`${interruption} rolls back selection and object transforms without an undo entry`, async ({ page }) => {
    await openSelectionSurface(page);
    await selectRectangle(page);
    const interrupt = async () => {
      if (interruption === 'Escape') {
        await page.keyboard.press('Escape');
      } else if (interruption === 'blur') {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      } else {
        await page.locator('.screenshot-overlay').dispatchEvent(interruption, {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true
        });
      }
    };

    await page.mouse.move(250, 200);
    await page.mouse.down();
    await page.mouse.move(290, 230, { steps: 3 });
    await expectSelection(page, { ...TOP_WINDOW, x: 120, y: 120 });
    await interrupt();
    await page.mouse.up();
    await expectSelection(page, TOP_WINDOW);
    expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);

    await addRectangle(page);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const rectangle = page.locator('.screenshot-annotation[data-kind="rect"]');
    await expect(rectangle).toHaveAttribute('x', '40');
    await expect(rectangle).toHaveAttribute('y', '30');
    await page.mouse.move(120, 150);
    await page.mouse.down();
    await page.mouse.move(170, 180, { steps: 3 });
    await expect(rectangle).toHaveAttribute('x', '90');
    await expect(rectangle).toHaveAttribute('y', '60');
    await interrupt();
    await page.mouse.up();
    await expect(rectangle).toHaveAttribute('x', '40');
    await expect(rectangle).toHaveAttribute('y', '30');
    expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(rectangle).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expectSelection(page, TOP_WINDOW);
  });
}

test('right-click dismisses the tool, then an empty selection, then the session', async ({ page }) => {
  await openSelectionSurface(page);
  await selectRectangle(page);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.click(300, 250, { button: 'right' });
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expectSelection(page, TOP_WINDOW);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);

  await page.mouse.click(300, 250, { button: 'right' });
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
  await page.mouse.click(300, 250, { button: 'right' });
  await expect.poll(() => captureCalls(page, 'cancel_screen_capture')).toHaveLength(1);
});

test('a committed object can be selected, dragged, nudged and deleted', async ({ page }, testInfo) => {
  await openSelectionSurface(page);
  await selectRectangle(page);
  await addRectangle(page);
  const rectangle = page.locator('.screenshot-annotation[data-kind="rect"]');

  // No trip to the select button first: the rectangle tool is still active, and a
  // press on the shape's own edge must pick it up rather than draw another one.
  await expect(rectangle).toHaveAttribute('x', '40');
  // The cursor says so before the press: the annotation layer takes no pointer
  // events, so this is the only affordance a committed shape has. 120,135 is on the
  // left edge but clear of both the "nw" and "w" grips, so it moves the shape
  // rather than resizing it.
  await page.mouse.move(120, 135);
  await expect.poll(() => cursorAt(page)).toBe('move');
  await page.mouse.move(300, 290);
  await expect.poll(() => cursorAt(page)).toBe('crosshair');
  await page.mouse.move(120, 135);
  await drag(page, { x: 120, y: 135 }, { x: 160, y: 135 });
  await expect(rectangle).toHaveAttribute('x', '80');
  await expect(rectangle).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Select', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rectangle).toHaveAttribute('x', '40');
  await expect(rectangle).toHaveAttribute('y', '30');

  // Pressing the hole in the middle is not the shape, so it clears the selection.
  await page.mouse.click(250, 150);
  await expect(page.locator('[data-selected-for]')).toHaveCount(0);
  await page.mouse.click(120, 135);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
  const path = testInfo.outputPath('object-selected.png');
  await page.screenshot({ path });
  await testInfo.attach('Selected annotation with its handles', { path, contentType: 'image/png' });

  // Dragging commits one undo step, and undo restores the position without
  // removing the shape.
  await drag(page, { x: 120, y: 135 }, { x: 160, y: 155 });
  await expect(rectangle).toHaveAttribute('x', '80');
  await expect(rectangle).toHaveAttribute('y', '50');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rectangle).toHaveAttribute('x', '40');
  await expect(rectangle).toHaveAttribute('y', '30');
  await expect(rectangle).toHaveCount(1);

  // The arrow keys move the object, not the capture rectangle.
  await page.mouse.click(120, 135);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(rectangle).toHaveAttribute('x', '50');
  await expectSelection(page, TOP_WINDOW);

  // Delete removes the object without ending the session.
  await page.keyboard.press('Delete');
  await expect(rectangle).toHaveCount(0);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  await expect(page.getByRole('toolbar')).toBeVisible();
});

test('right-click rolls back only the current drawing and preserves committed annotations', async ({ page }) => {
  await openSelectionSurface(page);
  await selectRectangle(page);
  await addRectangle(page);
  const rectangles = page.locator('.screenshot-annotation[data-kind="rect"]');
  const committed = await rectangles.first().getAttribute('data-id');

  await page.mouse.move(230, 200);
  await page.mouse.down();
  await page.mouse.move(310, 260);
  await expect(rectangles).toHaveCount(2);
  await page.mouse.click(310, 260, { button: 'right' });
  await page.mouse.up();
  await expect(rectangles).toHaveCount(1);
  await expect(rectangles).toHaveAttribute('data-id', committed!);
  await expectSelection(page, TOP_WINDOW);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);

  await page.mouse.click(300, 250, { button: 'right' });
  await expect(page.getByRole('button', { name: 'Select', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(300, 250, { button: 'right' });
  await expect(rectangles).toHaveCount(1);
  await expect(page.getByRole('toolbar')).toBeVisible();
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
});

test('text double-click re-edits while empty-area double-click finishes exactly once', async ({ page }, testInfo) => {
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  const editor = page.locator('.screenshot-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('First note');
  await editor.press('Control+Enter');
  const text = page.locator('.screenshot-annotation[data-kind="text"]');
  await expect(text).toHaveText('First note');
  const originalId = await text.getAttribute('data-id');
  await page.getByRole('button', { name: 'Select', exact: true }).click();

  await page.mouse.dblclick(155, 155);
  await expect(editor).toHaveValue('First note');
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  await editor.fill('Revised note');
  await editor.press('Enter');
  await expect(editor).toHaveValue('Revised note\n');
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  await editor.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  await expect(text).toHaveAttribute('data-id', originalId!);
  await expect(text).toHaveCount(1);
  await expect(text).toContainText('Revised note');
  const path = testInfo.outputPath('annotation-editing.png');
  await page.screenshot({ path });
  await testInfo.attach('Re-edited text annotation', { path, contentType: 'image/png' });

  await page.mouse.dblclick(390, 285);
  await expect.poll(() => captureCalls(page, 'copy_capture_to_clipboard')).toHaveLength(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toHaveLength(1);
  expect(await captureCalls(page, 'stage_capture_overlay')).toHaveLength(1);
  const output = (await captureCalls(page, 'copy_capture_to_clipboard'))[0].args;
  expect(output).toMatchObject({
    geometry: {
      x: WINDOW_SCENE.originX + TOP_WINDOW.x,
      y: WINDOW_SCENE.originY + TOP_WINDOW.y,
      width: TOP_WINDOW.width,
      height: TOP_WINDOW.height,
      hasOverlay: true
    }
  });
  await finishOutput(page);
});

test('toolbar activation and input composition never complete the capture', async ({ page }) => {
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true });
  await rectangle.focus();
  await rectangle.press('Enter');
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await rectangle.dblclick();
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  const editor = page.locator('.screenshot-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Composing text');
  await editor.dispatchEvent('compositionstart');
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('Composing text');
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
  await editor.dispatchEvent('compositionend');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.screenshot-annotation[data-kind="text"]')).toHaveCount(0);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
});

test('output is single-flight and failure retains the selection and annotations for retry', async ({ page }, testInfo) => {
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await addRectangle(page);
  const annotations = page.locator('.screenshot-annotation');
  const before = await annotations.evaluateAll(elements => elements.map(element => element.outerHTML));
  const done = page.getByRole('button', { name: 'Copy image and finish', exact: true });
  await done.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => captureCalls(page, 'copy_capture_to_clipboard')).toHaveLength(1);
  await expect(done).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeDisabled();
  await drag(page, { x: 220, y: 200 }, { x: 310, y: 250 });
  expect(await annotations.evaluateAll(elements => elements.map(element => element.outerHTML))).toEqual(before);
  await expectSelection(page, TOP_WINDOW);

  await finishOutput(page, 'Clipboard is unavailable. Try again.');
  await expect(page.getByRole('alert')).toHaveText('Clipboard is unavailable. Try again.');
  await expect(done).toBeEnabled();
  expect(await annotations.evaluateAll(elements => elements.map(element => element.outerHTML))).toEqual(before);
  await expectSelection(page, TOP_WINDOW);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
  const path = testInfo.outputPath('output-retry.png');
  await page.screenshot({ path });
  await testInfo.attach('Output failure preserves the editor', { path, contentType: 'image/png' });
  await done.click();
  await expect.poll(() => captureCalls(page, 'copy_capture_to_clipboard')).toHaveLength(2);
  await finishOutput(page);
  await expect(done).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cancelled save returns to the same annotated selection', async ({ page }) => {
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await addRectangle(page);
  const save = page.getByRole('button', { name: 'Save as PNG', exact: true });
  await save.click();
  await expect.poll(() => captureCalls(page, 'save_capture_to_file')).toHaveLength(1);
  await expect(save).toBeDisabled();
  // Native returns normally when its save dialog is cancelled.
  await finishOutput(page);
  await expect(save).toBeEnabled();
  await expectSelection(page, TOP_WINDOW);
  await expect(page.locator('.screenshot-annotation[data-kind="rect"]')).toHaveCount(1);
  expect(await captureCalls(page, 'cancel_screen_capture')).toEqual([]);
  expect(await captureCalls(page, 'copy_capture_to_clipboard')).toEqual([]);
});

for (const [language, retry] of [['zh', '\u91cd\u8bd5'], ['en', 'Retry']] as const) {
test(`pending and retry controls retain the 336 by 40 collapsed Bar (${language})`, async ({ page }, testInfo) => {
  await installCaptureShell(page, 'quick-panel-handle', language);
  await page.goto('/');
  const shell = page.locator('.status-rail__status-presence');
  const button = page.locator('.status-rail__app-button[data-app="screenshot"]');
  await expect(button).toBeEnabled();
  await expect(shell).toHaveCSS('width', '336px');
  await expect(shell).toHaveCSS('height', '40px');
  const originalBounds = await shell.boundingBox();

  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  expect(await captureCalls(page, 'start_screen_capture')).toHaveLength(1);
  expect(await shell.boundingBox()).toEqual(originalBounds);
  await page.evaluate(error => {
    (Reflect.get(window, '__CAPTURE_TEST__') as { finish: (error?: string) => void }).finish(error);
  }, TIMEOUT);

  await expect(button).toBeEnabled();
  await expect(button).toHaveText(retry);
  await expect(button).toHaveAttribute('data-error', 'true');
  await expect(button).toHaveAttribute('title', new RegExp(TIMEOUT));
  expect(await shell.boundingBox()).toEqual(originalBounds);
  const textBounds = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('span')!);
    const text = range.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      fits: text.left >= bounds.left && text.right <= bounds.right
        && text.top >= bounds.top && text.bottom <= bounds.bottom,
      overflows: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
    };
  });
  expect(textBounds).toEqual({ width: 48, height: 40, fits: true, overflows: false });
  await expect(page.locator('.status-rail')).toHaveAttribute('data-open', 'false');
  const path = testInfo.outputPath('bar-capture-retry.png');
  await shell.screenshot({ path });
  await testInfo.attach('Capture retry fits the collapsed Bar', { path, contentType: 'image/png' });

  await button.click();
  await expect(button).toBeDisabled();
  expect(await captureCalls(page, 'start_screen_capture')).toHaveLength(2);
  await page.evaluate(() => {
    (Reflect.get(window, '__CAPTURE_TEST__') as { finish: () => void }).finish();
  });
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('data-error');
  await expect(button.locator('svg')).toBeVisible();
  expect(await shell.boundingBox()).toEqual(originalBounds);
});
}

test('a committed CJK text object is grabbable across its real width', async ({ page }) => {
  // Reported as "after typing text, putting the pointer at its edge does not show a
  // move cursor". The box came from `content.length * fontSize * 0.6`, which bills a
  // full-width glyph at 0.6em, so the right half of the text was not the object.
  // This runs in a real browser because that is the only place the text is actually
  // measured; jsdom has no canvas text metrics and falls back to an estimate.
  await openSelectionSurface(page);
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(120, 140);
  const editor = page.getByRole('textbox', { name: 'Annotation text' });
  await editor.fill('你好世界');
  await editor.press('Control+Enter');

  const text = page.locator('.screenshot-annotation[data-kind="text"]');
  await expect(text).toHaveCount(1);
  const box = await text.evaluate(element => ({
    width: Number(element.getAttribute('data-width')),
    fontSize: Number(element.getAttribute('font-size'))
  }));
  // Four full-width glyphs are four ems wide, not 2.4.
  expect(box.width).toBeGreaterThanOrEqual(box.fontSize * 4);

  // And the pointer agrees: the far end of the text is part of the object.
  const painted = await text.boundingBox();
  await page.mouse.move(painted!.x + painted!.width - 4, painted!.y + painted!.height / 2);
  await expect.poll(() => cursorAt(page)).toBe('move');
});

test('a committed shape is restyled by the property panel, not only the next one', async ({ page }) => {
  // Reported as "circles, arrows, rectangles and lines cannot be edited afterwards".
  await openSelectionSurface(page);
  await selectRectangle(page);
  await addRectangle(page);
  const shape = page.locator('.screenshot-annotation[data-kind="rect"]');
  const drawnColour = await shape.getAttribute('stroke');
  const drawnWidth = await shape.getAttribute('stroke-width');

  await page.mouse.click(120, 150);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);

  // The panel follows the selected object, so a different swatch restyles it.
  await page
    .locator(`[role="radio"][aria-label^="Colour"]:not([data-value="${drawnColour}"])`)
    .first()
    .click();
  await expect.poll(() => shape.getAttribute('stroke')).not.toBe(drawnColour);
  await expect(shape).toHaveCount(1);

  // Thickness too, and it is one undo step that restores the old value rather than
  // removing the shape.
  await page
    .locator('[role="radio"][aria-label^="Stroke width"][aria-checked="false"]')
    .first()
    .click();
  await expect.poll(() => shape.getAttribute('stroke-width')).not.toBe(drawnWidth);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shape).toHaveAttribute('stroke-width', drawnWidth!);
  await expect(shape).toHaveCount(1);
});

test('a selected shape shows eight grips and resizes by them', async ({ page }, testInfo) => {
  await openSelectionSurface(page);
  await selectRectangle(page);
  await addRectangle(page);
  const shape = page.locator('.screenshot-annotation[data-kind="rect"]');

  await page.mouse.click(120, 150);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
  await expect(page.locator('[data-handle]')).toHaveCount(8);

  const path = testInfo.outputPath('object-handles.png');
  await page.screenshot({ path });
  await testInfo.attach('Selected shape with eight grips', { path, contentType: 'image/png' });

  // The grip names the axis before the press, so the drag is predictable.
  const grip = page.locator('[data-handle="se"]');
  const at = await grip.boundingBox();
  const centre = { x: at!.x + at!.width / 2, y: at!.y + at!.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await expect.poll(() => cursorAt(page)).toBe('nwse-resize');

  const before = {
    width: Number(await shape.getAttribute('width')),
    height: Number(await shape.getAttribute('height'))
  };
  await drag(page, centre, { x: centre.x + 40, y: centre.y + 30 });

  await expect
    .poll(async () => Number(await shape.getAttribute('width')))
    .toBeGreaterThan(before.width);
  // The pinned corner did not move.
  await expect(shape).toHaveAttribute('x', '40');
  await expect(shape).toHaveAttribute('y', '30');
  await expect(shape).toHaveCount(1);

  // One undo step, restoring the size rather than deleting the shape.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(shape).toHaveAttribute('width', String(before.width));
  await expect(shape).toHaveAttribute('height', String(before.height));
  await expect(shape).toHaveCount(1);
});

test('an arrow gets two end grips and can be re-aimed', async ({ page }) => {
  // A box would be a lie for an arrow: an arrow and its opposite share a box, so
  // eight grips could not express which way it points.
  await openSelectionSurface(page);
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await drag(page, { x: 120, y: 120 }, { x: 200, y: 180 });
  const arrow = page.locator('.screenshot-annotation[data-kind="arrow"]');
  await expect(arrow).toHaveCount(1);

  await page.mouse.click(160, 150);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
  await expect(page.locator('[data-handle]')).toHaveCount(2);
  await expect(page.locator('[data-handle="start"]')).toHaveCount(1);
  await expect(page.locator('[data-handle="end"]')).toHaveCount(1);

  // Dragging the tail moves only that end; the tip stays put. The arrow renders as
  // a group, so its geometry is read from the stored box rather than from an `x2`.
  // The painted bounding box is not usable here: it includes the arrowhead barbs,
  // which move as the angle changes even when the tip does not.
  const before = await arrow.evaluate(element => ({
    x: Number(element.getAttribute('data-x')),
    y: Number(element.getAttribute('data-y')),
    width: Number(element.getAttribute('data-width')),
    height: Number(element.getAttribute('data-height'))
  }));
  const tip = { x: before.x + before.width, y: before.y + before.height };
  const grip = await page.locator('[data-handle="start"]').boundingBox();
  await drag(
    page,
    { x: grip!.x + grip!.width / 2, y: grip!.y + grip!.height / 2 },
    { x: 140, y: 240 }
  );
  await expect(arrow).toHaveCount(1);

  const after = await arrow.evaluate(element => ({
    x: Number(element.getAttribute('data-x')),
    y: Number(element.getAttribute('data-y')),
    width: Number(element.getAttribute('data-width')),
    height: Number(element.getAttribute('data-height'))
  }));
  // The tip is exactly where it was: only the grabbed end moved.
  expect({ x: after.x + after.width, y: after.y + after.height }).toEqual(tip);
  // And the tail did move, below where it started.
  expect(after.y).toBeGreaterThan(before.y);
});

test('a selected text object gets no grips, only a frame', async ({ page }) => {
  // Its box is measured from the glyphs, so a grip could only stretch the letters
  // or set a size outside the three §5.2 allows. The property panel owns the size.
  await openSelectionSurface(page);
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(120, 140);
  const editor = page.getByRole('textbox', { name: 'Annotation text' });
  await editor.fill('Nowly');
  await editor.press('Control+Enter');
  const text = page.locator('.screenshot-annotation[data-kind="text"]');
  await expect(text).toHaveCount(1);

  const painted = await text.boundingBox();
  await page.mouse.click(painted!.x + 4, painted!.y + painted!.height / 2);

  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
  await expect(page.locator('[data-handle]')).toHaveCount(0);
});

test('exporting with a shape still selected succeeds and keeps the chrome out of the DOM it rasterises', async ({ page }) => {
  // The payload is a rasterised PNG, so the grips cannot be checked by reading it;
  // `rasterize.test.ts` asserts the strip on the markup directly. What this covers
  // is the part only a real browser can: exporting while the frame and its grips
  // are on screen still produces exactly one call, and the element handed to the
  // rasteriser keeps every grip inside the group that gets removed.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await addRectangle(page);
  await page.mouse.click(120, 150);
  await expect(page.locator('[data-handle]')).toHaveCount(8);

  const orphans = await page
    .locator('.screenshot-annotations')
    .evaluate(
      svg =>
        Array.from(svg.querySelectorAll('[data-handle]')).filter(
          handle => !handle.closest('[data-selected-for]')
        ).length
    );
  expect(orphans).toBe(0);

  await page.getByRole('button', { name: 'Copy image and finish', exact: true }).click();
  await expect.poll(() => captureCalls(page, 'copy_capture_to_clipboard')).toHaveLength(1);
});

test('clicking elsewhere with the text tool commits the note and leaves text entry', async ({ page }) => {
  // Reported twice: first that the typed text was lost, then that a click should
  // finish text entry rather than continue it. One click commits and stops; the
  // next click starts a new note.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  const editor = page.locator('.screenshot-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('First note');

  // One click on empty frame, far from the note.
  await page.mouse.click(260, 240);

  // Committed, and the editor is gone rather than reopened at the click.
  const texts = page.locator('.screenshot-annotation[data-kind="text"]');
  await expect(texts).toHaveCount(1);
  await expect(texts.first()).toHaveText('First note');
  await expect(editor).toHaveCount(0);

  // The tool is still armed, so the next click does start a new note.
  await page.mouse.click(260, 240);
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('');
  await editor.fill('Second note');
  await editor.press('Control+Enter');
  await expect(texts).toHaveCount(2);

  // The second note is at its own click, not stacked on the first.
  const positions = await texts.evaluateAll(nodes =>
    nodes.map(node => ({
      x: Number(node.getAttribute('data-x')),
      y: Number(node.getAttribute('data-y'))
    }))
  );
  expect(positions[1].x).toBeGreaterThan(positions[0].x);
  expect(positions[1].y).toBeGreaterThan(positions[0].y);
});

test('Escape still discards the draft rather than committing it on the next click', async ({ page }) => {
  // The surface now commits an open editor on the next press. Esc must still win:
  // it unmounts the editor first, so there is no draft left for the press to
  // commit, and the discarded text must not reappear.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  const editor = page.locator('.screenshot-text-editor');
  await editor.fill('Discard me');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);

  await page.mouse.click(260, 240);

  // The discarded text was never committed, and this press starts a fresh note
  // because Esc already closed the editor — there was nothing left to finish.
  await expect(page.locator('.screenshot-annotation[data-kind="text"]')).toHaveCount(0);
  await expect(editor).toHaveValue('');
});

test('clicking onto an existing shape commits the open note without selecting it', async ({ page }) => {
  // The press is consumed by finishing the note, so it does not also act on what
  // it landed on. Otherwise one click would both commit text and start dragging a
  // shape, which is two edits from one gesture.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await addRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(260, 240);
  const editor = page.locator('.screenshot-text-editor');
  await editor.fill('Note');

  // 120,135 is on the rectangle's left edge, clear of its grips.
  await page.mouse.click(120, 135);

  await expect(page.locator('.screenshot-annotation[data-kind="text"]')).toHaveCount(1);
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-selected-for]')).toHaveCount(0);

  // A second click, with nothing open, does select it.
  await page.mouse.click(120, 135);
  await expect(page.locator('[data-selected-for]')).toHaveCount(1);
});

test('an empty editor left behind commits nothing and closes', async ({ page }) => {
  // Clicking away from an untouched editor must not create an empty object, and
  // §5.3 says empty text is not an object at all. It should also close, for the
  // same reason a typed one does.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  await expect(page.locator('.screenshot-text-editor')).toBeVisible();

  await page.mouse.click(260, 240);

  await expect(page.locator('.screenshot-annotation[data-kind="text"]')).toHaveCount(0);
  await expect(page.locator('.screenshot-text-editor')).toHaveCount(0);
});

test('clicking away while re-editing keeps the edit instead of losing it', async ({ page }) => {
  // The same bug on the re-edit path: that editor is seeded with existing content,
  // so losing the draft would silently revert the object.
  await openSelectionSurface(page, { ...WINDOW_SCENE, holdOutput: true });
  await selectRectangle(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(130, 140);
  const editor = page.locator('.screenshot-text-editor');
  await editor.fill('First');
  await editor.press('Control+Enter');
  const text = page.locator('.screenshot-annotation[data-kind="text"]');
  await expect(text).toHaveText('First');
  const id = await text.getAttribute('data-id');

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.dblclick(140, 150);
  await expect(editor).toHaveValue('First');
  await editor.fill('Second');
  await page.mouse.click(300, 260);

  // Same object, new content: a re-edit is an update, not a replacement.
  await expect(text).toHaveCount(1);
  await expect(text).toHaveAttribute('data-id', id!);
  await expect(text).toHaveText('Second');
  // And the edit is over, rather than moving to where the click landed.
  await expect(editor).toHaveCount(0);
});
