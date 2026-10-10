import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 432, height: 440 } });
test.setTimeout(60_000);

async function openAssistant(page: Page) {
  await page.getByRole('button', { name: 'Nowly', exact: true }).click();
  await page.getByRole('menuitem', { name: 'AI 助手', exact: true }).click();
}

async function installNowlyBar(page: Page) {
  await page.addInitScript(() => {
    let callbackId = 0;
    let panelGeneration = 0;
    const listeners = new Map<string, number>();
    Object.assign(window, {
      __EMIT_TAURI_EVENT__: (event: string, payload: unknown = null) => {
        const handler = listeners.get(event);
        const callback = handler
          ? (window as unknown as Record<string, unknown>)[`_${handler}`]
          : null;
        if (typeof callback === 'function') callback({ event, payload });
      },
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
          if (command === 'toggle_nowly_panel' || command === 'toggle_bar_menu') {
            panelGeneration += 1;
            const handler = listeners.get('status-island-details-open');
            const callback = handler
              ? (window as unknown as Record<string, unknown>)[`_${handler}`]
              : null;
            if (typeof callback === 'function') {
              window.setTimeout(() => callback({
                event: 'status-island-details-open',
                payload: { generation: panelGeneration, source: command === 'toggle_bar_menu' ? 'menu' : 'nowly', identity: null, hovered: false }
              }), 0);
            }
          }
          if (command === 'close_status_island_details') {
            panelGeneration += 1;
            const handler = listeners.get('status-island-details-close');
            const callback = handler
              ? (window as unknown as Record<string, unknown>)[`_${handler}`]
              : null;
            if (typeof callback === 'function') {
              window.setTimeout(() => callback({
                event: 'status-island-details-close',
                payload: { generation: panelGeneration, hideAfterCollapse: false, collapseToSummary: false }
              }), 0);
            }
          }
          return null;
        }
      }
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

test('uses compact Solar glyphs for the embedded voice and send actions', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);

  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await expect(page.getByRole('button', { name: '语音输入' }).locator('svg')).toHaveAttribute('width', '16');

  await input.fill('明天下午三点创建产品评审');
  await expect(page.getByRole('button', { name: '发送请求' }).locator('svg')).toHaveAttribute('width', '16');
});

test('keeps the collapsed Bar unselectable without keyboard focus or pointer active rings', async ({ page }) => {
  await installNowlyBar(page);

  const trigger = page.locator('.status-island__trigger');
  const logo = page.getByRole('button', { name: 'Nowly' });
  await expect(page.locator('.status-rail__header')).toHaveCSS('user-select', 'none');
  await expect(page.locator('.status-rail__nowly img')).toHaveCSS('user-select', 'none');

  for (const control of [trigger, logo]) {
    await control.focus();
    await expect(control).toHaveCSS('outline-style', 'none');
    await expect(control).toHaveCSS('box-shadow', 'none');
    await expect(control).toHaveCSS('appearance', 'none');
    await expect(control).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  }

  for (const control of [trigger, logo]) {
    const restingBackground = await control.evaluate(element => getComputedStyle(element).backgroundColor);
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error('collapsed Bar control has no bounds');
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect(control).toHaveCSS('outline-style', 'none');
    await expect(control).toHaveCSS('box-shadow', 'none');
    await expect(control).toHaveCSS('background-color', restingBackground);
    await page.mouse.up();
  }
});

test('clears the stale status focus ring after Escape collapses the panel', async ({ page }) => {
  await installNowlyBar(page);
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void;
    emit('status-island-details-open', { generation: 1, source: 'island', identity: null });
  });

  const trigger = page.locator('.status-island__trigger');
  await trigger.click();
  await page.keyboard.press('Escape');

  await expect(page.locator('.status-rail')).toHaveAttribute('data-open', 'false');
  await expect(trigger).toHaveCSS('box-shadow', 'none');
  expect(await trigger.evaluate(element => document.activeElement === element)).toBe(false);
});

test('keeps keyboard focus on the status trigger after Escape collapses the panel', async ({ page }) => {
  await installNowlyBar(page);
  const trigger = page.locator('.status-island__trigger');
  await trigger.focus();
  await trigger.press('Enter');
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void;
    emit('status-island-details-open', { generation: 1, source: 'island', identity: null });
  });
  await expect(page.locator('.status-rail')).toHaveAttribute('data-open', 'true');

  await page.keyboard.press('Escape');

  await expect(page.locator('.status-rail')).toHaveAttribute('data-open', 'false');
  expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true);
  await expect(trigger).toHaveCSS('box-shadow', 'none');
});

test('restores text selection without focus rings inside an expanded panel', async ({ page }) => {
  await installNowlyBar(page);
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void;
    emit('status-island-details-open', { generation: 1, source: 'island', identity: null });
  });

  const panel = page.locator('.status-rail__panel');
  const action = page.getByRole('button', { name: '开始专注' });
  const movementNote = page.locator('.status-island__movement-note');
  await expect(panel).toHaveCSS('user-select', 'text');
  await action.focus();
  await expect(action).toHaveCSS('box-shadow', 'none');
  await movementNote.selectText();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('长按拖动');
});

test('crossfades the Logo during status expansion and collapse without waiting for geometry', async ({ page }) => {
  await installNowlyBar(page);
  await expect(page.locator('.status-rail__nowly')).toBeVisible();
  async function sample(open: boolean) {
    return page.evaluate(async (opening) => {
      const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function;
      emit(opening ? 'status-island-details-open' : 'status-island-details-close',
        opening ? { generation: 1, source: 'island', identity: null } : { generation: 2 });
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const logo = document.querySelector('.status-rail__nowly')!;
      for (const animation of logo.getAnimations()) {
        animation.pause();
        animation.currentTime = 35;
      }
      const opacity = Number(getComputedStyle(logo).opacity);
      for (const animation of logo.getAnimations()) animation.finish();
      return opacity;
    }, open);
  }
  const opening = await sample(true);
  expect(opening).toBeGreaterThan(0);
  expect(opening).toBeLessThan(1);
  await expect(page.locator('.status-rail__status-presence')).toHaveCSS('height', '288px');
  const closing = await sample(false);
  expect(closing).toBeGreaterThan(0);
  expect(closing).toBeLessThan(1);
});

test('does not let a pointer activate Nowly while the status shell is still shrinking', async ({ page }) => {
  await installNowlyBar(page);
  const rail = page.locator('.status-rail');
  const shell = page.locator('.status-rail__status-presence');
  await page.evaluate(() => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-open', { generation: 1, source: 'island', identity: null });
  });
  await expect(shell).toHaveCSS('height', '288px');
  await rail.evaluate(element => {
    (element as HTMLElement).style.setProperty('--rail-shrink', '2200ms');
  });

  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect.poll(() => shell.evaluate(element => element.getBoundingClientRect().height))
    .toBeLessThan(260);
  const logo = page.locator('.status-rail__nowly');
  await expect(logo).toHaveAttribute('data-available', 'false');
  const bounds = await logo.boundingBox();
  if (!bounds) throw new Error('Nowly control has no bounds during status collapse');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await expect(rail).toHaveAttribute('data-surface', 'status');
  await expect(page.locator('.status-rail__assistant')).not.toHaveAttribute('data-anim');
});

test('reveals only the status capsule while AI is still closing', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);
  await page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' }).fill('测试收起衔接');
  await page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' }).press('Enter');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('height', '440px');
  const sample = await page.evaluate(async () => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-close', { generation: 2 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const sheet = document.querySelector('.status-rail__sheet')!;
    const presence = document.querySelector('.status-rail__status-presence')!;
    for (const animation of presence.getAnimations()) {
      animation.pause();
      animation.currentTime = 35;
    }
    return {
      visibility: getComputedStyle(sheet).visibility,
      opacity: Number(getComputedStyle(presence).opacity),
      height: presence.getBoundingClientRect().height,
      inert: sheet.hasAttribute('inert'),
      detailVisibility: getComputedStyle(sheet.querySelector('.status-rail__panel')!).visibility
    };
  });
  expect(sample.visibility).toBe('visible');
  expect(sample.opacity).toBeGreaterThan(0);
  expect(sample.opacity).toBeLessThan(1);
  expect(sample.height).toBe(40);
  expect(sample.inert).toBe(true);
  expect(sample.detailVisibility).toBe('hidden');
});

test('keeps the returning status capsule stationary throughout AI collapse', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('检查状态胶囊闪动');
  await input.press('Enter');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('height', '440px');
  const samples = await page.evaluate(async () => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-close', { generation: 2 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const rail = document.querySelector('.status-rail')!;
    const sheet = document.querySelector('.status-rail__sheet')!;
    const animations = rail.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    return [35, 100, 219].map(time => {
      for (const animation of animations) animation.currentTime = time;
      return sheet.getBoundingClientRect().left;
    });
  });
  for (const left of samples) expect(left).toBeCloseTo(72, 1);
});

test('does not wipe the returning status capsule with the opaque closing AI shell', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('检查遮挡闪动');
  await input.press('Enter');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('height', '440px');
  const front = await page.evaluate(async () => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-close', { generation: 2 });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const rail = document.querySelector('.status-rail')!;
    for (const animation of rail.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 20;
    }
    // Probe paint order only. Production exit surfaces remain inert.
    const sheet = document.querySelector('.status-rail__sheet') as HTMLElement;
    const assistant = document.querySelector('.status-rail__assistant') as HTMLElement;
    for (const element of [sheet, assistant]) {
      element.inert = false;
      element.style.setProperty('pointer-events', 'auto', 'important');
    }
    const top = document.elementFromPoint(280, 20);
    return !!top?.closest('.status-rail__sheet');
  });
  expect(front).toBe(true);
});

test('keeps movement help inside the status panel and AI animations out of it on a fresh profile', async ({ page }) => {
  await installNowlyBar(page);
  const statusShell = page.locator('.status-rail__status-presence');
  const sheet = page.locator('.status-rail__sheet');
  const assistant = page.locator('.status-rail__assistant');
  const note = page.locator('.status-island__movement-note');
  await expect(page.locator('.status-island__drag-hint')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '知道了' })).toHaveCount(0);
  await expect(note).toHaveCount(1);
  await expect(note).not.toBeVisible();
  await expect(assistant).not.toHaveAttribute('data-anim');
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (name: string, payload: unknown) => void;
    emit('status-island-details-open', { generation: 0, source: 'island', identity: null });
  });
  await expect(statusShell).toHaveAttribute('data-anim', 'grow');
  await expect(assistant).not.toHaveAttribute('data-anim');
  await expect(note).toBeVisible();
  await expect(note).toHaveCSS('position', 'static');
  await expect(note).toContainText('长按拖动');
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (name: string, payload: unknown) => void;
    emit('status-island-details-close', { generation: 0 });
    emit('status-island-details-closed', { generation: 0 });
  });
  await openAssistant(page);
  await expect(assistant).toHaveAttribute('data-anim', 'grow');
  await expect(statusShell).not.toHaveAttribute('data-anim');
  // The panels are siblings, never nested: the assistant lives in its own frame
  // and the status shell is positioned against the host, so neither can animate
  // the other. The frame is a positioning box only and takes no pointer events.
  expect(await assistant.evaluate(element => element.parentElement?.className))
    .toBe('status-rail__assistant-frame');
  expect(await assistant.evaluate(element =>
    element.closest('.status-rail__status-presence') !== null)).toBe(false);
  await expect(page.locator('.status-rail__assistant-frame')).toHaveCSS('pointer-events', 'none');
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('检查两个面板是否独立');
  await input.press('Enter');
  await expect(assistant).toHaveCSS('height', '440px');
  await expect(note).not.toBeVisible();
  await expect(statusShell).toHaveCSS('height', '40px');
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(assistant).toHaveAttribute('data-anim', 'shrink');
  await expect(statusShell).not.toHaveAttribute('data-anim');
  await expect(page.locator('.status-rail__panel')).toHaveAttribute('inert', '');
  await expect(note).not.toBeVisible();
  expect(await sheet.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(assistant).toHaveCSS('width', '288px');
  await expect(note).not.toBeVisible();
  await expect(page.locator('.status-island__drag-hint')).toHaveCount(0);
});

test('morphs the logo radius and reveals fixed-size content without stretching', async ({ page }) => {
  await installNowlyBar(page);
  const shell = page.locator('.status-rail__assistant');
  await expect(shell).toHaveCSS('border-radius', '20px');
  await openAssistant(page);
  await expect(shell).toHaveCSS('transition-property', 'width, height, border-radius, opacity');
  await expect(shell).toHaveCSS('transition-duration', '0.28s, 0.28s, 0.28s, 0s');
  await expect(shell).toHaveCSS('border-radius', '15.2px');
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.press('Escape');
  await expect(shell).toHaveAttribute('inert', '');
  await expect(shell).toHaveCSS('transition-duration', '0.22s, 0.22s, 0.22s, 0s');
  await expect(shell).toHaveCSS('width', '288px');
  await expect(shell).toHaveCSS('border-radius', '20px');
  await page.evaluate(() => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-closed', { generation: 3 });
  });
  await expect(page.getByRole('button', { name: 'Nowly' })).toBeVisible();
  await openAssistant(page);
  await input.fill('测试面板形变');
  await input.press('Enter');
  await expect(shell).toHaveCSS('height', '440px');
  const geometry = await shell.evaluate(element => {
    const dock = element.querySelector('.assistant-dock')!;
    const style = getComputedStyle(element);
    return {
      childWidth: dock.getBoundingClientRect().width,
      childHeight: dock.getBoundingClientRect().height,
      background: style.backgroundColor,
      transform: getComputedStyle(dock).transform
    };
  });
  expect(geometry).toEqual({
    childWidth: 432, childHeight: 440, background: 'rgb(255, 255, 255)', transform: 'matrix(1, 0, 0, 1, -216, 0)'
  });
  expect(await shell.evaluate(element => {
    const border = getComputedStyle(element, '::before');
    return [border.borderTopWidth, border.pointerEvents];
  })).toEqual(['1px', 'none']);
});

test('disables both independent morphs with reduced motion', async ({ page }) => {
  await installNowlyBar(page);
  const tokens = await page.locator('.status-rail').evaluate(element => {
    const style = getComputedStyle(element);
    return [style.getPropertyValue('--rail-grow'), style.getPropertyValue('--rail-shrink')]
      .map(value => {
        const normalized = value.trim();
        return normalized.endsWith('ms') ? parseFloat(normalized) : parseFloat(normalized) * 1000;
      });
  });
  expect(tokens).toEqual([280, 220]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAssistant(page);
  await expect(page.locator('.status-rail__assistant'))
    .toHaveCSS('transition-duration', '0s, 0s, 0s, 0s');
});

test('morphs status with Logo timing and radius while clipping fixed content', async ({ page }) => {
  await installNowlyBar(page);
  const shell = page.locator('.status-rail__status-presence');
  await expect(shell).toHaveCSS('border-radius', '20px');
  const sample = await page.evaluate(async () => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (name: string, payload: unknown) => void;
    emit('status-island-details-open', { generation: 1, source: 'island', identity: null });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const shell = document.querySelector('.status-rail__status-presence')!;
    for (const animation of shell.getAnimations()) {
      animation.pause();
      animation.currentTime = 70;
    }
    const bounds = shell.getBoundingClientRect();
    const content = shell.querySelector('.status-rail__content')!.getBoundingClientRect();
    const result = {
      width: bounds.width, height: bounds.height,
      radius: parseFloat(getComputedStyle(shell).borderTopLeftRadius),
      contentWidth: content.width, contentHeight: content.height,
      offset: content.left - bounds.left
    };
    for (const animation of shell.getAnimations()) animation.play();
    return result;
  });
  expect(sample.width).toBeGreaterThan(288);
  expect(sample.width).toBeLessThan(432);
  expect(sample.height).toBeGreaterThan(40);
  expect(sample.height).toBeLessThan(288);
  expect(sample.radius).toBeGreaterThan(15.2);
  expect(sample.radius).toBeLessThan(20);
  expect(sample.contentWidth).toBe(430);
  expect(sample.contentHeight).toBe(286);
  expect(sample.offset).toBeCloseTo((sample.width - 430) / 2, 1);
  await expect(shell).toHaveCSS('transition-duration', '0.28s, 0.28s, 0.28s, 0.14s, 0s');
  await expect(shell).toHaveCSS('border-radius', '15.2px');
  const statusClose = page.locator('[data-owner="status"]');
  await expect(statusClose).toHaveCSS('width', '28px');
  await expect(statusClose).toHaveCSS('height', '28px');
  await statusClose.hover();
  await expect(statusClose).toHaveCSS('color', 'rgb(79, 201, 218)');
  await expect(statusClose).toHaveCSS('background-color', 'rgb(246, 241, 233)');
  await expect(page.locator('.status-rail__assistant')).not.toHaveAttribute('data-anim');
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(shell).toHaveCSS('transition-duration', '0.22s, 0.22s, 0.22s, 0.14s, 0s');
  await expect(page.locator('.status-rail__panel')).toHaveAttribute('inert', '');
  await expect(shell).toHaveCSS('height', '40px');
  await expect(shell).toHaveCSS('border-radius', '20px');
  await expect(page.locator('.status-island__movement-note')).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-open', { generation: 3, source: 'island', identity: null });
  });
  await expect(shell).toHaveCSS('transition-duration', '0s, 0s, 0s, 0s, 0s');
  await expect(shell).toHaveCSS('height', '288px');
});

test('morphs directly from the Logo footprint to the full assistant panel', async ({ page }) => {
  await installNowlyBar(page);
  await expect(page.getByRole('button', { name: 'Nowly' })).toBeVisible();
  // Freeze real browser CSS transitions partway through, not a second animation implementation.
  const sample = await page.evaluate(async () => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void)(
      'status-island-details-open', { generation: 1, source: 'nowly', identity: null });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const shell = document.querySelector('.status-rail__assistant')!;
    for (const animation of shell.getAnimations()) {
      animation.pause();
      animation.currentTime = 70;
    }
    const bounds = shell.getBoundingClientRect();
    const dock = shell.querySelector('.assistant-dock')!.getBoundingClientRect();
    return {
      width: bounds.width, radius: parseFloat(getComputedStyle(shell).borderTopLeftRadius),
      childWidth: dock.width, childHeight: dock.height, right: bounds.right, childRight: dock.right
    };
  });
  expect(sample.width).toBeGreaterThan(288);
  expect(sample.width).toBeLessThan(432);
  expect(sample.radius).toBeGreaterThan(15.2);
  expect(sample.radius).toBeLessThan(20);
  expect(sample.childWidth).toBe(432);
  expect(sample.childHeight).toBe(440);
  expect(sample.childRight).toBeCloseTo(432, 1);
});

test('reverses the status morph without restarting or animating the AI panel', async ({ page }) => {
  await installNowlyBar(page);
  const shell = page.locator('.status-rail__status-presence');
  await expect(shell).toBeVisible();
  await page.evaluate(() => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-open', { generation: 1, source: 'island', identity: null });
  });
  await expect(shell).toHaveCSS('height', '288px');
  await page.locator('.status-rail').evaluate(element => {
    (element as HTMLElement).style.setProperty('--rail-grow', '2800ms');
    (element as HTMLElement).style.setProperty('--rail-shrink', '2200ms');
  });
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect.poll(() => shell.evaluate(element => element.getBoundingClientRect().height))
    .toBeLessThan(260);
  const before = await shell.evaluate(element => element.getBoundingClientRect().height);
  expect(before).toBeGreaterThan(80);
  await page.evaluate(() => {
    (Reflect.get(window, '__EMIT_TAURI_EVENT__') as Function)(
      'status-island-details-open', { generation: 3, source: 'island', identity: null });
  });
  const after = await shell.evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(after - before)).toBeLessThan(55);
  await expect(page.locator('.status-rail__panel')).not.toHaveAttribute('inert');
  await expect(page.locator('.status-rail__assistant')).not.toHaveAttribute('data-anim');
  await expect(shell).toHaveCSS('height', '288px');
  await expect(shell).toHaveCSS('border-radius', '15.2px');
});

test('reverses a closing assistant from its current shape instead of restarting at the Logo', async ({ page }) => {
  await installNowlyBar(page);
  const shell = page.locator('.status-rail__assistant');
  await openAssistant(page);
  await expect(shell).toHaveCSS('width', '432px');
  // Slow the same transitions for a stable intermediate-frame assertion.
  await page.locator('.status-rail').evaluate(element => {
    (element as HTMLElement).style.setProperty('--logo-grow', '2800ms');
    (element as HTMLElement).style.setProperty('--logo-shrink', '2200ms');
  });
  await page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' }).press('Escape');
  await expect.poll(() => shell.evaluate(element => element.getBoundingClientRect().width))
    .toBeLessThan(400);
  const before = await shell.evaluate(element => element.getBoundingClientRect().width);
  expect(before).toBeGreaterThan(288);
  await page.evaluate(() => (Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void)(
    'status-island-details-open', { generation: 4, source: 'nowly', identity: null }));
  const after = await shell.evaluate(element => element.getBoundingClientRect().width);
  expect(Math.abs(after - before)).toBeLessThan(55);
  await expect(shell).not.toHaveAttribute('inert');
  await expect(shell).toHaveCSS('width', '432px');
  await expect(shell).toHaveCSS('border-radius', '15.2px');
});

test('clips the expanded assistant to all four rail corners', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('明天下午三点创建产品评审');
  await input.press('Enter');

  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'assistant');
  await expect(page.getByText('需要提醒吗？')).toBeVisible();
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('border-radius', '15.2px');
  await expect(page.locator('.status-rail__assistant')).toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('button', { name: '折叠助手' })).toHaveCount(0);
  const close = page.getByRole('button', { name: '收起' });
  await expect(close).toBeVisible();
  await close.hover();
  await expect(close).toHaveCSS('width', '28px');
  await expect(close).toHaveCSS('height', '28px');
  await expect(close).toHaveCSS('color', 'rgb(79, 201, 218)');
  await expect(close).toHaveCSS('background-color', 'rgb(246, 241, 233)');
  await expect.poll(() => page.locator('.status-rail__assistant').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
  })).toEqual({ width: 432, height: 440 });
  const assistantBox = await page.locator('.status-rail__assistant').boundingBox();
  const composerBox = await page.locator('.assistant-dock--embedded .assistant-composer').boundingBox();
  const panelBox = await page.locator('.assistant-dock--embedded .assistant-panel').boundingBox();
  expect(composerBox?.y).toBeGreaterThan(panelBox?.y ?? Number.POSITIVE_INFINITY);
  expect(Math.abs(
    ((composerBox?.y ?? 0) + (composerBox?.height ?? 0))
    - ((assistantBox?.y ?? 0) + (assistantBox?.height ?? 0))
  )).toBeLessThanOrEqual(1);
  await input.focus();
  await expect(input).toHaveCSS('box-shadow', 'none');
  await expect(input).toHaveCSS('outline-style', 'none');
  await expect(page.locator('.assistant-dock--embedded .assistant-composer'))
    .toHaveCSS('border-top-style', 'dashed');
  const message = page.locator('.assistant-dock--embedded .assistant-chat-message').first();
  await expect(message).toHaveCSS('border-top-style', 'solid');
  await expect(message).toHaveCSS('border-top-width', '1px');
  expect(await page.locator('.assistant-panel-body').evaluate(element =>
    element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('keeps the rail centered while the assistant closes', async ({ page }) => {
  await installNowlyBar(page);
  await openAssistant(page);
  const input = page.getByRole('textbox', { name: '告诉 Nowly 你想做什么' });
  await input.fill('明天下午三点创建产品评审');
  await input.press('Enter');

  await expect(page.locator('.status-rail')).toHaveAttribute('data-surface', 'assistant');
  await expect(page.getByRole('button', { name: '折叠助手' })).toHaveCount(0);
  const close = page.getByRole('button', { name: '收起' });
  await expect(close).toBeVisible();
  await close.click();

  const rail = page.locator('.status-rail');
  await expect(rail).toHaveAttribute('data-assistant-closing', 'true');
  // The returning capsule is the status shell. The rail is now the constant-width
  // host box (408 here), so the shell's own left edge is what must land on 60 and
  // stay there — §12.3's "keeps its final screen position".
  await expect.poll(() => page.locator('.status-rail__status-presence')
    .evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(72);
  await expect(page.locator('.status-rail__sheet')).toHaveCSS('transform', 'none');

  // Native host keeps its width and x; only its bottom edge is removed.
  const beforeResize = await page.locator('.status-rail__sheet').boundingBox();
  await page.setViewportSize({ width: 432, height: 40 });
  await expect(rail).toHaveAttribute('data-assistant-closing', 'true');
  await page.evaluate(() => {
    const emit = Reflect.get(window, '__EMIT_TAURI_EVENT__') as (event: string, payload: unknown) => void;
    emit('status-island-details-closed', { generation: 3 });
  });
  await expect(rail).toHaveAttribute('data-assistant-closing', 'false');
  const afterResize = await page.locator('.status-rail__sheet').boundingBox();
  expect(afterResize?.x).toBeCloseTo(beforeResize?.x ?? Number.NaN, 1);
  expect(afterResize?.width).toBeCloseTo(beforeResize?.width ?? Number.NaN, 1);
  const collapsedStyle = await page.locator('.status-rail__sheet').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      offset: Math.round(new DOMMatrixReadOnly(style.transform).m41),
      transitionDuration: style.transitionDuration,
      animations: element.getAnimations().length
    };
  });
  expect(collapsedStyle).toEqual({
    offset: 0,
    transitionDuration: '0s',
    animations: 0
  });
});
