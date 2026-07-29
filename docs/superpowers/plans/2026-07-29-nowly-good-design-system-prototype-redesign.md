# Nowly Good Design System Prototype Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the standalone Nowly prototype so it strictly follows root `design.md`, supports every viewport from 1366×768 upward without a maximum bound, and retains the approved single-screen interactions.

**Architecture:** Keep the deliverable as one offline HTML document containing semantic markup, design-token CSS, inline SVG symbols, and a small vanilla JavaScript state controller. Playwright loads the document through `page.setContent` and enforces visual-token, responsive-layout, interaction, and accessibility contracts independently from the React application.

**Tech Stack:** HTML5, native CSS, vanilla JavaScript, inline SVG symbols, Playwright, TypeScript

---

## File Structure

- Modify `docs/prototypes/nowly-final-uiux.html`: replace the old visual system and theme behavior while retaining the standalone prototype, semantic content, dialogs, and state controller.
- Modify `tests/nowly-prototype.spec.ts`: replace obsolete desktop-blend tests and add design-system, no-motion, minimum/unbounded viewport, form, reset, and accessibility contracts.
- Modify `playwright.config.ts`: add large and ultra-wide projects so the normal E2E command samples the unbounded responsive range.
- Modify `docs/00-index.md`: add the Good design-system redesign specification and implementation-plan links.

The prototype stays isolated from `src/`; no production React/Tauri file changes are required.

### Task 1: Replace obsolete theme tests with design-system contracts

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Remove tests that require desktop blend mode**

Delete the test named `switches between light and desktop blend modes`. In `toggles task completion and resets presentation state`, delete the desktop-mode click and the assertion for `data-theme="light"`.

- [ ] **Step 2: Add a failing static source contract**

Add this test after `uses inline icon symbols instead of emoji function icons`:

```ts
test('uses the authoritative Good design tokens without legacy effects', async () => {
  const html = await readFile(prototypePath, 'utf8');
  const normalized = html.toLowerCase();

  for (const token of ['#4fc9da', '#30a6b6', '#f8f6f2', '#f6f1e9', '#211f1c', '#716d66', '#968e7e', '#eaeaea']) {
    expect(normalized).toContain(token);
  }
  for (const legacy of ['#009ef7', '#181c32', '#7e8299', 'backdrop-filter', 'radial-gradient', 'linear-gradient']) {
    expect(normalized).not.toContain(legacy);
  }
  expect(normalized).not.toContain('data-action="toggle-theme"');
  expect(normalized).not.toContain('桌面融合');
});
```

- [ ] **Step 3: Add failing computed-style contracts**

```ts
test('applies Good card, button, and typography rules', async ({ page }) => {
  await loadPrototype(page);
  const styles = await page.evaluate(() => {
    const card = getComputedStyle(document.querySelector('.card')!);
    const primary = getComputedStyle(document.querySelector('.btn-primary')!);
    const body = getComputedStyle(document.body);
    return {
      cardBackground: card.backgroundColor,
      cardBorder: card.borderColor,
      cardRadius: card.borderRadius,
      cardShadow: card.boxShadow,
      buttonBackground: primary.backgroundColor,
      buttonRadius: primary.borderRadius,
      bodyBackground: body.backgroundColor,
      bodyFontSize: body.fontSize,
      bodyLineHeight: body.lineHeight
    };
  });

  expect(styles).toEqual({
    cardBackground: 'rgb(255, 255, 255)',
    cardBorder: 'rgb(234, 234, 234)',
    cardRadius: '15.2px',
    cardShadow: 'none',
    buttonBackground: 'rgb(79, 201, 218)',
    buttonRadius: '15.2px',
    bodyBackground: 'rgb(248, 246, 242)',
    bodyFontSize: '16px',
    bodyLineHeight: '24px'
  });
});

test('keeps visible interface text at or above 13.6px', async ({ page }) => {
  await loadPrototype(page);
  const undersized = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const text = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      return text && node.offsetParent !== null && parseFloat(style.fontSize) < 13.6 && !node.classList.contains('sr-only');
    })
    .map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim() })));
  expect(undersized).toEqual([]);
});
```

- [ ] **Step 4: Add a failing no-motion contract**

```ts
test('globally disables motion and smooth scrolling', async ({ page }) => {
  await loadPrototype(page);
  const values = await page.evaluate(() => {
    const probe = document.querySelector('.btn')!;
    const style = getComputedStyle(probe);
    return {
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
    };
  });
  expect(values.animationName).toBe('none');
  expect(values.transitionDuration).toBe('0s');
  expect(values.scrollBehavior).toBe('auto');
});
```

- [ ] **Step 5: Run tests and confirm RED**

Run:

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "authoritative Good|applies Good|visible interface|disables motion"
```

Expected: FAIL because the current file contains legacy colors, gradients, glass effects, undersized text, non-standard radii, card shadows, and transitions.

- [ ] **Step 6: Commit the failing contracts**

```bash
git add tests/nowly-prototype.spec.ts
git commit -m "test: define Good prototype visual contracts"
```

### Task 2: Rebuild the main screen with authoritative tokens

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] **Step 1: Replace the root CSS tokens**

Use this exact token foundation and remove every old root token:

```css
:root {
  --color-primary: #4fc9da;
  --color-primary-active: #30a6b6;
  --color-primary-hover: #69d1e0;
  --color-primary-light: #ddf8fc;
  --color-success: #b8d935;
  --color-success-light: #f4fbdb;
  --color-info: #4f55da;
  --color-info-light: #eff0ff;
  --color-warning: #e8c444;
  --color-warning-light: #fdf4d6;
  --color-danger: #f06445;
  --color-danger-active: #db5437;
  --color-danger-light: #fff0ed;
  --bg-page: #f8f6f2;
  --bg-surface: #ffffff;
  --bg-secondary: #f6f1e9;
  --text-primary: #211f1c;
  --text-strong: #403d38;
  --text-secondary: #716d66;
  --text-tertiary: #8e887a;
  --text-muted: #968e7e;
  --text-disabled: #b5b0a1;
  --border-default: #eaeaea;
  --border-emphasis: #dad3c3;
  --focus-ring: rgba(79, 201, 218, .25);
  --radius-sm: .475rem;
  --radius-default: .95rem;
  --radius-pill: 999px;
  --shadow-lg: 0 1rem 2rem 1rem rgba(0, 0, 0, .1);
  --shadow-dropdown: 0 0 50px 0 rgba(82, 63, 105, .15);
  --font-sans: Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 2: Add the global static and fixed-viewport foundation**

```css
*, *::before, *::after {
  box-sizing: border-box;
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
html, body { width: 100%; height: 100%; overflow: hidden; }
body { margin: 0; font: 400 16px/1.5 var(--font-sans); color: var(--text-secondary); background: var(--bg-page); }
button, input, textarea, select { font: inherit; }
:where(button, input, textarea, select):focus-visible { outline: 0; box-shadow: 0 0 0 4px var(--focus-ring); }
```

- [ ] **Step 3: Rebuild Header and page layout**

Keep the existing content but remove the time block and desktop-blend button. Add a compact `Nowly` brand block beside the date. Implement:

```css
.app-shell { width: 100vw; height: 100vh; overflow: hidden; background: var(--bg-page); }
.app-shell__inner { width: 100%; height: 100%; display: grid; grid-template-rows: 70px minmax(0, 1fr); }
.topbar { padding: 0 36px; display: flex; align-items: center; justify-content: space-between; gap: 24px; background: var(--bg-surface); border-bottom: 1px solid var(--border-default); }
.workspace { min-width: 0; min-height: 0; padding: 24px 36px 36px; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(360px, .72fr); gap: 24px; }
.side-column { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1.15fr) minmax(0, .85fr); gap: 24px; }
```

- [ ] **Step 4: Rebuild shared card and button styles**

```css
.card { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-default); background: var(--bg-surface); box-shadow: none; }
.card-header { min-height: 70px; padding: 12px 36px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px dashed var(--border-default); }
.btn { min-height: 48px; padding: 12.4px 24px; border: 1px solid transparent; border-radius: var(--radius-default); display: inline-flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-strong); background: var(--bg-page); font-size: 16px; font-weight: 500; line-height: 1.5; box-shadow: none; }
.btn-primary { color: #fff; background: var(--color-primary); border-color: var(--color-primary); }
.btn-primary:hover { color: #fff; background: var(--color-primary-hover); border-color: #61cede; }
.btn-primary:active { background: var(--color-primary-active); border-color: var(--color-primary-active); }
.btn-icon { width: 40px; height: 40px; min-height: 40px; padding: 0; }
```

- [ ] **Step 5: Restyle calendar, quadrants, and notes without changing their data hooks**

Use only the approved type sizes `13.6px`, `15.2px`, `16px`, `18.4px`, `20px`, `21.6px`, `24px`, and `28px`. Apply these semantic surfaces:

```css
.day:nth-child(7n), .day:nth-child(7n - 1), .q-neutral { background: var(--bg-page); }
.day.outside { color: var(--text-disabled); background: #fff; }
.day.today, .q-primary, .note--blue { background: var(--color-primary-light); }
.q-danger { background: var(--color-danger-light); }
.q-warning, .note--yellow { background: var(--color-warning-light); }
.event--work { color: var(--color-primary-active); background: var(--color-primary-light); }
.event--important { color: var(--color-danger-active); background: var(--color-danger-light); }
.event--personal { color: #6f8617; background: var(--color-success-light); }
.event--learning { color: #383ebc; background: var(--color-info-light); }
```

Keep all visible text at least `13.6px`, preserve the 35 calendar days, four quadrants, two notes, and all existing `data-*` interaction hooks.

- [ ] **Step 6: Run the main-screen and design tests**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "complete single-screen|balanced-density|authoritative Good|applies Good|visible interface|disables motion"
```

Expected: PASS.

- [ ] **Step 7: Commit the main-screen redesign**

```bash
git add -f docs/prototypes/nowly-final-uiux.html
git commit -m "feature: redesign Nowly prototype with Good tokens"
```

### Task 3: Enforce minimum and unbounded responsive behavior

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] **Step 1: Replace the finite viewport loop with minimum-to-unbounded samples**

Use:

```ts
for (const viewport of [
  { name: 'minimum', width: 1366, height: 768 },
  { name: 'standard', width: 1920, height: 1080 },
  { name: 'large', width: 2560, height: 1440 },
  { name: 'ultra-wide', width: 5120, height: 1440 },
  { name: 'ultra-tall', width: 2560, height: 2880 }
]) {
  test(`fills the viewport without page overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPrototype(page);
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell')!.getBoundingClientRect();
      const workspace = document.querySelector('.workspace')!.getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        shellWidth: shell.width,
        shellHeight: shell.height,
        workspaceRightGap: innerWidth - workspace.right
      };
    });
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.shellWidth).toBe(metrics.viewportWidth);
    expect(metrics.shellHeight).toBe(metrics.viewportHeight);
    expect(metrics.workspaceRightGap).toBeLessThanOrEqual(36);
  });
}

test('does not cap the content width or height', async ({ page }) => {
  await page.setViewportSize({ width: 5120, height: 2880 });
  await loadPrototype(page);
  const values = await page.evaluate(() => {
    const inner = getComputedStyle(document.querySelector('.app-shell__inner')!);
    return { maxWidth: inner.maxWidth, maxHeight: inner.maxHeight };
  });
  expect(values).toEqual({ maxWidth: 'none', maxHeight: 'none' });
});
```

- [ ] **Step 2: Add large Playwright projects**

Set the project list to:

```ts
projects: [
  { name: '1366x768', use: { viewport: { width: 1366, height: 768 } } },
  { name: '1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
  { name: '2560x1440', use: { viewport: { width: 2560, height: 1440 } } },
  { name: '5120x1440', use: { viewport: { width: 5120, height: 1440 } } }
]
```

- [ ] **Step 3: Run the responsive tests and confirm RED where needed**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "fills the viewport|does not cap"
```

Expected: FAIL until old max-width and compact rules are removed/replaced.

- [ ] **Step 4: Implement the responsive rules**

Use no max-width container. Add one compact query only for the supported minimum band:

```css
@media (max-width: 1500px), (max-height: 850px) {
  .topbar { padding-inline: 16px; }
  .workspace { padding: 16px; gap: 16px; grid-template-columns: minmax(0, 1.6fr) minmax(360px, .72fr); }
  .side-column { gap: 16px; }
  .card-header { min-height: 64px; padding: 8px 20px; }
  .calendar-body, .panel-body { padding: 12px 16px 16px; }
  .event:nth-of-type(n + 3), .density-optional { display: none; }
  .today-summary { display: none; }
}
```

Do not add any query that caps large screens. Ensure `.app-shell__inner`, `.workspace`, calendar card, side column, and card bodies use `width: 100%`/`height: 100%` or flex/grid growth and `min-width: 0; min-height: 0` as appropriate.

- [ ] **Step 5: Run responsive contracts**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "fills the viewport|does not cap"
npx playwright test tests/nowly-prototype.spec.ts --project=5120x1440 --grep "fills the viewport|does not cap"
```

Expected: PASS.

- [ ] **Step 6: Commit responsive support**

```bash
git add playwright.config.ts tests/nowly-prototype.spec.ts docs/prototypes/nowly-final-uiux.html
git commit -m "feature: support unbounded prototype viewports"
```

### Task 4: Redesign dialogs and settings while preserving accessibility

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] **Step 1: Add failing settings-removal and dialog-style contracts**

```ts
test('settings uses static Good appearance options', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog.getByLabel('信息密度')).toBeVisible();
  await expect(dialog.getByLabel('周起始日')).toBeVisible();
  await expect(dialog.getByLabel('日期格式')).toBeVisible();
  await expect(dialog.getByLabel('显示周末')).toBeVisible();
  await expect(dialog.getByText('背景模式')).toHaveCount(0);
  await expect(dialog.getByText('卡片透明度')).toHaveCount(0);
});

test('dialogs use the Good modal surface', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '打开设置' }).click();
  const values = await page.getByRole('dialog', { name: '设置' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, shadow: style.boxShadow };
  });
  expect(values.background).toBe('rgb(255, 255, 255)');
  expect(values.border).toBe('rgb(234, 234, 234)');
  expect(values.radius).toBe('15.2px');
  expect(values.shadow).not.toBe('none');
});
```

- [ ] **Step 2: Run and confirm RED**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "static Good appearance|Good modal surface"
```

Expected: FAIL because old settings contain background/opacity and old modal styling.

- [ ] **Step 3: Restyle the shared dialog system**

Apply:

```css
.dialog-layer { background: rgba(0, 0, 0, .2); backdrop-filter: none; }
.dialog { border: 1px solid var(--border-default); border-radius: var(--radius-default); background: var(--bg-surface); box-shadow: var(--shadow-lg); }
.dialog-header, .dialog-body, .dialog-footer { padding-left: 36px; padding-right: 36px; }
.dialog-header { min-height: 70px; border-bottom: 1px solid var(--border-default); }
.dialog-body { padding-top: 24px; padding-bottom: 24px; }
.dialog-footer { padding-top: 20px; padding-bottom: 20px; border-top: 1px solid var(--border-default); }
.input { min-height: 48px; padding: 10px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-default); color: var(--text-secondary); background: var(--bg-surface); }
.choice { padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-default); font-size: 15.2px; font-weight: 500; }
```

Create `.btn-danger` and replace all inline delete colors. Remove every style attribute used for visual presentation.

- [ ] **Step 4: Replace appearance settings**

Remove background-mode radios and opacity range. The visible Appearance panel must include:

```html
<div class="field">
  <label for="density">信息密度</label>
  <select class="input" id="density"><option>平衡型</option><option>舒适型</option></select>
</div>
<div class="field">
  <label for="week-start">周起始日</label>
  <select class="input" id="week-start"><option>星期一</option><option>星期日</option></select>
</div>
<div class="field">
  <label for="date-format">日期格式</label>
  <select class="input" id="date-format"><option>2026 年 7 月 23 日</option><option>2026-07-23</option></select>
</div>
<label class="choice"><input type="checkbox" checked> 显示周末</label>
```

- [ ] **Step 5: Preserve dialog behavior and run all dialog tests**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "dialogs|dialog|settings|focus"
```

Expected: all matching tests PASS, including five entry points, date-to-event navigation, Escape close, focus return, tab switching, and focus trapping.

- [ ] **Step 6: Commit dialog redesign**

```bash
git add tests/nowly-prototype.spec.ts docs/prototypes/nowly-final-uiux.html
git commit -m "feature: redesign prototype dialogs and settings"
```

### Task 5: Repair reset behavior, documentation, and complete verification

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `docs/00-index.md`

- [ ] **Step 1: Update reset behavior for the removed theme state**

The reset handler must only:

- close the active dialog;
- clear checked task-completion inputs and `.is-complete` classes;
- restore `2026 年 7 月`;
- restore the default settings tab;
- set the live-region message to `演示状态已重置`;
- collapse the prototype panel and restore its accessible label.

Remove all references to `shell.dataset.theme`, `themeButton`, background mode, or desktop blend.

- [ ] **Step 2: Add a regression assertion for reset**

Update `toggles task completion and resets presentation state` to end with:

```ts
await expect(task).not.toBeChecked();
await expect(page.getByRole('heading', { name: '2026 年 7 月' })).toBeVisible();
await expect(page.getByText('演示状态已重置')).toHaveText('演示状态已重置');
await expect(page.getByRole('button', { name: '展开原型控制器' })).toBeVisible();
```

- [ ] **Step 3: Update the docs index**

Add under Product Specs:

```md
- [Nowly Good 设计系统原型重设计规格](./superpowers/specs/2026-07-29-nowly-good-design-system-prototype-redesign.md)
```

Add under Implementation Plans:

```md
- [Nowly Good 设计系统原型重设计实施计划](./superpowers/plans/2026-07-29-nowly-good-design-system-prototype-redesign.md)
```

- [ ] **Step 4: Run source scans**

```bash
rg -n "#009ef7|#181c32|#7e8299|backdrop-filter|radial-gradient|linear-gradient|桌面融合|toggle-theme" docs/prototypes/nowly-final-uiux.html
```

Expected: no output.

```bash
rg -n "transition\s*:|animation\s*:|scroll-behavior\s*:\s*smooth" docs/prototypes/nowly-final-uiux.html
```

Expected: only the required global `animation: none`, `animation-duration: 0s`, and `transition: none` declarations; no smooth scrolling.

- [ ] **Step 5: Run the complete prototype test suite**

```bash
npx playwright test tests/nowly-prototype.spec.ts
```

Expected: PASS in `1366x768`, `1920x1080`, `2560x1440`, and `5120x1440` projects.

- [ ] **Step 6: Run repository verification**

```bash
npm test
npm run build
git diff --check
```

Expected: Vitest PASS, TypeScript/Vite build PASS, and no whitespace errors.

- [ ] **Step 7: Commit final integration**

```bash
git add docs/00-index.md tests/nowly-prototype.spec.ts docs/prototypes/nowly-final-uiux.html
git add -f docs/superpowers/plans/2026-07-29-nowly-good-design-system-prototype-redesign.md
git commit -m "feature: complete Good prototype redesign"
```

## Plan Self-Review

- Spec coverage: Good Token replacement, deleted desktop blend mode, fixed single-screen architecture, five dialogs, settings replacement, no motion, accessibility, minimum 1366×768, and unbounded larger viewports each have an implementation and verification task.
- Placeholder scan: no TBD, TODO, deferred implementation, or unspecified test step remains.
- Naming consistency: selectors and data hooks match the current prototype (`.app-shell`, `.app-shell__inner`, `.workspace`, `.card`, `.btn-primary`, `[data-dialog]`, `[data-task-row]`, `[data-settings-tab]`, and prototype controller hooks).
