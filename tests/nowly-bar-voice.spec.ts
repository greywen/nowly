import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 432, height: 200 } });
test.setTimeout(60_000);

async function installBar(page: Page, notificationMode = 'persistent') {
  await page.addInitScript(({ notificationMode }) => {
    localStorage.setItem('nowly.language', 'zh');
    let sequence = 0;
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    const emit = (event: string, payload: unknown) => {
      callbacks.get(listeners.get(event) ?? -1)?.({ event, payload });
    };
    Reflect.set(window, '__barTest', { calls, emit });
    Reflect.set(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { unregisterListener: () => undefined });
    Reflect.set(window, '__TAURI_INTERNALS__', {
      metadata: { currentWindow: { label: 'quick-panel-handle' }, currentWebview: { label: 'quick-panel-handle' } },
      transformCallback: (callback: (event: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push({ command, args });
        if (command === 'plugin:event|listen') { listeners.set(String(args.event), Number(args.handler)); return args.handler; }
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'get_app_settings') return { iconStyle: 'duotone' };
        if (command === 'get_status_island_snapshot') return {
          sampledAt: new Date().toISOString(), events: [], externalEvents: [], tasks: [], reminders: [],
          focus: { status: 'idle', remainingSeconds: 0, plannedSeconds: 0 }, barMenu: [], notificationMode
        };
        if (command === 'voice_state') return { seq: 0, holdKey: 'Ctrl+Super', primed: false, phase: 'idle' };
        if (command === 'set_status_island_visibility' || command === 'get_status_island_presentation'
          || command === 'set_status_island_presence' || command === 'set_status_island_voice') {
          const strip = notificationMode === 'notification'
            && !calls.some(call => call.command === 'set_status_island_voice');
          return { generation: 1, strip };
        }
        return null;
      }
    });
  }, { notificationMode });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.locator('.status-rail__status-presence')).toHaveCSS('width', '288px');
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function voice(page: Page, payload: Record<string, unknown>) {
  await page.evaluate(payload => Reflect.get(window, '__barTest').emit('voice-session', {
    seq: 1, holdKey: 'Ctrl+Super', primed: true, ...payload
  }), payload);
}

const created = () => ({
  phase: 'created', transcript: '今天下午三点安排一个项目讨论会议',
  plan: {
    id: 'plan-1', status: 'committed', createdAt: 0, expiresAt: Date.now() + 600_000, revision: 1,
    actions: [], warnings: [], options: {},
    changes: [{
      key: 'c1', kind: 'createEvent', title: '项目讨论会议', before: null,
      after: { title: '项目讨论会议', startAt: `${today()}T15:00`, endAt: `${today()}T16:00`, allDay: false }
    }]
  }
});

test('prime keeps geometry, listening grows 288→432 and the result lands on the capsule', async ({ page }) => {
  await installBar(page);
  const shell = page.locator('.status-rail__status-presence');
  const logo = page.locator('.status-rail__nowly');
  const logoX = (await logo.boundingBox())!.x;

  await voice(page, { seq: 0, phase: 'idle' });
  await expect(page.locator('.status-rail')).toHaveAttribute('data-voice', 'primed');
  await expect(page.locator('.status-rail__nowly-mic')).toHaveCSS('opacity', '1');
  await expect(shell).toHaveCSS('width', '288px');

  await voice(page, { phase: 'listening', transcript: '' });
  await expect(page.locator('.status-rail')).toHaveAttribute('data-voice-anim', 'grow');
  const transition = await shell.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(transition.split(', ')[0]).toBe('0.28s');
  await expect(shell).toHaveCSS('width', '432px');
  expect((await shell.boundingBox())!.x).toBe(0);
  expect((await shell.boundingBox())!.height).toBe(40);
  // The Logo lane stays put on screen while the shell grows around it.
  expect((await logo.boundingBox())!.x).toBe(logoX);
  await expect(logo).toHaveCSS('opacity', '0');
  const wide = page.locator('.status-rail__voice[data-shown="true"]');
  await expect(wide).toContainText('正在聆听…');
  await expect(wide).toContainText('松开 Ctrl+Win 结束');
  await page.screenshot({ path: test.info().outputPath('listening.png') });

  await voice(page, { phase: 'listening', transcript: '今天下午三点安排一个项目讨论会议，地点在三楼大会议室，提前十分钟提醒我' });
  await expect(wide.locator('.voice-island__title')).toContainText('提前十分钟提醒我');
  const titleBox = (await wide.locator('.voice-island__title').boundingBox())!;
  const lastWordBox = (await wide.locator('.voice-island__title > span').boundingBox())!;
  // Overflow is packed to the end, so the newest words are what is visible.
  expect(Math.round(lastWordBox.x + lastWordBox.width)).toBe(Math.round(titleBox.x + titleBox.width));

  await voice(page, created());
  await expect(page.locator('.status-rail')).toHaveAttribute('data-voice-anim', 'shrink');
  await expect(shell).toHaveCSS('width', '288px');
  const narrow = page.locator('.status-rail__voice[data-shown="true"]');
  await expect(narrow).toHaveAttribute('data-at', 'narrow');
  await expect(narrow).toContainText('项目讨论会议');
  await expect(narrow).toContainText('已创建 · 今天 15:00–16:00');
  await expect(narrow.getByRole('button', { name: '撤销创建：项目讨论会议' })).toBeVisible();
  await expect(logo).toHaveCSS('opacity', '1');
  await expect(page.locator('.status-rail__nowly img')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: test.info().outputPath('created.png') });

  const reports = await page.evaluate(() => (Reflect.get(window, '__barTest').calls as Array<{ command: string; args: { surface?: string } }>)
    .filter(call => call.command === 'set_status_island_voice').map(call => call.args.surface));
  expect(reports).toEqual(['narrow', 'wide', 'narrow']);
});

test('a reversal mid-grow continues from the current width', async ({ page }) => {
  await installBar(page);
  const shell = page.locator('.status-rail__status-presence');
  const { midway, next } = await shell.evaluate(async element => {
    const bar = Reflect.get(window, '__barTest');
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    bar.emit('voice-session', { seq: 1, holdKey: 'Ctrl+Super', primed: true, phase: 'listening', transcript: '' });
    await frame(); await frame(); await frame();
    const midway = element.getBoundingClientRect().width;
    bar.emit('voice-session', { seq: 1, holdKey: 'Ctrl+Super', primed: false, phase: 'idle' });
    await frame(); await frame();
    return { midway, next: element.getBoundingClientRect().width };
  });
  expect(midway).toBeGreaterThan(288);
  expect(midway).toBeLessThan(432);
  // No jump back to 432 or 288: the collapse starts where the grow stopped.
  expect(Math.abs(next - midway)).toBeLessThan(32);
  await expect(shell).toHaveCSS('width', '288px');
});

test('reduced motion switches width at once and shows a still microphone', async ({ page }) => {
  await installBar(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await voice(page, { phase: 'listening', transcript: '' });
  await expect(page.locator('.status-rail__status-presence')).toHaveCSS('width', '432px');
  await expect(page.locator('.voice-wave__static')).toBeVisible();
  await expect(page.locator('.voice-wave__bars')).toBeHidden();
});

test('notification-only mode grows straight from the strip', async ({ page }) => {
  await installBar(page, 'notification');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shell = page.locator('.status-rail__status-presence');
  await expect(page.locator('.status-rail')).toHaveAttribute('data-strip', 'true');
  await voice(page, { phase: 'listening', transcript: '' });
  await expect(page.locator('.status-rail')).toHaveAttribute('data-strip', 'false');
  await expect(shell).toHaveCSS('width', '432px');
  await expect(shell).toHaveCSS('height', '40px');
});
