import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 288, height: 288 } });

async function installNowlyBar(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('status-island-drag-hint-seen', 'true');
    let callbackId = 0;
    const listeners = new Map<string, number>();
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
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
          if (command === 'plugin:event|listen' && args?.event && args.handler) {
            listeners.set(args.event, args.handler);
            return 1;
          }
          if (command === 'get_status_island_snapshot') {
            return {
              sampledAt: '2026-09-17T12:00:00+08:00',
              localDate: '2026-09-17',
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
              reminders: []
            };
          }
          if (command === 'assistant_get_config') {
            return {
              endpoint: 'https://example.com/v1',
              model: 'fixture-model',
              hasKey: true,
              permissions: { calendar: true, tasks: true, external: false }
            };
          }
          if (command === 'assistant_interpret') {
            return { kind: 'clarify', message: '需要提醒吗？', records: [], plan: null };
          }
          if (command === 'toggle_nowly_panel') {
            const handler = listeners.get('status-island-details-open');
            const callback = handler
              ? (window as unknown as Record<string, unknown>)[`_${handler}`]
              : null;
            if (typeof callback === 'function') {
              window.setTimeout(() => callback({
                event: 'status-island-details-open',
                payload: { source: 'nowly', identity: null, hovered: false }
              }), 0);
            }
          }
          return null;
        }
      }
    });
  });
  await page.goto('/');
}

test('uses compact Solar glyphs for the embedded voice and send actions', async ({ page }) => {
  await installNowlyBar(page);
  await page.getByRole('button', { name: 'Nowly' }).click();

  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await expect(page.getByRole('button', { name: '语音输入' }).locator('svg')).toHaveAttribute('width', '16');

  await input.fill('明天下午三点创建产品评审');
  await expect(page.getByRole('button', { name: '发送请求' }).locator('svg')).toHaveAttribute('width', '16');
});

test('clips the expanded assistant to all four rail corners', async ({ page }) => {
  await installNowlyBar(page);
  await page.getByRole('button', { name: 'Nowly' }).click();
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('明天下午三点创建产品评审');
  await input.press('Enter');

  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'assistant');
  await expect(page.getByText('需要提醒吗？')).toBeVisible();
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('border-radius', '15.2px');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('overflow', 'hidden');
  await expect(page.locator('.assistant-dock--embedded .assistant-panel'))
    .toHaveCSS('border-top-style', 'dashed');
  await expect(page.locator('.assistant-dock--embedded .assistant-chat-message').first())
    .toHaveCSS('border-style', 'dashed');

  await page.evaluate(() => {
    const dock = document.querySelector('.assistant-dock--embedded');
    if (!dock) throw new Error('embedded assistant not found');
    const bottomDivider = document.createElement('div');
    bottomDivider.className = 'assistant-change-header test-bottom-divider';
    const topDivider = document.createElement('div');
    topDivider.className = 'assistant-editor test-top-divider';
    dock.append(bottomDivider, topDivider);
  });
  await expect(page.locator('.test-bottom-divider')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.test-bottom-divider')).toHaveCSS('border-bottom-style', 'dashed');
  await expect(page.locator('.test-top-divider')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.locator('.test-top-divider')).toHaveCSS('border-bottom-width', '0px');
});
