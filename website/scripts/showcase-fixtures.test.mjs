import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scenes = await import('./showcase-scenes.mjs').catch(() => ({}));
const fixtures = await import('./showcase-fixtures.mjs').catch(() => ({}));
const ids = ['workspace', 'kanban', 'notes', 'time', 'focus', 'stickers', 'project', 'study'];

test('exports eight stable scene IDs, existing captions and safe localized paths', async () => {
  assert.ok(Array.isArray(scenes.SHOWCASE_SLIDES), 'SHOWCASE_SLIDES must be exported');
  assert.deepEqual(scenes.SHOWCASE_SLIDES.map(slide => slide[0]), ids);
  assert.deepEqual(scenes.SHOWCASE_SLIDES[0], ['workspace', '工作桌面', 'Workspace', '日历、四象限与便签，一起安排今天。', 'Plan your day with calendar, priorities and notes.']);
  assert.ok(scenes.SHOWCASE_SLIDES.every(slide => slide.length === 5 && slide.every(value => typeof value === 'string' && value.length > 0)));
  for (const id of ids) for (const language of ['zh', 'en']) {
    assert.equal(scenes.screenshotPath(id, language), `screenshots/${language}/${id}.png`);
  }
  assert.throws(() => scenes.screenshotPath('../secret', 'en'));
  assert.throws(() => scenes.screenshotPath('time', 'fr'));
});

test('layouts fit the real grid without overlaps and preserve approved combinations', () => {
  assert.equal(typeof scenes.getSceneLayout, 'function');
  for (const id of ids) {
    const layout = scenes.getSceneLayout(id);
    const occupied = new Set();
    for (const item of layout) {
      assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= 12 && item.y + item.h <= 8);
      for (let x = item.x; x < item.x + item.w; x++) for (let y = item.y; y < item.y + item.h; y++) {
        assert.ok(!occupied.has(`${x},${y}`), `${id} overlaps`);
        occupied.add(`${x},${y}`);
      }
    }
  }
  assert.deepEqual(scenes.getSceneLayout('project'), [
    { id: 'calendar', x: 0, y: 0, w: 5, h: 8 }, { id: 'kanban', x: 5, y: 0, w: 7, h: 5 }, { id: 'notes', x: 5, y: 5, w: 7, h: 3 }
  ]);
  assert.deepEqual(scenes.getSceneLayout('study'), [
    { id: 'matrix', x: 0, y: 0, w: 6, h: 5 }, { id: 'notes', x: 0, y: 5, w: 6, h: 3 }, { id: 'time', x: 6, y: 0, w: 6, h: 4 }, { id: 'stickers', x: 6, y: 4, w: 6, h: 4 }
  ]);
  const layout = scenes.getSceneLayout('project'); layout[0].w = 1;
  assert.equal(scenes.getSceneLayout('project')[0].w, 5);
});

for (const language of ['zh', 'en']) test(`${language} fixtures use rich, isolated, valid app contracts`, () => {
  assert.equal(typeof fixtures.createShowcaseFixture, 'function');
  for (const scene of ids) {
    const data = fixtures.createShowcaseFixture(scene, language);
    assert.equal(data.language, language);
    assert.deepEqual(data.layout, scenes.getSceneLayout(scene));
    assert.ok(data.events.length >= 12 && data.events.length <= 16);
    for (const event of data.events) {
      assert.match(event.startAt, /^2026-10-/); assert.ok(Date.parse(event.endAt) > Date.parse(event.startAt));
      assert.ok(data.categories.some(category => category.id === event.category));
    }
    const workspace = data.taskWorkspace;
    for (const priority of ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent']) {
      const tasks = workspace.tasks.filter(task => task.views.includes('matrix') && task.priority === priority);
      assert.ok(tasks.length >= 2 && tasks.length <= 3);
    }
    for (const lane of workspace.lanes) {
      const cards = workspace.tasks.filter(task => task.views.includes('kanban') && task.laneId === lane.id);
      assert.ok(cards.length >= 3 && cards.length <= 4);
      for (const card of cards) {
        assert.ok(card.tagIds.length && card.tagIds.every(id => workspace.tags.some(tag => tag.id === id)));
        assert.match(card.dueDate, /^2026-10-/);
      }
    }
    assert.ok(data.notes.length >= 5 && data.notes.length <= 6);
    assert.ok(data.notes.every(note => note.content.length > 45));
    assert.equal(data.timeSettings.clocks.length, 3);
    if (language === 'en') {
      assert.equal(data.timeSettings.appearance.showDate, false, 'App clock date formatter is Chinese-only');
      assert.equal(data.timeSettings.appearance.showDifference, false, 'App offset formatter is Chinese-only');
    }
    assert.equal(data.timeSettings.displayContent, scene === 'focus' ? 'focus' : 'clocks');
    assert.equal(data.focusSnapshot.status, scene === 'focus' ? 'running' : 'idle');
    assert.equal(data.focusSnapshot.plannedSeconds, data.focusSnapshot.remainingSeconds + data.focusSnapshot.focusedSeconds);
    if (scene === 'focus') { assert.ok(data.focusSnapshot.sessionId); assert.ok(data.focusSnapshot.stageSequence > 0); }
    assert.ok(data.stickerBoard.objects.length >= 6);
    const image = data.stickerBoard.objects.find(object => object.kind === 'image');
    assert.ok(image, 'Showcase must include a Nowly logo image sticker');
    assert.match(image.assetId, /^[a-f0-9]{32}$/);
    const texts = data.stickerBoard.objects.filter(object => object.kind === 'text');
    assert.ok(texts.some(object => object.rotation < 0) && texts.some(object => object.rotation > 0));
    assert.ok(texts.some(object => /\p{Extended_Pictographic}/u.test(object.text)));
    assert.ok(data.notes.some(note => note.pinned && note.icon));
    assert.ok(data.notes.filter(note => note.icon).length >= 3);
    for (const object of data.stickerBoard.objects) {
      assert.ok(object.x + object.width <= 800 && object.y + object.height <= 600);
      if (object.kind === 'text') assert.ok(object.height >= object.fontSize * 1.5, 'Sticker must fit the actual text line height');
    }
    if (language === 'en') assert.doesNotMatch(JSON.stringify(data), /[\u3400-\u9fff]/);
    data.notes[0].title = 'modified';
    assert.notEqual(fixtures.createShowcaseFixture(scene, language).notes[0].title, 'modified');
  }
  assert.throws(() => fixtures.createShowcaseFixture('unknown', language));
});

test('capture uses scene metadata, isolated contexts, fixed timezone and localized output', async () => {
  const source = await readFile(new URL('./capture-workspace.mjs', import.meta.url), 'utf8');
  for (const token of ['SHOWCASE_SLIDES', 'screenshotPath', 'createShowcaseFixture', 'createFixtureBackend', 'browser.newContext', 'timezoneId: CAPTURE_TIMEZONE', 'mkdir', 'assertSceneReady', "['zh', 'en']"]) assert.ok(source.includes(token), `Capture must use ${token}`);
  assert.ok(!source.includes('browser.newPage'));
});

test('IPC serves actual snapshot, range filtering and rejects unsupported commands', async () => {
  assert.equal(typeof fixtures.createFixtureBackend, 'function');
  const data = fixtures.createShowcaseFixture('focus', 'en');
  data.logoBytes = [137, 80, 78, 71];
  const invoke = fixtures.createFixtureBackend(data);
  assert.deepEqual(await invoke('read_sticker_image', { id: '00000000000000000000000000000001' }), data.logoBytes);
  await assert.rejects(() => invoke('read_sticker_image', { id: 'unknown' }), /Missing showcase/);
  assert.deepEqual(await invoke('get_focus_timer_snapshot'), data.focusSnapshot);
  assert.deepEqual(await invoke('get_task_workspace_snapshot'), data.taskWorkspace);
  assert.deepEqual(await invoke('list_module_layout'), data.layout);
  assert.deepEqual(await invoke('list_events_in_range', { range: { startAt: '2026-11-01T00:00:00Z', endAtExclusive: '2026-12-01T00:00:00Z' } }), []);
  assert.equal((await invoke('list_events_in_range', { range: { startAt: '2026-10-01T00:00:00Z', endAtExclusive: '2026-11-01T00:00:00Z' } })).length, data.events.length);
  assert.equal(typeof await invoke('plugin:event|listen', { event: 'focus-timer-updated', handler: 1 }), 'number');
  assert.equal(await invoke('get_pending_focus_completion'), null);
  assert.equal(await invoke('check_for_update'), null);
  const adjusted = structuredClone(data.stickerBoard);
  adjusted.objects[0].width = 420;
  const saved = await invoke('save_sticker_board', { board: adjusted });
  assert.equal(saved.revision, adjusted.revision + 1);
  assert.equal(saved.objects[0].width, 420);
  assert.deepEqual(await invoke('get_sticker_board'), saved);
  for (const event of data.events) {
    for (const key of ['startTz', 'endTz', 'rrule', 'seriesId', 'seriesStartAt', 'subscriptionId']) assert.equal(event[key], null);
    assert.equal(event.isOverridden, false);
  }
  const serializedBackend = (0, eval)(`(${fixtures.createFixtureBackend.toString()})`)(data);
  assert.deepEqual(await serializedBackend('get_focus_timer_snapshot'), data.focusSnapshot);
  await assert.rejects(() => invoke('unimplemented_command'), /unimplemented_command/);
});
