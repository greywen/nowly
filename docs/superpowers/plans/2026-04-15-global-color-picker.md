# 全局通用取色板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将所有入口的取色板统一为一排 5 个全局共享颜色加一个自定义按钮，并对颜色历史进行去重、持久化和从左到右替换。

**Architecture:** 在 `src/lib/color.ts` 放置唯一默认颜色和纯函数，组件只负责展示与取色交互；App 负责将颜色选择立即写入 Settings 的全局 `recentColors`。业务入口继续传递同一份 settings 数据，但不再决定颜色列表。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri Repository settings persistence.

---

### Task 1: Add the global color-list rules with tests

**Files:**
- Modify: `src/lib/color.test.ts`
- Modify: `src/lib/color.ts`

- [ ] **Step 1: Write failing tests** for the five exact defaults, producing a five-color display list, replacing positions from left to right, replacing the oldest position after five custom colors, and removing case-insensitive duplicates.

```ts
it('builds the global five-color palette from defaults and custom history', () => {
  expect(buildGlobalColorPalette([])).toEqual(DEFAULT_COLOR_VALUES);
  expect(buildGlobalColorPalette(['#abcdef', '#123456'])).toEqual([
    '#ABCDEF', '#123456', '#0D6EFD', '#FFC107', '#DC3545'
  ]);
});

it('deduplicates colors and cycles replacement from left to right', () => {
  expect(buildGlobalColorPalette(['#abcdef', '#ABCDEF', '#123456'])).toEqual([
    '#ABCDEF', '#123456', '#0D6EFD', '#FFC107', '#DC3545'
  ]);
  expect(buildGlobalColorPalette(['#1A1A1A', '#2B2B2B', '#3C3C3C', '#4D4D4D', '#5E5E5E', '#6F6F6F'])).toEqual([
    '#6F6F6F', '#2B2B2B', '#3C3C3C', '#4D4D4D', '#5E5E5E'
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails** because the new palette constant/function does not exist.

Run: `npm test -- src/lib/color.test.ts`
Expected: FAIL with missing export errors.

- [ ] **Step 3: Implement the minimal pure API**: export `DEFAULT_COLOR_VALUES`, export `DEFAULT_COLOR_PRESETS` with accessible Chinese labels, and implement `buildGlobalColorPalette(values)` by normalizing, deduplicating, keeping the most recent value first, filling remaining slots with defaults, and returning exactly five values.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run: `npm test -- src/lib/color.test.ts`
Expected: PASS.

### Task 2: Make ColorPicker a single-row visual-only palette

**Files:**
- Modify: `src/components/ColorPicker.tsx`
- Modify: `src/components/ColorPicker.test.tsx`
- Modify: `src/index.css` or the existing stylesheet containing `.color-picker` styles

- [ ] **Step 1: Write failing component tests** asserting that default rendering has exactly five color radios plus one custom button, contains no visible preset/recent labels or HEX text, and renders the choices in one no-wrap container.

```tsx
it('renders one row of five swatches plus custom color control', () => {
  render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={vi.fn()} />);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(screen.getByRole('button', { name: '选择自定义颜色' })).toBeInTheDocument();
  expect(screen.queryByText('青绿')).not.toBeInTheDocument();
  expect(screen.queryByText('最近使用 1')).not.toBeInTheDocument();
  expect(screen.queryByText('#4FC9DA')).not.toBeInTheDocument();
  expect(document.querySelector('.color-picker__choices')).toHaveClass('color-picker__choices--single-row');
});
```

- [ ] **Step 2: Run the focused component test and verify it fails** because the current component renders labels and filters the five choices.

Run: `npm test -- src/components/ColorPicker.test.tsx`
Expected: FAIL on radio count/visible labels/class assertion.

- [ ] **Step 3: Implement the component change**: derive choices from `buildGlobalColorPalette(recentColors)`, use the five values as radio swatches with `aria-label="颜色 ${value}"` (accessible only), remove visible labels, retain the custom trigger, and keep the existing HSV popover behavior. Preserve prop compatibility while ignoring business-specific `presets` for display.

- [ ] **Step 4: Add the single-row CSS** using the existing design tokens: `display:flex`, `flex-wrap:nowrap`, consistent `40px` swatches, `gap:8px`, and overflow handling without transitions or animations. Ensure the custom control remains the sixth item.

- [ ] **Step 5: Run component tests and verify they pass.**

Run: `npm test -- src/components/ColorPicker.test.tsx`
Expected: PASS.

### Task 3: Record every selected color through the single global settings path

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/useAppBootstrap.ts` or settings initialization if required
- Modify: affected modal/widget tests covering color persistence

- [ ] **Step 1: Add a failing integration assertion** that selecting a palette/custom color invokes the global settings update immediately, and that repeated colors are stored once.

```tsx
expect(repository.updateSettings).toHaveBeenCalledWith(
  expect.objectContaining({ recentColors: ['#7C5CFC'] })
);
```

- [ ] **Step 2: Run the focused integration test and verify it fails** because current custom-color remembering only occurs after selected business records are saved.

Run: `npm test -- src/app/App.test.tsx src/kanban/KanbanWidget.test.tsx`
Expected: FAIL on immediate settings update.

- [ ] **Step 3: Implement one App-level handler** that calls `addRecentColor` for every ColorPicker selection, saves settings with the resulting list, and keeps save failures isolated from the color selection. Pass the handler to every color-bearing modal/widget and avoid a second duplicate update on business save.

- [ ] **Step 4: Ensure default colors are not added to custom history** while custom colors are added immediately; the component still displays defaults to fill the five slots.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run: `npm test -- src/app/App.test.tsx src/kanban/KanbanWidget.test.tsx src/components/ColorPicker.test.tsx`
Expected: PASS.

### Task 4: Full verification and cleanup

**Files:**
- Modify: only files required by failing tests or formatting/type errors

- [ ] **Step 1: Run the complete unit test suite.**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run the production build.**

Run: `npm run build`
Expected: TypeScript compilation and Vite build complete successfully.

- [ ] **Step 3: Inspect the diff** for old visible color labels, wrapping styles, duplicate history paths, forbidden transitions/animations, and accidental unrelated changes.

- [ ] **Step 4: Commit the implementation** using the required format.

```bash
git add src docs/superpowers/plans/2026-04-15-global-color-picker.md
git commit -m "feature: unify global color picker history"
```
