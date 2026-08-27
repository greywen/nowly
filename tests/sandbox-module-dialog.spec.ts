import { expect, test } from '@playwright/test';

// The dialog surface (spec §11 Q3): a module too small to hold a settings panel
// in its 2x2 card can ask the host to open a second iframe — the same source,
// marked `surface: 'dialog'` at init — inside a host-rendered Dialog that breaks
// out of the card. Both surfaces share one moduleId (one state row), so a save
// on the dialog surface broadcasts `stateChanged` back to the card, which
// reloads. This spec drives the real two-iframe flow in Chrome; jsdom unit tests
// cover the wiring but not the live cross-frame postMessage handshake.

// A self-contained module that renders differently per surface. The main
// surface shows the saved count and a button to open the dialog; the dialog
// surface shows a stepper that saves, plus a Close button. onStateChanged makes
// the main surface reload after the dialog saves.
const DIALOG_MODULE = `
Nowly.defineModule(async ({ host, root }) => {
  async function render() {
    const state = (await host.loadState()) || { count: 0 };
    root.textContent = '';
    if (host.surface === 'dialog') {
      const label = document.createElement('p');
      label.textContent = '设置面板 · 当前 ' + state.count;
      const inc = document.createElement('button');
      inc.textContent = '加一';
      inc.className = 'nm-btn';
      inc.addEventListener('click', async () => {
        await host.saveState({ count: state.count + 1 });
        await render();
      });
      const done = document.createElement('button');
      done.textContent = '完成';
      done.className = 'nm-btn';
      done.addEventListener('click', () => host.closeDialog());
      root.appendChild(label);
      root.appendChild(inc);
      root.appendChild(done);
    } else {
      const value = document.createElement('p');
      value.textContent = '计数：' + state.count;
      const open = document.createElement('button');
      open.textContent = '打开设置';
      open.className = 'nm-btn';
      open.addEventListener('click', () => host.openDialog('模块设置'));
      root.appendChild(value);
      root.appendChild(open);
    }
  }
  host.onStateChanged(() => { void render(); });
  await render();
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((moduleSource: string) => {
    try {
      localStorage.setItem('nowly:onboarding-seen', 'true');
    } catch {
      /* storage disabled */
    }
    const settings = {
      wallpaperEnabled: false,
      launchAtLogin: false,
      targetMonitorId: null,
      density: 'balanced',
      weekStart: 'monday',
      dateFormat: 'localized',
      showWeekends: true
    };
    const extension = {
      id: 'dialog-demo',
      name: '弹框演示',
      description: '',
      source: moduleSource,
      permissions: ['state'],
      allowedHosts: [],
      minW: 2,
      minH: 2,
      defaultW: 2,
      defaultH: 2,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z'
    };
    // The stored layout starts with only the calendar. The sandbox module is
    // added through the picker in the test: `useModuleLayout` normalizes the
    // stored layout once at mount, before extensions load, so a stored
    // `sandbox:` id would be dropped as unknown. Adding it after extensions
    // load mirrors the real add-a-module flow.
    const defaultLayout = [{ id: 'calendar', x: 0, y: 0, w: 7, h: 8 }];
    Reflect.set(window, '__moduleState__', {} as Record<string, string>);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === 'get_app_settings') return settings;
          if (command === 'list_events_in_range') return [];
          if (command === 'list_tasks') return [];
          if (command === 'list_notes') return [];
          if (command === 'list_custom_templates') return [];
          if (command === 'list_extensions') return [extension];
          if (command === 'list_module_layout') return defaultLayout;
          if (command === 'save_module_layout') return args?.layout ?? [];
          if (command === 'get_module_state') {
            const store = Reflect.get(window, '__moduleState__') as Record<string, string>;
            const key = args?.moduleId as string;
            return store[key] ?? null;
          }
          if (command === 'set_module_state') {
            const store = Reflect.get(window, '__moduleState__') as Record<string, string>;
            store[args?.moduleId as string] = args?.state as string;
            return 'ok';
          }
          return 'ok';
        },
        transformCallback: (cb: (payload: unknown) => void) => {
          const id = 1;
          Reflect.set(window, `_${id}`, cb);
          return id;
        }
      }
    });
  }, DIALOG_MODULE);
  await page.goto('/');
});

// Enter edit mode, open the module picker, add the installed module to the
// grid, then leave edit mode so the card renders normally.
async function addDialogModule(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '编辑布局' }).click();
  await page.getByRole('button', { name: '添加模块' }).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('button', { name: '添加弹框演示' }).click();
  await picker.getByRole('button', { name: '关闭' }).click(); // close picker
  await page.getByRole('button', { name: '完成编辑' }).click();
}

test('opens a host-rendered dialog carrying the module dialog surface', async ({ page }) => {
  await addDialogModule(page);
  const card = page.frameLocator('.sandbox-module__frame').first();
  await expect(card.getByText('计数：0')).toBeVisible();

  // Ask the module to open its settings dialog.
  await card.getByRole('button', { name: '打开设置' }).click();

  // The host-rendered Dialog appears with the requested title and holds a
  // second iframe running the dialog surface.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '模块设置' })).toBeVisible();
  const dialogFrame = page.frameLocator('.sandbox-module__frame--dialog');
  await expect(dialogFrame.getByText('设置面板 · 当前 0')).toBeVisible();
});

test('a save on the dialog surface refreshes the main card', async ({ page }) => {
  await addDialogModule(page);
  const card = page.frameLocator('.sandbox-module__frame').first();
  await expect(card.getByText('计数：0')).toBeVisible();
  await card.getByRole('button', { name: '打开设置' }).click();

  const dialogFrame = page.frameLocator('.sandbox-module__frame--dialog');
  await dialogFrame.getByRole('button', { name: '加一' }).click();

  // The dialog surface reflects its own save…
  await expect(dialogFrame.getByText('设置面板 · 当前 1')).toBeVisible();
  // …and the main card reloads via the stateChanged broadcast, so it never
  // shows the stale value.
  await expect(card.getByText('计数：1')).toBeVisible();
});

test('closes the dialog from the module and via Escape', async ({ page }) => {
  await addDialogModule(page);
  const card = page.frameLocator('.sandbox-module__frame').first();
  await card.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // The module's own Close button tears the dialog down.
  await page.frameLocator('.sandbox-module__frame--dialog').getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Reopen and close with Escape from the dialog chrome.
  await card.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
