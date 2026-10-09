// Run against a disposable com.nowly.capture-probe build, never personal app data.
//
// Measures real Bar clicks and reads the native phase log the app writes to
// stderr (pass its path as NOWLY_CAPTURE_PROBE_LOG) for the moment the frozen
// desktop became visible. Desktop pixels are never saved or uploaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, expect } = require('@playwright/test');

function phases(session) {
  const log = process.env.NOWLY_CAPTURE_PROBE_LOG;
  if (!log || !fs.existsSync(log)) return {};
  const found = {};
  for (const line of fs.readFileSync(log, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^capture session=(\d+) phase=(\S+)(.*)$/);
    if (!match || Number(match[1]) !== session) continue;
    const [, , phase, rest] = match;
    const elapsed = rest.match(/elapsed_ms=(\d+)/);
    found[phase] = elapsed ? Number(elapsed[1]) : rest.trim();
    const reused = rest.match(/reused=(\d+)\/(\d+)/);
    if (reused) found.reused = `${reused[1]}/${reused[2]}`;
    const reason = rest.match(/reason=(.*)$/);
    if (reason) found.reason = reason[1];
  }
  return found;
}

/// A refused screen read (locked or switched-away desktop) is environmental, not
/// a startup defect, so it is reported as such rather than as a timeout.
function assertCaptured(session) {
  const native = phases(session);
  if (native.failed !== undefined) {
    throw new Error(`capture session ${session} failed natively: ${native.reason ?? 'unknown'}` +
      (/AccessDenied/.test(native.reason ?? '') ? ' (is the desktop locked?)' : ''));
  }
}

async function main() {
  const browser = await chromium.connectOverCDP(
    process.env.NOWLY_CAPTURE_PROBE_URL || 'http://127.0.0.1:9337'
  );
  let disposable = false;
  try {
    const context = browser.contexts()[0];
    const labelOf = page => page.evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label);
    const labelled = async () =>
      Promise.all(context.pages().map(async page => [await labelOf(page).catch(() => ''), page]));
    const sessionOf = label => Number(label.split('-')[2]);
    const isVisible = page =>
      page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible', {}));

    await expect.poll(async () => {
      const labels = (await labelled()).map(([label]) => label);
      return labels.includes('main') && labels.includes('quick-panel-handle');
    }, { timeout: 15000 }).toBe(true);
    const pages = await labelled();
    const app = pages.find(([label]) => label === 'main')?.[1];
    const bar = pages.find(([label]) => label === 'quick-panel-handle')?.[1];
    assert(app && bar, 'The main app and Bar must be running');
    const invoke = (command, args = {}) => app.evaluate(
      ([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args), [command, args]
    );
    assert.equal(await invoke('plugin:app|identifier'), 'com.nowly.capture-probe');
    disposable = true;
    const settings = await invoke('get_app_settings');
    await invoke('update_app_settings', { settings: { ...settings, barButtons: ['screenshot'] } });

    // Idle may keep the next session's prewarmed windows, but none may be visible.
    const idle = async () => {
      await expect.poll(async () => {
        const capture = (await labelled()).filter(([label]) => label.startsWith('screenshot-'));
        const visible = await Promise.all(capture.map(([, page]) => isVisible(page).catch(() => false)));
        return visible.filter(Boolean).length;
      }, { timeout: 3000 }).toBe(0);
      assert.equal(await invoke('plugin:window|is_visible', { label: 'quick-panel-handle' }), true);
    };
    // The next session's overlay, built hidden and already mounted.
    const prewarmed = async after => {
      let found;
      await expect.poll(async () => {
        for (const [label, page] of await labelled()) {
          if (!label.startsWith('screenshot-overlay-') || sessionOf(label) <= after) continue;
          const mounted = await page.evaluate(() => !!document.querySelector('.screenshot-overlay'))
            .catch(() => false);
          if (mounted) { found = [label, page]; return true; }
        }
        return false;
      }, { timeout: 8000 }).toBe(true);
      return found;
    };
    const visibleOverlay = async session => {
      let found;
      await expect.poll(async () => {
        for (const [label, page] of await labelled()) {
          if (label.startsWith(`screenshot-overlay-${session}-`) && await isVisible(page).catch(() => false)) {
            found = page;
            return true;
          }
        }
        return false;
      }, { timeout: 5000 }).toBe(true);
      return found;
    };
    const cancel = async page => {
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('cancel_screen_capture', {}))
        .catch(error => { if (!/closed/i.test(error.message)) throw error; });
      await idle();
    };
    const start = () => app.evaluate(async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke('start_screen_capture', {});
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    });
    // Models a hung renderer: the session's overlays never acknowledge. Tauri's
    // IPC script looks up `fetch` at call time, while its internals are frozen.
    const blockReadiness = async session => {
      for (const [label, page] of await labelled()) {
        if (!label.startsWith(`screenshot-overlay-${session}-`)) continue;
        await page.evaluate(() => {
          const original = window.fetch;
          window.fetch = (input, ...rest) =>
            String(input).includes('capture_window_ready')
              ? new Promise(() => {})
              : original(input, ...rest);
        });
      }
    };

    await idle();
    await bar.evaluate(() => {
      document.addEventListener('click', event => {
        if (event.target.closest('button')) window.__captureProbeClick = performance.timeOrigin + performance.now();
      }, { capture: true });
    });

    let lastSession = 0;
    const timings = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const [label, warmed] = await prewarmed(lastSession);
      assert.equal(await warmed.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('describe_capture_frame', {})
      ), null, 'A prewarmed overlay must wait without failing before its session starts');
      const session = sessionOf(label);
      const button = bar.getByRole('button', { name: /截屏|截图|screenshot/i, exact: true });
      await expect(button).toBeEnabled();
      const completed = bar.waitForResponse(response => response.url().endsWith('/start_screen_capture'), { timeout: 6000 });
      await button.click();
      const response = await completed;
      await response.finished();
      const finished = Date.now();
      assert.equal(response.status(), 200);
      const clicked = await bar.evaluate(() => window.__captureProbeClick);
      assert(Number.isFinite(clicked), 'The real click must be observed');
      assertCaptured(session);
      const page = await visibleOverlay(session);
      // Pixels for the magnifier arrive after the overlay is usable.
      await expect.poll(() => page.locator('.screenshot-overlay__frame').evaluate(image => (
        image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      )), { timeout: 5000 }).toBe(true);
      const native = phases(session);
      timings.push({
        session,
        clickToInteractiveMs: Math.round(finished - clicked),
        frozenVisibleMs: native['frozen-visible'],
        windowsShownMs: native['windows-shown'],
        reusedOverlays: native.reused
      });
      lastSession = session;
      await cancel(page);
    }
    console.table(timings);

    const [blockedLabel] = await prewarmed(lastSession);
    const blocked = sessionOf(blockedLabel);
    await blockReadiness(blocked);
    const cancelled = start();
    let page;
    await expect.poll(async () => {
      for (const [label, candidate] of await labelled()) {
        if (label.startsWith(`screenshot-overlay-${blocked}-`)) {
          const ready = await candidate.evaluate(() => !!document.querySelector('.screenshot-overlay__frame'))
            .catch(() => false);
          if (ready) { page = candidate; return true; }
        }
      }
      return false;
    }, { timeout: 5000 }).toBe(true);
    const duplicate = await start();
    assert.equal(duplicate.ok, false, 'Duplicate startup must be rejected');
    await cancel(page);
    assert.equal((await cancelled).ok, true);

    const [stalledLabel] = await prewarmed(blocked);
    const stalled = sessionOf(stalledLabel);
    await blockReadiness(stalled);
    const timeoutStart = Date.now();
    const failed = await start();
    assert.equal(failed.ok, false, 'A hung overlay must fail startup');
    assert.match(failed.error.message, /超时/);
    assert(Date.now() - timeoutStart < 7000, 'Startup supervision must remain bounded');
    await idle();
    const retried = await start();
    assert.equal(retried.ok, true, 'Retry after a startup failure must work');
    const retry = stalled + 1;
    console.log('Retry after failure:', phases(retry));
    await cancel(await visibleOverlay(retry));
    console.log('Passed: native freeze, prewarmed overlays, lazy pixels, no visible idle windows, cancellation, duplicate rejection, timeout, recovery.');
  } finally {
    if (disposable) {
      for (const page of browser.contexts()[0].pages()) {
        await page.evaluate(async () => {
          if (window.__TAURI_INTERNALS__.metadata.currentWindow.label.startsWith('screenshot-')) {
            await window.__TAURI_INTERNALS__.invoke('cancel_screen_capture', {});
          }
        }).catch(() => {});
      }
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
