# Good Custom Solid Checks and Radios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Good Custom Solid checkbox and radio structure and styling to every native check/radio control in the standalone Nowly prototype and codify it in `design.md`.

**Architecture:** Keep native checkbox/radio inputs for accessibility, add reusable `.form-check`, `.form-check-custom`, `.form-check-solid`, `.form-check-input`, and `.form-check-label` classes inside the standalone HTML, and preserve existing task/dialog state behavior. Playwright first enforces structure, computed styles, selected states, and accessibility before implementation changes.

**Tech Stack:** HTML5, native CSS, vanilla JavaScript, Playwright, TypeScript, Markdown

---

## File Structure

- Modify `tests/nowly-prototype.spec.ts`: add source-structure and computed-style contracts for all checkbox/radio controls.
- Modify `docs/prototypes/nowly-final-uiux.html`: add Good Custom Solid CSS and update every checkbox/radio structure without changing business behavior.
- Modify `design.md`: add the authoritative checkbox/radio component specification and checklist item.
- Modify `docs/00-index.md`: link the new specification and implementation plan.

### Task 1: Establish Good check/radio contracts

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`

- [ ] **Step 1: Add a failing structure test**

```ts
test('uses Good Custom Solid structure for every checkbox and radio', async ({ page }) => {
  await loadPrototype(page);
  const inputs = page.locator('input[type="checkbox"], input[type="radio"]');
  expect(await inputs.count()).toBeGreaterThan(0);
  await expect(inputs).toHaveClass(/form-check-input/);
  const invalid = await inputs.evaluateAll((elements) => elements.filter((element) => {
    const wrapper = element.closest('.form-check');
    return !wrapper?.classList.contains('form-check-custom') || !wrapper.classList.contains('form-check-solid');
  }).length);
  expect(invalid).toBe(0);
});
```

- [ ] **Step 2: Add failing computed-style tests**

```ts
test('renders Good solid checkbox states', async ({ page }) => {
  await loadPrototype(page);
  const checkbox = page.getByLabel('完成任务：发布 Nowly v0.1');
  const unchecked = await checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.width, height: style.height, background: style.backgroundColor, border: style.borderWidth, radius: style.borderRadius };
  });
  expect(unchecked).toEqual({ width: '28px', height: '28px', background: 'rgb(246, 241, 233)', border: '0px', radius: '7.2px' });
  await checkbox.check();
  const checked = await checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, image: style.backgroundImage };
  });
  expect(checked.background).toBe('rgb(79, 201, 218)');
  expect(checked.image).toContain('data:image/svg+xml');
});

test('renders Good solid radio states', async ({ page }) => {
  await loadPrototype(page);
  await page.getByRole('button', { name: '编辑任务：发布 Nowly v0.1' }).click();
  const radio = page.getByRole('radio', { name: '重要且紧急' });
  const style = await radio.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { width: computed.width, height: computed.height, background: computed.backgroundColor, radius: computed.borderRadius, image: computed.backgroundImage };
  });
  expect(style.width).toBe('28px');
  expect(style.height).toBe('28px');
  expect(style.background).toBe('rgb(79, 201, 218)');
  expect(style.radius).toBe('50%');
  expect(style.image).toContain('data:image/svg+xml');
});
```

- [ ] **Step 3: Run tests to verify RED**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "Good Custom Solid|Good solid checkbox|Good solid radio"
```

Expected: FAIL because existing inputs lack Good classes and use browser-native rendering.

- [ ] **Step 4: Commit failing tests**

```bash
git add tests/nowly-prototype.spec.ts
git commit -m "test: define Good form control contracts"
```

### Task 2: Implement reusable Good Custom Solid controls

**Files:**
- Modify: `docs/prototypes/nowly-final-uiux.html`

- [ ] **Step 1: Add the reusable CSS**

```css
.form-check { min-height: 28px; margin: 0; }
.form-check-custom { display: flex; align-items: center; gap: 12px; padding: 0; }
.form-check-input {
  appearance: none;
  width: 28px;
  height: 28px;
  margin: 0;
  flex: 0 0 28px;
  vertical-align: top;
  border: 0;
  background-color: transparent;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
.form-check-solid .form-check-input:not(:checked) { background-color: var(--bg-secondary); }
.form-check-input[type="checkbox"] { border-radius: .45em; background-size: 60% 60%; }
.form-check-input[type="radio"] { border-radius: 50%; }
.form-check-input:checked { background-color: var(--color-primary); }
.form-check-input:checked[type="checkbox"] { background-image: url("data:image/svg+xml,...Good white check..."); }
.form-check-input:checked[type="radio"] { background-image: url("data:image/svg+xml,...Good white dot..."); }
.form-check-input:focus { outline: 0; box-shadow: none; }
.form-check-input:focus-visible { box-shadow: 0 0 0 4px var(--focus-ring); }
.form-check-input:disabled { pointer-events: none; opacity: .5; }
.form-check-label { color: var(--text-secondary); font-size: 15.2px; font-weight: 500; line-height: 1.5; }
```

Use the exact encoded Good SVG paths extracted in the written specification/reference stylesheet, not the abbreviated comments shown above.

- [ ] **Step 2: Update all task checkboxes**

For each quadrant task, apply `class="form-check-input"` to the input and make `.task` also carry `form-check form-check-custom form-check-solid`. Preserve `data-task-row`, `aria-label`, `.task-copy`, and task completion behavior.

- [ ] **Step 3: Update all dialog checkbox and radio labels**

Each wrapper becomes:

```html
<label class="form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="checkbox">
  <span class="form-check-label">Label text</span>
</label>
```

For choice cards retain `.choice` alongside the Good classes:

```html
<label class="choice form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="radio" name="quadrant">
  <span class="form-check-label">重要且紧急</span>
</label>
```

- [ ] **Step 4: Remove old task input styling**

Delete `.task input { ... accent-color ... }` and replace layout-specific margins with `.task .form-check-input { margin-top: 0; }`. Ensure `.choice:has(input:checked)` remains functional.

- [ ] **Step 5: Run focused tests to verify GREEN**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "Good Custom Solid|Good solid checkbox|Good solid radio|toggles task completion|dialog forms"
```

Expected: PASS.

- [ ] **Step 6: Commit implementation**

```bash
git add -f docs/prototypes/nowly-final-uiux.html tests/nowly-prototype.spec.ts
git commit -m "feature: apply Good solid form controls"
```

### Task 3: Codify and verify the design system rule

**Files:**
- Modify: `design.md`
- Modify: `docs/00-index.md`

- [ ] **Step 1: Add Checkbox and Radio to `design.md`**

Insert `### 8.6 Checkbox 与 Radio` before the current labels section and renumber later component headings. Include the exact structure, 28px dimensions, `.45em`/`50%` radii, `#F6F1E9` unchecked surface, `#4FC9DA` selected surface, white marks, 12px label gap, focus-visible, disabled, native semantics, and no-motion rules.

- [ ] **Step 2: Add the design checklist item**

Under Component checks add:

```md
- [ ] 所有 Checkbox 和 Radio 使用 Good Custom Solid 结构、28px 尺寸及规定状态样式。
```

- [ ] **Step 3: Link docs**

Add the specification under Product Specs and this plan under Implementation Plans in `docs/00-index.md`.

- [ ] **Step 4: Run complete verification**

```bash
npx playwright test tests/nowly-prototype.spec.ts
npm test
npm run build
git diff --check
```

Expected: all Playwright projects PASS, Vitest PASS, build PASS, and no whitespace errors.

- [ ] **Step 5: Scan for unstyled controls**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('docs/prototypes/nowly-final-uiux.html','utf8');const inputs=[...s.matchAll(/<input[^>]+type=\"(checkbox|radio)\"[^>]*>/g)].map(x=>x[0]);if(inputs.some(x=>!x.includes('form-check-input')))process.exit(1);console.log(inputs.length+' Good controls verified')"
```

Expected: all controls verified.

- [ ] **Step 6: Commit documentation and final integration**

```bash
git add design.md docs/00-index.md
git add -f docs/superpowers/plans/2026-07-29-good-custom-solid-checks-radios.md
git commit -m "docs: standardize Good checks and radios"
```

## Plan Self-Review

- Spec coverage: all prototype checkboxes/radios, exact Good structure, dimensions, checked imagery, focus, disabled, accessibility, no motion, design documentation, and responsive regression are covered.
- Placeholder scan: implementation uses the exact reference requirement; the abbreviated SVG notation appears only in the explanatory CSS sample and explicitly requires the extracted full Good SVG in implementation.
- Selector consistency: `.form-check`, `.form-check-custom`, `.form-check-solid`, `.form-check-input`, `.form-check-label`, `.choice`, `.task`, and existing data hooks match the current prototype.
