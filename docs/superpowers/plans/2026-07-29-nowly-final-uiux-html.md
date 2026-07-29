# Nowly Final UI/UX HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, high-fidelity, responsive Nowly UI/UX HTML prototype using the approved Good / Keenthemes visual language, two wallpaper modes, five dialogs, and presentation-level interactions.

**Architecture:** The deliverable is one offline HTML document with semantic markup, embedded design-token CSS, inline Lucide-style SVG symbols, realistic Chinese sample content, and a small state-oriented JavaScript controller. Playwright loads the file contents with `page.setContent`, verifies structure, interactions, accessibility behavior, and viewport overflow at all required sizes without coupling the prototype to the React application.

**Tech Stack:** HTML5, native CSS, vanilla JavaScript, inline SVG symbol sprites, Playwright, TypeScript

---

## File Structure

- Create `docs/prototypes/nowly-final-uiux.html`: complete standalone prototype; the file owns semantic content, visual tokens, responsive rules, SVG symbol definitions, dialogs, and presentation state.
- Create `tests/nowly-prototype.spec.ts`: browser-level contract tests for content, modal controls, wallpaper mode, reset behavior, keyboard interaction, and responsive overflow.
- Modify `docs/00-index.md`: add links to the approved design specification, implementation plan, and final prototype.

The prototype remains isolated from `src/`: it is a design artifact, not a second implementation of the React application.

### Task 1: Establish the Prototype Contract and Semantic Shell

**Files:**
- Create: `tests/nowly-prototype.spec.ts`
- Create: `docs/prototypes/nowly-final-uiux.html`

- [ ] **Step 1: Write the failing semantic-shell test**

Create `tests/nowly-prototype.spec.ts` with a helper that loads the standalone document and an initial contract test:

```ts
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const prototypePath = resolve(process.cwd(), 'docs/prototypes/nowly-final-uiux.html');

async function loadPrototype(page: Page) {
  const html = await readFile(prototypePath, 'utf8');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

test('renders the complete single-screen Nowly shell', async ({ page }) => {
  await loadPrototype(page);

  await expect(page).toHaveTitle('Nowly · 最终 UI/UX 原型');
  await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  await expect(page.getByText('今天有 3 个日程 · 2 个重要任务 · 2 条便签')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-grid"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="quadrant-grid"]')).toHaveCount(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "complete single-screen"
```

Expected: FAIL because `docs/prototypes/nowly-final-uiux.html` does not exist.

- [ ] **Step 3: Create the minimal semantic HTML shell**

Create `docs/prototypes/nowly-final-uiux.html` as a complete HTML5 document. Include:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Nowly · 最终 UI/UX 原型</title>
  <style>
    :root {
      --primary: #009ef7;
      --text: #181c32;
      --muted: #7e8299;
      --surface: #ffffff;
      --canvas: #f5f8fa;
      --border: #eff2f5;
      --success: #50cd89;
      --warning: #ffc700;
      --danger: #f1416c;
      --purple: #7239ea;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { margin: 0; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; color: var(--text); background: var(--canvas); }
    button, input, textarea, select { font: inherit; }
    button { cursor: pointer; }
    .app-shell { width: 100vw; height: 100vh; padding: 24px; display: flex; flex-direction: column; gap: 18px; overflow: hidden; }
    .topbar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
    .workspace { min-width: 0; min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(620px, 1.58fr) minmax(320px, .72fr); gap: 18px; }
    .card { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); }
    .side-column { min-height: 0; display: grid; grid-template-rows: minmax(0, 1.15fr) minmax(0, .85fr); gap: 18px; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .quadrant-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  </style>
</head>
<body>
  <div class="app-shell" data-theme="light">
    <header class="topbar">
      <div><strong>09:41</strong><p>2026 年 7 月 23 日，星期四</p><p>今天有 3 个日程 · 2 个重要任务 · 2 条便签</p></div>
      <nav aria-label="界面操作"><button type="button">背景模式</button><button type="button">设置</button><button type="button">设为壁纸</button></nav>
    </header>
    <main class="workspace">
      <section class="card" aria-labelledby="calendar-title">
        <h1 id="calendar-title">2026 年 7 月</h1>
        <p>本月 12 个日程</p>
        <div class="calendar-grid" data-testid="calendar-grid" aria-label="2026 年 7 月月历"></div>
      </section>
      <aside class="side-column">
        <section class="card" aria-labelledby="priority-title"><h2 id="priority-title">优先事项</h2><div class="quadrant-grid" data-testid="quadrant-grid"></div></section>
        <section class="card" aria-labelledby="notes-title"><h2 id="notes-title">便签</h2></section>
      </aside>
    </main>
  </div>
</body>
</html>
```

- [ ] **Step 4: Run the shell test and verify it passes**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "complete single-screen"
```

Expected: PASS.

- [ ] **Step 5: Commit the semantic shell**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: add Nowly prototype semantic shell"
```

### Task 2: Build the High-Fidelity Good / Keenthemes Main Screen

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Add failing tests for realistic content and visual states**

Append:

```ts
test('shows balanced-density calendar, quadrant, and note content', async ({ page }) => {
  await loadPrototype(page);

  await expect(page.locator('[data-calendar-day]')).toHaveCount(35);
  await expect(page.locator('[data-calendar-day][aria-current="date"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /14:00 设计评审/ })).toBeVisible();
  await expect(page.locator('[data-quadrant]')).toHaveCount(4);
  await expect(page.getByText('发布 Nowly v0.1')).toBeVisible();
  await expect(page.locator('[data-note-card]')).toHaveCount(2);
  await expect(page.getByText('产品原则')).toBeVisible();
});

test('uses inline icon symbols instead of emoji function icons', async ({ page }) => {
  await loadPrototype(page);

  await expect(page.locator('svg[aria-hidden="true"] use')).not.toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/📅|✅|📝|⚙️|📌/);
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "balanced-density|inline icon"
```

Expected: both tests FAIL because the shell has no populated content or icon system.

- [ ] **Step 3: Implement the complete main-screen content**

Expand the HTML with these exact content groups:

- Add an invisible `<svg>` symbol sprite containing consistent 2px-stroke symbols named `icon-chevron-left`, `icon-chevron-right`, `icon-calendar-plus`, `icon-monitor`, `icon-settings`, `icon-pin`, `icon-plus`, `icon-check`, `icon-clock`, `icon-briefcase`, `icon-heart`, `icon-book`, and `icon-more`.
- Replace text-only controls with icon-and-label buttons and use `<svg aria-hidden="true"><use href="#icon-name"></use></svg>`.
- Populate a five-week Monday-first calendar from June 29 through August 2, giving every date button `data-calendar-day`; assign July 23 `aria-current="date"`.
- Add realistic event buttons: `09:30 站会`, `14:00 设计评审`, `18:30 健身`, `10:00 产品复盘`, `全天 项目里程碑`, `20:00 阅读时间`, plus overflow labels such as `还有 2 项`.
- Populate four `data-quadrant` sections with headings `重要且紧急`, `重要不紧急`, `不重要但紧急`, and `不重要不紧急`.
- Add tasks `发布 Nowly v0.1`, `完善模块接口设计`, `回复合作方消息`, and `整理参考素材`; each task has a native checkbox and a deadline/status label.
- Add two `data-note-card` articles titled `产品原则` and `本周提醒`, with two-line summaries, updated times, and a pin icon on the first.
- Add card headers, count badges, category legends, hover states, focus-visible rings, card shadows, typography hierarchy, and internal overflow containers.

Use CSS variables for all colors. Use `#009ef7` only through `--primary`; use the approved success, warning, danger, and purple tokens for semantic accents. Do not add a sidebar, breadcrumb, marketing copy, or page navigation.

- [ ] **Step 4: Add the complete Good-style visual layer**

Add CSS for:

```css
.app-shell {
  background:
    radial-gradient(circle at 12% 0%, rgba(0, 158, 247, .12), transparent 30%),
    radial-gradient(circle at 92% 8%, rgba(80, 205, 137, .10), transparent 27%),
    linear-gradient(135deg, #f8fbfd, #eef3f7);
}
.card {
  background: rgba(255, 255, 255, .94);
  border: 1px solid rgba(239, 242, 245, .96);
  box-shadow: 0 8px 28px rgba(76, 87, 125, .08);
}
:where(button, input, textarea, select):focus-visible {
  outline: 3px solid rgba(0, 158, 247, .28);
  outline-offset: 2px;
}
.event--work { color: #0878b9; background: #e9f6ff; }
.event--important { color: #c62f55; background: #fff0f4; }
.event--personal { color: #238c5a; background: #e8fff3; }
.event--learning { color: #6030bf; background: #f4efff; }
```

Complete the declarations for headers, calendar cells, event chips, quadrant cards, task rows, note cards, badges, buttons, and scrollbar styling. Ensure status colors retain readable text contrast.

- [ ] **Step 5: Run the prototype tests**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts
```

Expected: all current tests PASS.

- [ ] **Step 6: Commit the complete main screen**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: design Good-style Nowly dashboard"
```

### Task 3: Add Wallpaper Modes and Responsive Layout

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Add failing theme and viewport tests**

Append:

```ts
test('switches between light and desktop blend modes', async ({ page }) => {
  await loadPrototype(page);
  const shell = page.locator('.app-shell');

  await expect(shell).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换到桌面融合模式' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'desktop');
  await expect(page.getByRole('button', { name: '切换到浅色渐变模式' })).toBeVisible();
});

for (const viewport of [
  { name: 'compact', width: 1366, height: 768 },
  { name: 'standard', width: 1920, height: 1080 },
  { name: 'large', width: 2560, height: 1440 }
]) {
  test(`has no page overflow at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPrototype(page);

    const metrics = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '优先事项' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '便签' })).toBeVisible();
  });
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "blend modes|page overflow"
```

Expected: theme test FAIL due to missing accessible switch; compact overflow test FAIL until compact rules exist.

- [ ] **Step 3: Implement the desktop blend mode**

Add a header button with `data-action="toggle-theme"` and initial accessible name `切换到桌面融合模式`. Add CSS under `[data-theme="desktop"]` that uses layered radial and linear gradients to create an offline abstract blue-violet desktop wallpaper. In this mode:

- cards use `rgba(255,255,255,.82)`;
- borders use `rgba(255,255,255,.64)`;
- `backdrop-filter: blur(18px) saturate(120%)`;
- shadows deepen to remain visible over the wallpaper;
- all text retains the same approved contrast tokens.

Add JavaScript that toggles `data-theme` between `light` and `desktop`, updates the button label, `aria-label`, pressed state, and visible icon/label without storing the value.

- [ ] **Step 4: Implement responsive compact and large-screen rules**

Add media queries:

```css
@media (max-width: 1500px), (max-height: 850px) {
  .app-shell { padding: 14px; gap: 12px; }
  .workspace, .side-column { gap: 12px; }
  .workspace { grid-template-columns: minmax(570px, 1.52fr) minmax(310px, .72fr); }
  .calendar-card, .priority-card, .notes-card { border-radius: 14px; }
  .calendar-event:nth-of-type(n+3), .density-optional { display: none; }
}
@media (min-width: 2200px) {
  .app-shell__inner { width: min(2200px, calc(100vw - 80px)); margin-inline: auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
```

Wrap topbar and workspace in `.app-shell__inner` or use a full-height inner grid so the large-screen max width applies without changing the fixed viewport. Ensure all flex/grid descendants that can shrink have `min-width: 0` and `min-height: 0`.

- [ ] **Step 5: Run all viewport and theme tests**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts
```

Expected: all tests PASS at all three viewport sizes.

- [ ] **Step 6: Commit wallpaper and responsive states**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: add responsive wallpaper display modes"
```

### Task 4: Add Five High-Fidelity Dialogs

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Add failing dialog tests**

Append:

```ts
const dialogCases = [
  { trigger: '2026年7月23日，星期四', title: '7 月 23 日 · 星期四' },
  { trigger: /14:00 设计评审/, title: '编辑日程' },
  { trigger: /发布 Nowly v0.1/, title: '编辑任务' },
  { trigger: /产品原则/, title: '编辑便签' },
  { trigger: '打开设置', title: '设置' }
];

for (const dialogCase of dialogCases) {
  test(`opens and closes ${dialogCase.title}`, async ({ page }) => {
    await loadPrototype(page);
    await page.getByRole('button', { name: dialogCase.trigger }).first().click();
    const dialog = page.getByRole('dialog', { name: dialogCase.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused({ timeout: 1000 }).catch(async () => {
      await expect(dialog.locator('button, input, textarea, select').first()).toBeFocused();
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('moves from date details to event editor', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '2026年7月23日，星期四' }).click();
  await page.getByRole('dialog', { name: '7 月 23 日 · 星期四' }).getByRole('button', { name: /设计评审/ }).click();
  await expect(page.getByRole('dialog', { name: '编辑日程' })).toBeVisible();
});
```

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "opens and closes|moves from date"
```

Expected: FAIL because no dialogs exist.

- [ ] **Step 3: Implement the shared dialog layer**

Add one fixed `.dialog-layer` with a clickable backdrop and five hidden `<section role="dialog" aria-modal="true" tabindex="-1">` panels. Each panel must have a labelled heading, close button, independently scrollable `.dialog-body`, and fixed `.dialog-footer`.

Add a controller with these exact operations:

```js
const state = { activeDialog: null, previousFocus: null };
function openDialog(name, trigger = document.activeElement) {
  state.previousFocus = trigger;
  state.activeDialog = name;
  document.body.dataset.dialogOpen = 'true';
  document.querySelectorAll('[data-dialog]').forEach((dialog) => {
    dialog.hidden = dialog.dataset.dialog !== name;
  });
  const active = document.querySelector(`[data-dialog="${name}"]`);
  active.hidden = false;
  active.querySelector('input, textarea, select, button')?.focus();
}
function closeDialog() {
  document.querySelectorAll('[data-dialog]').forEach((dialog) => { dialog.hidden = true; });
  delete document.body.dataset.dialogOpen;
  state.activeDialog = null;
  state.previousFocus?.focus();
}
```

Wire `data-open-dialog`, `data-close-dialog`, backdrop click, and `Escape` key handling. Trap `Tab` within the active dialog by cycling between its first and last enabled focusable elements.

- [ ] **Step 4: Populate all five dialogs with approved content**

Create:

1. `date-detail`: title `7 月 23 日 · 星期四`, a three-item time line for stand-up, design review, and fitness, linked task summary, and `新建日程` / `新建任务` buttons.
2. `event-editor`: title `编辑日程`; labelled title, date, start, end, all-day, category, color, linked task, and notes controls; footer buttons `删除日程`, `取消`, `保存日程`.
3. `task-editor`: title `编辑任务`; title input, four visual quadrant radio cards, due date, priority, linked event, completion switch, notes; footer buttons `删除任务`, `取消`, `保存任务`.
4. `note-editor`: title `编辑便签`; title, large content area, four color radio swatches, pin switch, update time; footer buttons `删除便签`, `取消`, `保存便签`.
5. `settings`: title `设置`; left tabs `外观`, `桌面行为`, `模块显示`, `启动与系统`; default appearance panel with background choice, opacity range, balanced density, week start, and weekend switch; footer buttons `恢复默认`, `取消`, `保存设置`.

Use actual `<label>`, `<input>`, `<textarea>`, `<select>`, `<fieldset>`, `<legend>`, and radio/checkbox inputs. Do not use non-semantic clickable `<div>` elements.

- [ ] **Step 5: Run all dialog tests**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the dialog system**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: add complete Nowly dialog designs"
```

### Task 5: Add Prototype Controls and Presentation State

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Add failing presentation-interaction tests**

Append:

```ts
test('toggles task completion and resets presentation state', async ({ page }) => {
  await loadPrototype(page);
  const task = page.getByLabel('完成任务：发布 Nowly v0.1');

  await task.check();
  await expect(task.locator('xpath=ancestor::*[@data-task-row]')).toHaveClass(/is-complete/);
  await page.getByRole('button', { name: '展开原型控制器' }).click();
  await page.getByRole('button', { name: '重置演示状态' }).click();
  await expect(task).not.toBeChecked();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
});

test('switches settings categories and visual option states', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('tab', { name: '模块显示' }).click();
  await expect(page.getByRole('tabpanel', { name: '模块显示' })).toBeVisible();
  await page.getByRole('tab', { name: '外观' }).click();
  await page.getByLabel('桌面融合').check();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'desktop');
});

test('prototype controller opens every dialog directly', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '展开原型控制器' }).click();
  for (const name of ['日期详情', '日程编辑', '任务编辑', '便签编辑', '设置']) {
    await page.getByRole('button', { name: `预览${name}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
});
```

- [ ] **Step 2: Run presentation tests and verify they fail**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --grep "presentation state|settings categories|controller opens"
```

Expected: FAIL because task state, tabs, controller, and reset are not implemented.

- [ ] **Step 3: Implement task, option, and settings-tab state**

Add delegated `change` and `click` handlers that:

- toggle `.is-complete` on the checkbox's `[data-task-row]` ancestor;
- update the shell theme immediately when background radios change;
- set the selected quadrant/color card using `:has(input:checked)` with a class fallback updated by JavaScript;
- switch settings tabs using `role="tab"`, `aria-selected`, `tabindex`, and matching `role="tabpanel"` hidden states;
- update the opacity sample from the range input;
- keep all changes in memory only.

- [ ] **Step 4: Implement the collapsible prototype controller**

Add a bottom-edge controller with:

- toggle button accessible names `展开原型控制器` and `收起原型控制器`;
- direct buttons named `预览日期详情`, `预览日程编辑`, `预览任务编辑`, `预览便签编辑`, and `预览设置`;
- `重置演示状态` button;
- subtle neutral styling and a maximum width that never covers the full calendar.

On reset:

- close any dialog;
- restore `data-theme="light"`;
- uncheck demonstration task checkboxes;
- restore settings to appearance tab and initial controls;
- restore July 2026 title;
- collapse the controller after feedback is shown through a short `aria-live="polite"` message `演示状态已重置`.

- [ ] **Step 5: Implement calendar header presentation feedback**

Wire previous, today, and next buttons to update only the visible month heading and subtitle among `2026 年 6 月`, `2026 年 7 月`, and `2026 年 8 月`. Keep the approved July grid static and add an `aria-live="polite"` region announcing the selected demonstration month; the Today button always restores July.

- [ ] **Step 6: Run the full Playwright suite**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts
```

Expected: all prototype tests PASS.

- [ ] **Step 7: Commit presentation controls**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: add Nowly prototype presentation controls"
```

### Task 6: Documentation, Visual Verification, and Final Quality Gate

**Files:**
- Modify: `docs/00-index.md`
- Modify: `docs/prototypes/nowly-final-uiux.html` only if verification finds defects
- Modify: `tests/nowly-prototype.spec.ts` only if verification reveals a missing regression contract

- [ ] **Step 1: Add the prototype and design artifacts to the documentation index**

Update `docs/00-index.md` to contain:

```md
# Nowly Docs

## Product Specs

- [Nowly 设计规格](./superpowers/specs/2026-07-23-nowly-design.md)
- [Nowly 最终 UI/UX HTML 设计规格](./superpowers/specs/2026-07-29-nowly-final-uiux-html-design.md)

## Prototypes

- [Nowly 最终 UI/UX HTML 原型](./prototypes/nowly-final-uiux.html)

## Implementation Plans

- [Nowly MVP Implementation Plan](./superpowers/plans/2026-07-23-nowly-mvp.md)
- [Nowly Final UI/UX HTML Implementation Plan](./superpowers/plans/2026-07-29-nowly-final-uiux-html.md)
```

- [ ] **Step 2: Run automated tests and the existing regression suite**

Run:

```bash
npm test
npx playwright test tests/nowly-prototype.spec.ts
npm run build
```

Expected: Vitest suites PASS, prototype Playwright tests PASS, and TypeScript/Vite production build completes successfully.

- [ ] **Step 3: Perform browser visual verification at all target sizes**

Open the standalone file in Chromium and inspect at 1366×768, 1920×1080, and 2560×1440. Verify:

- calendar, quadrants, and notes remain simultaneously visible;
- no browser-level scrollbars appear;
- no headings, event labels, task deadlines, or buttons overlap;
- Good / Keenthemes visual hierarchy is recognizable;
- desktop mode remains readable over the abstract wallpaper;
- each dialog remains within the viewport and only its body scrolls;
- the prototype controller does not obscure required content;
- focus indicators are visible when navigating by Tab;
- reduced-motion emulation removes nonessential transitions.

If any item fails, add a Playwright assertion that reproduces it where practical, confirm the assertion fails, adjust the HTML/CSS/JavaScript, and rerun the full commands from Step 2.

- [ ] **Step 4: Check standalone and content constraints**

Run:

```bash
rg -n "https?://|src=\"/|href=\"/" docs/prototypes/nowly-final-uiux.html
rg -n "📅|✅|📝|⚙️|📌|TODO|TBD|Lorem ipsum" docs/prototypes/nowly-final-uiux.html
```

Expected: no external runtime dependency matches, no Emoji function icons, no placeholders, and no unfinished text. Internal fragment references such as `href="#icon-settings"` are allowed.

- [ ] **Step 5: Check diff quality**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the intended prototype, test, and documentation files are changed.

- [ ] **Step 6: Commit documentation and final refinements**

```bash
git add -f docs/00-index.md docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "docs: publish final Nowly UIUX prototype"
```

- [ ] **Step 7: Request final code and design review**

Invoke the `requesting-code-review` skill and ask the reviewer to verify the implementation against `docs/superpowers/specs/2026-07-29-nowly-final-uiux-html-design.md`, with particular attention to Good / Keenthemes fidelity, responsive overflow, keyboard dialog behavior, and absence of production data logic.
