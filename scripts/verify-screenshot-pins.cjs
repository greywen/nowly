// Run only against an isolated capture-probe build with local WebView2 CDP enabled.
// Native mouse input is restricted to that process; desktop pixels are not saved.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

const pid = Number(process.env.NOWLY_CAPTURE_PROBE_PID);
assert(Number.isInteger(pid) && pid > 0, 'Set NOWLY_CAPTURE_PROBE_PID to the isolated process ID');
const helper = path.join(__dirname, 'screenshot-pin-native.ps1');
const nativeArgs = args => ['-NoProfile', '-File', helper, '-ProcessId', String(pid), ...args];
const read = () => JSON.parse(execFileSync('powershell', nativeArgs(['-Action', 'read']), { encoding: 'utf8' }));
const rectSize = rect => [rect.Right - rect.Left, rect.Bottom - rect.Top];

async function main() {
  const browser = await chromium.connectOverCDP(process.env.NOWLY_CAPTURE_PROBE_URL || 'http://127.0.0.1:9337');
  const context = browser.contexts()[0];
  let pin;
  let overlay;
  let monitor;
  let isolated = false;
  try {
    const labelled = () => Promise.all(context.pages().map(async page => [
      await page.evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label).catch(() => ''), page
    ]));
    const app = (await labelled()).find(([label]) => label === 'main')?.[1];
    assert(app, 'The probe main window must exist');
    const identifier = await app.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'));
    assert(/^com\.nowly\.capture-probe(?:\.|$)/.test(identifier), 'Refusing to operate on personal app data');
    assert(read().some(window => window.title === `${identifier}-siw`), 'PID does not match the isolated application');
    isolated = true;
    await app.evaluate(() => window.__TAURI_INTERNALS__.invoke('start_screen_capture'));
    const surfaces = (await labelled()).filter(([label]) => /^screenshot-(session|overlay)-1(?:-|$)/.test(label));
    assert.equal(surfaces.length, 2, 'Use a fresh single-display probe for this regression');
    overlay = surfaces.find(([label]) => label.startsWith('screenshot-overlay-'))[1];
    const displayScale = await overlay.evaluate(() => devicePixelRatio);
    const windows = read();
    const placeholder = windows.find(window => window.visible && rectSize(window.rect)[0] > 450 * displayScale
      && rectSize(window.rect)[0] < 750 * displayScale && rectSize(window.rect)[1] < 500 * displayScale);
    assert(placeholder, 'Cannot identify the visible task-switch placeholder');
    // Capture window plugins are restricted; identify the display-filling
    // surfaces from their native rectangles instead.
    const full = windows.filter(window => window.visible && rectSize(window.rect)[0] > 1000 && rectSize(window.rect)[1] > 900 && window.rect.Left === 0);
    assert.equal(full.length, 2, 'Expected a freeze layer and interactive overlay');
    monitor = spawn('powershell', nativeArgs(['-Action', 'monitor']));
    let output = '';
    monitor.stdout.on('data', bytes => { output += bytes; });
    const monitored = new Promise((resolve, reject) => {
      monitor.on('error', reject);
      monitor.on('exit', code => code === 0 ? resolve() : reject(new Error(`Native monitor exited ${code}`)));
    });
    await expect.poll(() => output.includes('READY')).toBe(true);
    await overlay.evaluate(async () => {
      const rgba = new Uint8Array(400 * 200 * 4);
      for (let index = 0; index < rgba.length; index += 4) rgba.set([79, 201, 218, 255], index);
      await window.__TAURI_INTERNALS__.invoke('stage_capture_overlay', rgba, { headers: {
        'x-overlay-version': '0', 'x-overlay-width': '400', 'x-overlay-height': '200'
      } });
      await window.__TAURI_INTERNALS__.invoke('pin_capture', { geometry: {
        x: 200, y: 200, width: 400, height: 200, mosaics: [], version: 0, hasOverlay: true
      } });
    }).catch(error => { if (!/closed/i.test(error.message)) throw error; });
    await monitored;
    const snapshots = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert(snapshots.length > 1, 'Missing native lifecycle observations');
    if (process.env.NOWLY_CAPTURE_PROBE_TRACE === 'true') console.table(snapshots.map(snapshot => ({
      elapsed: snapshot.elapsed,
      placeholder: snapshot.windows.find(window => window.hwnd === placeholder.hwnd)?.visible ?? false,
      layers: full.map(window => snapshot.windows.find(current => current.hwnd === window.hwnd)?.visible ?? false).join(',')
    })));
    for (const snapshot of snapshots) {
      const entry = snapshot.windows.find(window => window.hwnd === placeholder.hwnd);
      const covers = full.filter(window => snapshot.windows.some(current => current.hwnd === window.hwnd && current.visible));
      assert(!entry?.visible || covers.length > 0,
        `Task-switch placeholder was exposed during pin teardown: ${JSON.stringify({ entry, covers: covers.map(window => window.hwnd), snapshot })}`);
    }
    pin = (await labelled()).find(([label]) => label.startsWith('screenshot-pin-'))?.[1];
    assert(pin, 'Pin did not open');
    await pin.waitForSelector('.screenshot-pin__image');
    const pinned = read().find(window => window.title === 'Nowly — pinned image');
    assert(pinned?.visible, 'Pin must be visible');
    const scale = await pin.evaluate(() => devicePixelRatio);
    const lifecycleOnly = process.env.NOWLY_CAPTURE_PROBE_LIFECYCLE_ONLY === 'true';
    for (const [selector, shouldMove] of lifecycleOnly ? [] : [['.screenshot-pin__image', false], ['.screenshot-pin__toolbar', true]]) {
      const before = read().find(window => window.hwnd === pinned.hwnd).rect;
      const point = selector.endsWith('toolbar') ? { x: 80 * scale, y: 20 * scale }
        : { x: (before.Right - before.Left) / 2, y: (before.Bottom - before.Top) / 2 };
      execFileSync('powershell', nativeArgs(['-Action', 'drag', '-Handle', String(pinned.hwnd),
        '-X', String(Math.round(before.Left + point.x)), '-Y', String(Math.round(before.Top + point.y))]), { encoding: 'utf8' });
      const after = read().find(window => window.hwnd === pinned.hwnd).rect;
      assert.deepEqual(rectSize(after), rectSize(before), 'Dragging must not resize the pin');
      if (shouldMove) assert.notDeepEqual([after.Left, after.Top], [before.Left, before.Top], 'Holding toolbar must move the native window');
      else assert.deepEqual([after.Left, after.Top], [before.Left, before.Top], 'Holding image must not move the native window');
    }
    console.log(lifecycleOnly ? 'PASS: native placeholder-first teardown (mouse checks skipped)'
      : 'PASS: native toolbar-only drag and placeholder-first teardown');
  } finally {
    if (monitor && monitor.exitCode === null) monitor.kill();
    try {
      if (overlay && !overlay.isClosed()) await overlay.evaluate(() => window.__TAURI_INTERNALS__.invoke('cancel_screen_capture')).catch(error => {
        if (!/closed/i.test(error.message)) throw error;
      });
      const pins = isolated ? context.pages().filter(page => !page.isClosed()) : [];
      for (const page of pins) {
        const label = await page.evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label).catch(() => '');
        if (label.startsWith('screenshot-pin-')) await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close')).catch(error => {
          if (!/closed/i.test(error.message)) throw error;
        });
      }
    } finally {
      await browser.close();
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
