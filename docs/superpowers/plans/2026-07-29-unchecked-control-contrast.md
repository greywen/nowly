# Unchecked Good Control Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unchecked Good Solid checkbox and radio controls clearly visible on every quadrant background by changing their solid surface from `#F6F1E9` to `#DAD3C3`.

**Architecture:** Change the shared unchecked-state CSS token use once so all checkbox/radio instances remain consistent. Update the authoritative design rule and computed-style regression test; retain the existing no-border, checked, focus, disabled, and no-motion behavior.

**Tech Stack:** HTML/CSS, Playwright, Markdown

---

### Task 1: Reproduce and fix unchecked contrast

**Files:**
- Modify: `tests/nowly-prototype.spec.ts`
- Modify: `docs/prototypes/nowly-final-uiux.html`
- Modify: `design.md`

- [ ] **Step 1: Change the existing computed-style expectation**

In `renders Good solid checkbox states`, change the expected unchecked background from:

```ts
background: 'rgb(246, 241, 233)'
```

to:

```ts
background: 'rgb(218, 211, 195)'
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "Good solid checkbox states"
```

Expected: FAIL because the current computed background remains `rgb(246, 241, 233)`.

- [ ] **Step 3: Implement the shared contrast fix**

Change:

```css
.form-check-solid .form-check-input:not(:checked) { background-color: var(--bg-secondary); }
```

to:

```css
.form-check-solid .form-check-input:not(:checked) { background-color: var(--border-emphasis); }
```

`--border-emphasis` resolves to `#DAD3C3`.

- [ ] **Step 4: Update `design.md`**

Change the unchecked background rule from `#F6F1E9` to `#DAD3C3`, and explain that the stronger neutral surface is required for visibility on all quadrant backgrounds while retaining zero border.

- [ ] **Step 5: Run focused and complete verification**

```bash
npx playwright test tests/nowly-prototype.spec.ts --project=1366x768 --grep "Good solid checkbox states"
npx playwright test tests/nowly-prototype.spec.ts
npm test
npm run build
git diff --check
```

Expected: all tests and build PASS.

- [ ] **Step 6: Commit**

```bash
git add design.md tests/nowly-prototype.spec.ts
git add -f docs/prototypes/nowly-final-uiux.html docs/superpowers/plans/2026-07-29-unchecked-control-contrast.md
git commit -m "fix: improve unchecked control contrast"
```
