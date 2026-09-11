// End-to-end coverage for the rich text editor's full format set.
//
// These paths cannot be reached by the unit suite: jsdom has no layout, and the
// suite stubs the lazy dependency loader so no dialog test pays KaTeX's transform
// cost. So real KaTeX rendering, real highlight.js tokenising, and the table
// context bar are verified here, in a browser, against the real chunks.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nowly.language', 'zh');
      localStorage.setItem('nowly:onboarding-seen', 'true');
    } catch { /* storage disabled */ }
  });
  await page.addInitScript(() => {
    // iconStyle matters: App feeds it to IconStyleProvider, and undefined makes
    // every app icon render as an empty SVG.
    const settings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true, iconStyle:'duotone', hideTopbarInWallpaper:true, recentColors:[], calendarEnabled:true, matrixEnabled:true, notesEnabled:true };
    let notes: any[] = [];
    let sequence = 1;
    (window as any).__notes = () => notes;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: async (command: string, args: any = {}) => {
      if (command === 'list_events_in_range' || command === 'list_tasks') return [];
      if (command === 'list_notes') return notes;
      if (command === 'get_app_settings') return settings;
      if (command === 'create_note') { const note = { id:`n${sequence++}`, ...args.draft, createdAt:'x', updatedAt:'x' }; notes.push(note); return note; }
      if (command === 'list_attachments') return [];
      if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
      throw new Error(`Unexpected command: ${command}`);
    }, transformCallback: (cb: unknown) => { const id = Math.floor(Math.random() * 2 ** 32); Reflect.set(window, `_${id}`, cb); return id; } } });
  });
  await page.goto('/');
  await expect(page.getByText('还没有便签')).toBeVisible();
});

async function openEditor(page: Page) {
  await page.getByRole('button', { name: '新增便签' }).click();
  const dialog = page.getByRole('dialog', { name: '新建便签' });
  await expect(dialog).toBeVisible();
  // Construction waits on the KaTeX / highlight.js chunk.
  await expect(page.locator('.ql-editor')).toBeVisible();
  return dialog;
}

test('renders every format control with a localised name', async ({ page }) => {
  await openEditor(page);
  for (const [cls, label] of [
    ['ql-bold', '粗体'], ['ql-italic', '斜体'], ['ql-underline', '下划线'], ['ql-strike', '删除线'],
    ['ql-code', '行内代码'], ['ql-blockquote', '引用'], ['ql-code-block', '代码块'],
    ['ql-link', '链接'], ['ql-image', '图片'], ['ql-video', '视频'], ['ql-formula', '公式'],
    ['ql-table', '插入表格'], ['ql-clean', '清除格式']
  ]) {
    await expect(page.locator(`button.${cls}`), cls).toHaveAttribute('aria-label', label);
  }
  // Quill labels its own buttons in English; these prove the override landed.
  await expect(page.locator('.ql-toolbar').first()).toHaveAttribute('aria-label', '格式工具栏');
  await expect(page.locator('button.ql-list[value="check"]')).toHaveAttribute('aria-label', '任务列表');

  // Picker labels render through CSS `content: attr(data-label)` on a ::before,
  // so the text is not in textContent. Assert the attribute snow.css reads, then
  // confirm it actually paints, which is the whole point of the attribute.
  await page.locator('.ql-header .ql-picker-label').click();
  const headingOne = page.locator(".ql-header .ql-picker-item[data-value='1']");
  await expect(headingOne).toHaveAttribute('data-label', '标题 1');
  const painted = await headingOne.evaluate((node) => getComputedStyle(node, '::before').content);
  expect(painted).toContain('标题 1');
  await page.keyboard.press('Escape');
});

test('renders a real KaTeX formula', async ({ page }) => {
  // jsdom never exercised this: the deps are stubbed for the unit suite, and the
  // formula blot throws outright without KaTeX.
  await openEditor(page);
  await page.locator('.ql-editor').click();
  await page.locator('button.ql-formula').click();
  const input = page.locator('.ql-tooltip input[type="text"]');
  await expect(input).toBeVisible();
  await input.fill('e=mc^2');
  await input.press('Enter');

  const formula = page.locator('.ql-editor .ql-formula');
  await expect(formula).toBeVisible();
  // KaTeX builds its own markup; if it had failed the span would be empty.
  await expect(formula.locator('.katex')).toHaveCount(1);
});

test('highlights a code block with real highlight.js', async ({ page }) => {
  const dialog = await openEditor(page);
  await page.locator('.ql-editor').click();
  await page.locator('button.ql-code-block').click();
  await page.keyboard.type('const answer = 42;');

  // A new block defaults to language 'plain', which the syntax module treats as
  // "no highlighting". Tokens appear only once a language is chosen from the
  // select it injects into each block.
  const select = page.locator('.ql-code-block-container select');
  // No duplicate options: Quill merges module options with lodash `merge`, which
  // combines arrays index by index, so a short list leaves its defaults behind.
  const options = await select.locator('option').allTextContents();
  expect(new Set(options).size).toBe(options.length);

  await select.selectOption('javascript');
  const token = page.locator('.ql-editor .hljs-keyword').first();
  await expect(token).toBeVisible({ timeout: 8000 });
  await expect(token).toHaveText('const');

  // Highlighting is presentation only; the language persists, the spans do not.
  await dialog.getByLabel('便签标题').fill('代码');
  await dialog.getByRole('button', { name: '保存便签' }).click();
  await expect(page.getByText('代码')).toBeVisible();
  const stored = await page.evaluate(() => (window as unknown as { __notes(): { content: string }[] }).__notes()[0].content);
  expect(stored).toContain('"code-block":"javascript"');
  expect(stored).not.toContain('code-token');
  expect(stored).not.toContain('hljs');
});

test('inserts a table and shows the context bar only inside it', async ({ page }) => {
  await openEditor(page);
  await page.locator('.ql-editor').click();
  await expect(page.getByRole('group', { name: '表格操作' })).toHaveCount(0);

  await page.locator('button.ql-table').click();
  await expect(page.locator('.ql-editor table')).toBeVisible();
  const bar = page.getByRole('group', { name: '表格操作' });
  await expect(bar).toBeVisible();

  // 3x3 seed, then one more row through our own bar.
  await expect(page.locator('.ql-editor table tr')).toHaveCount(3);
  await page.getByRole('button', { name: '在下方插入行' }).click();
  await expect(page.locator('.ql-editor table tr')).toHaveCount(4);
});

test('stores a Delta envelope and keeps the design palette', async ({ page }) => {
  const dialog = await openEditor(page);
  await dialog.getByLabel('便签标题').fill('全功能');
  const surface = page.locator('.ql-editor');
  await surface.click();

  // A colour from design.md, applied through the constrained picker.
  await page.locator('.ql-color .ql-picker-label').click();
  await page.locator('.ql-color .ql-picker-item[data-value="#4fc9da"]').click();
  await page.keyboard.type('青绿文字');
  await page.keyboard.press('Enter');
  await page.locator('button.ql-blockquote').click();
  await page.keyboard.type('引用一句');

  await expect(surface.locator('blockquote')).toHaveText('引用一句');

  await dialog.getByRole('button', { name: '保存便签' }).click();
  await expect(page.getByText('全功能')).toBeVisible();

  const stored = await page.evaluate(() => (window as any).__notes()[0].content);
  const parsed = JSON.parse(stored);
  expect(parsed.v).toBe(1);
  expect(JSON.stringify(parsed.ops)).toContain('#4fc9da');
  expect(JSON.stringify(parsed.ops)).toContain('blockquote');

  // The list preview must flatten it, never show raw JSON.
  const preview = await page.locator('.note-content, .sticky-note__content').first().textContent();
  expect(preview).toContain('青绿文字');
  expect(preview).not.toContain('{');
  expect(preview).not.toContain('ops');
});

test('adds no motion, which design.md forbids and the suite asserts', async ({ page }) => {
  await openEditor(page);
  // KaTeX and highlight.js ship their own stylesheets; confirm neither smuggles
  // in a transition or animation.
  const moving = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const node of Array.from(document.querySelectorAll('.rich-editor *'))) {
      const style = getComputedStyle(node);
      const duration = `${style.transitionDuration} ${style.animationDuration}`;
      if (/[1-9]/.test(duration)) offenders.push(`${node.className}: ${duration}`);
    }
    return offenders;
  });
  expect(moving).toEqual([]);
});

test('keeps the link tooltip inside the editor, which clips its overflow', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ql-editor');
  await editor.click();

  // A link at the very start of a line is the worst case: snow centres the
  // tooltip on its anchor, so an unbounded tooltip lands left of the editor.
  await page.keyboard.type('abc');
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');

  await page.locator('button.ql-link').click();
  const input = page.locator('.ql-tooltip input[type="text"]');
  await expect(input).toBeVisible();
  await input.fill('https://example.com/a-fairly-long-url');
  await page.keyboard.press('Enter');

  await editor.locator('a').first().click();
  await expect(page.locator('.ql-tooltip')).toBeVisible();

  // Quill bounds the tooltip to whatever it is given and defaults to
  // document.body, which our `overflow:hidden` surface then clips. Measured at
  // left:-165px before the surface was passed as `bounds`.
  const spill = await page.evaluate(() => {
    const tip = document.querySelector('.ql-tooltip')!.getBoundingClientRect();
    const surface = document.querySelector('.rich-editor__surface')!.getBoundingClientRect();
    return {
      left: Math.round(surface.left - tip.left),
      right: Math.round(tip.right - surface.right),
      top: Math.round(surface.top - tip.top),
      bottom: Math.round(tip.bottom - surface.bottom)
    };
  });
  expect(spill.left).toBeLessThanOrEqual(0);
  expect(spill.right).toBeLessThanOrEqual(0);
  expect(spill.top).toBeLessThanOrEqual(0);
  expect(spill.bottom).toBeLessThanOrEqual(0);
});

test('flips the tooltip above a link on the last visible line', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ql-editor');
  await editor.click();
  // Overflow the editor's 320px max-height so it scrolls.
  for (let i = 0; i < 24; i += 1) {
    await page.keyboard.type(`第 ${i} 行`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('末行链接');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');

  await page.locator('button.ql-link').click();
  await page.locator('.ql-tooltip input[type="text"]').fill('https://example.com/bottom');
  await page.keyboard.press('Enter');

  await editor.locator('a').last().click();
  const tooltip = page.locator('.ql-tooltip');
  await expect(tooltip).toBeVisible();
  // Below the anchor there is no room, so Quill flips it above rather than
  // letting the surface clip it.
  await expect(tooltip).toHaveClass(/ql-flip/);
  const spillBottom = await page.evaluate(() =>
    Math.round(
      document.querySelector('.ql-tooltip')!.getBoundingClientRect().bottom
      - document.querySelector('.rich-editor__surface')!.getBoundingClientRect().bottom
    )
  );
  expect(spillBottom).toBeLessThanOrEqual(0);
});
