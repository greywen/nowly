import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOWCASE_SLIDES, screenshotPath } from './showcase-scenes.mjs';
import { CAPTURE_TIME, CAPTURE_TIMEZONE, createShowcaseFixture, createFixtureBackend } from './showcase-fixtures.mjs';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const url = process.env.NOWLY_CAPTURE_URL ?? 'http://127.0.0.1:1420';

async function assertSceneReady(page, fixture) {
  await expect(page.getByTestId('module-grid')).toBeVisible();
  await expect(page.getByTestId('module-frame')).toHaveCount(fixture.layout.length);
  for (const { id } of fixture.layout) {
    const frame = page.locator(`[data-widget-id="${id}"]`);
    await expect(frame).toBeVisible();
    if (id === 'calendar') {
      await expect(frame.getByText(fixture.events[7].title, { exact: true }).first()).toBeVisible();
    } else if (id === 'matrix') {
      await expect(frame.getByTestId('quadrant-scroll')).toHaveCount(4);
      for (const priority of [...new Set(fixture.taskWorkspace.tasks.map(task => task.priority))]) {
        const task = fixture.taskWorkspace.tasks.find(task => task.priority === priority && !task.completed);
        await expect(frame.getByText(task.title, { exact: true }).first()).toBeVisible();
      }
    } else if (id === 'kanban') {
      for (const lane of fixture.taskWorkspace.lanes) {
        await expect(frame.getByText(lane.name, { exact: true }).first()).toBeVisible();
        const card = fixture.taskWorkspace.tasks.find(task => task.laneId === lane.id);
        await expect(frame.getByText(card.title, { exact: true }).first()).toBeVisible();
      }
    } else if (id === 'notes') {
      await expect(frame.getByText(fixture.notes[0].title, { exact: true }).first()).toBeVisible();
      await expect(frame.getByTestId('notes-scroll')).toBeVisible();
    } else if (id === 'time') {
      await expect(frame.getByTestId('time-module')).toHaveAttribute('data-display-content', fixture.timeSettings.displayContent);
      if (fixture.sceneId === 'focus') {
        await expect(frame.getByRole('timer')).toHaveText('18:42');
        await expect(frame.getByRole('button', { name: fixture.language === 'en' ? 'Pause' : '暂停', exact: true })).toBeVisible();
      } else {
        await expect(frame.getByTestId('time-clock')).toHaveCount(3);
        for (const clock of fixture.timeSettings.clocks) await expect(frame.getByText(clock.label, { exact: true })).toBeVisible();
      }
    } else if (id === 'stickers') {
      for (const object of fixture.stickerBoard.objects.filter(object => object.kind === 'text')) await expect(frame.getByText(object.text, { exact: true }).first()).toBeVisible();
      const logo = frame.locator('img');
      await expect(logo).toHaveCount(1);
      await expect.poll(() => logo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    }
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('nowly.language'))).toBe(fixture.language);
  if (fixture.language === 'en') expect(await page.locator('body').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await page.evaluate(() => document.fonts.ready);
}

const browser = await chromium.launch();
try {
  for (const language of ['zh', 'en']) {
    await mkdir(path.join(assets, 'screenshots', language), { recursive: true });
    for (const [sceneId] of SHOWCASE_SLIDES) {
      const fixture = createShowcaseFixture(sceneId, language);
      fixture.logoBytes = [...await readFile(new URL('../../public/logo.png', import.meta.url))];
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: language === 'zh' ? 'zh-CN' : 'en-US', timezoneId: CAPTURE_TIMEZONE, colorScheme: 'light', reducedMotion: 'reduce' });
      const errors = [];
      try {
        // Only the local application and its bundled resources may load.
        const origin = new URL(url).origin;
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await context.addInitScript(({ fixture, backendSource }) => {
          localStorage.clear();
          localStorage.setItem('nowly:onboarding-seen', 'true');
          localStorage.setItem('nowly.language', fixture.language);
          localStorage.setItem('nowly:notes-view', 'board');
          const backend = (0, eval)(`(${backendSource})`)(fixture);
          let callbackId = 0;
          Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
            invoke: async (command, args) => {
              try { return await backend(command, args); }
              catch (error) { window.__showcaseIpcErrors.push(error.message); throw error; }
            },
            transformCallback: (callback, once = false) => {
              const id = ++callbackId;
              window[`_${id}`] = payload => { if (once) delete window[`_${id}`]; callback(payload); };
              return id;
            },
            unregisterCallback: id => { delete window[`_${id}`]; }
          } });
          window.__showcaseIpcErrors = [];
          Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: { unregisterListener: () => {} } });
        }, { fixture, backendSource: createFixtureBackend.toString() });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.setFixedTime(new Date(CAPTURE_TIME));
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await assertSceneReady(page, fixture);
        errors.push(...await page.evaluate(() => window.__showcaseIpcErrors));
        if (errors.length) throw new Error(errors.join('\n'));
        await page.mouse.move(0, 0);
        const destination = path.join(assets, screenshotPath(sceneId, language));
        await page.screenshot({ path: destination, fullPage: true, animations: 'disabled' });
        console.log(`Captured ${language}/${sceneId} -> ${destination}`);
      } catch (error) {
        const alerts = await Promise.all(context.pages().map(page => page.getByRole('alert').allTextContents().catch(() => [])));
        throw new Error(`Showcase capture failed [${language}/${sceneId}] at ${url}: ${error.message}\nAlerts: ${alerts.flat().join('; ') || '(none)'}${errors.length ? `\nApp errors: ${errors.join('; ')}` : ''}`, { cause: error });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
