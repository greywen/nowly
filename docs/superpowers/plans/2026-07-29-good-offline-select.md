# Good Offline Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an accessible, dependency-free Good Select2-style React single-select and integrate standard and searchable variants into Nowly task and event forms.

**Architecture:** A focused controlled `Select` component owns only popup, query, active-option, focus, and positioning state. Modal components own business values and map existing task/event data into options; shared CSS implements the authoritative Good visual tokens without animation.

**Tech Stack:** React, TypeScript, Lucide React, CSS, Vitest, Testing Library, user-event

---

## File Structure

- Create `src/components/Select.tsx`: controlled combobox/listbox behavior, filtering, keyboard interaction, outside-click handling, hidden form input, and bounded popup positioning.
- Create `src/components/Select.test.tsx`: component-level behavior and accessibility tests.
- Modify `src/app/styles.css`: Good Select visual rules, shared form field rules, focus states, popup positioning, and global no-animation enforcement.
- Modify `src/modals/TaskModal.tsx`: controlled quadrant, priority, and searchable linked-event fields.
- Modify `src/modals/EventModal.tsx`: controlled category and searchable linked-task fields.
- Modify `src/modals/ModalRoot.tsx`: provide existing sample task/event collections to the appropriate modal.
- Modify `src/modals/ModalRoot.test.tsx`: integration tests for fields, source options, and local selection changes.
- Modify `docs/00-index.md`: link this implementation plan.

### Task 1: Core Select semantics and pointer selection

**Files:**
- Create: `src/components/Select.tsx`
- Create: `src/components/Select.test.tsx`

- [ ] **Step 1: Write failing render and pointer-selection tests**

Create `src/components/Select.test.tsx` with tests that render a controlled harness containing options `{ value: 'high', label: '高' }` and `{ value: 'medium', label: '中' }`. Assert the trigger has role `combobox`, accessible name `优先级`, initial text `高`, `aria-expanded="false"`, and a hidden input named `priority` with value `high`. Click the trigger, assert listbox/options and `aria-selected`, click `中`, then assert the trigger and hidden input update and the listbox closes.

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' }
];

function Harness({ searchable = false, disabled = false }) {
  const [value, setValue] = useState('high');
  return (
    <Select
      id="priority"
      name="priority"
      label="优先级"
      options={options}
      value={value}
      onChange={setValue}
      searchable={searchable}
      disabled={disabled}
    />
  );
}

describe('Select', () => {
  it('exposes combobox semantics and submits the controlled value', () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    expect(trigger).toHaveTextContent('高');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('input[name="priority"]')).toHaveValue('high');
  });

  it('opens a listbox and selects an option with the pointer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: '优先级' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: '高' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: '中' }));
    expect(trigger).toHaveTextContent('中');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/components/Select.test.tsx`

Expected: FAIL because `./Select` does not exist.

- [ ] **Step 3: Implement minimal controlled Select**

Create `src/components/Select.tsx` defining:

```tsx
export type SelectOption = { value: string; label: string };
export type SelectProps = {
  id: string;
  name?: string;
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
};
```

Use `useId` for listbox IDs, a labelled `<button type="button" role="combobox">`, a hidden `<input type="hidden">`, and conditional `<div role="listbox">` containing `<button type="button" role="option">` options. Add `ChevronDown` and `Check` from `lucide-react`. On option click, call `onChange`, close, and focus the trigger.

- [ ] **Step 4: Run component tests**

Run: `npm test -- src/components/Select.test.tsx`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit core component**

```bash
git add src/components/Select.tsx src/components/Select.test.tsx
git commit -m "feature: add accessible Select foundation"
```

### Task 2: Search, empty states, keyboard behavior, and dismissal

**Files:**
- Modify: `src/components/Select.tsx`
- Modify: `src/components/Select.test.tsx`

- [ ] **Step 1: Add failing search and empty-state tests**

Add tests that open `searchable` mode, find `搜索优先级`, type `中`, and assert only `中` remains. Clear and type `不存在` to assert `未找到匹配项`. Add a separate render with `options={[]}` and assert `暂无可选项` after opening.

```tsx
it('filters searchable options and reports no matches', async () => {
  const user = userEvent.setup();
  render(<Harness searchable />);
  await user.click(screen.getByRole('combobox', { name: '优先级' }));
  const search = screen.getByRole('searchbox', { name: '搜索优先级' });
  await user.type(search, '中');
  expect(screen.queryByRole('option', { name: '高' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: '中' })).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, '不存在');
  expect(screen.getByText('未找到匹配项')).toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing keyboard, outside-click, and disabled tests**

Test `ArrowDown`, `End`, `Home`, `Enter`, `Space`, and `Escape`. Verify `aria-activedescendant`, selection, popup closure, and trigger focus. Open and click `document.body` to assert closure. Render disabled and assert the trigger is disabled and cannot open.

- [ ] **Step 3: Run tests and verify the new cases fail**

Run: `npm test -- src/components/Select.test.tsx`

Expected: Existing tests pass; search, keyboard, dismissal, and disabled tests FAIL.

- [ ] **Step 4: Implement interaction state**

In `Select.tsx`, add `query`, `activeIndex`, filtered options via `useMemo`, refs for root/trigger/search, and document `pointerdown` dismissal while open. Reset query on close. Implement key handling:

- closed `Enter`, `Space`, `ArrowDown`, or `ArrowUp` opens;
- open `ArrowDown/Up` wraps through filtered options;
- `Home/End` selects first/last active option;
- `Enter` or `Space` chooses the active option;
- `Escape` closes and restores trigger focus;
- printable keys in non-searchable mode move to the first case-insensitive label prefix match.

When searchable mode opens, focus the searchbox. Keep `aria-activedescendant` on the combobox and searchbox. Use “暂无可选项” when the source is empty and “未找到匹配项” only when filtering removed all source options.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/components/Select.test.tsx`

Expected: All Select behavior tests PASS.

- [ ] **Step 6: Commit complete interactions**

```bash
git add src/components/Select.tsx src/components/Select.test.tsx
git commit -m "feature: add Select search and keyboard interactions"
```

### Task 3: Good visuals and bounded popup placement

**Files:**
- Modify: `src/components/Select.tsx`
- Modify: `src/components/Select.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing style-contract and placement tests**

Add assertions for stable component classes (`select-field`, `select-trigger`, `select-popup`, `select-option`, `select-search`) and a test mocking trigger/root rectangles plus `window.innerHeight` to verify the popup receives `select-popup--above` when lower space is insufficient. Read `src/app/styles.css` in a Vitest test using Node `fs` and assert it contains the required primary/background/radius/shadow values and contains no `transition:` or `animation:` declarations other than the global forced `none` rules.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/components/Select.test.tsx`

Expected: FAIL because visual classes and placement logic are incomplete.

- [ ] **Step 3: Add popup measurement and class contracts**

In `Select.tsx`, compute placement on open and `resize`. Compare space below and above within the nearest modal body/viewport, choose above only when below cannot fit the desired popup and above has more room, and set a pixel `maxHeight`. Keep width constrained to the root. Apply modifier classes without transitions.

- [ ] **Step 4: Implement Good Select CSS**

Extend `src/app/styles.css` with authoritative variables and focused component rules:

```css
:root {
  --color-primary: #4fc9da;
  --color-primary-active: #30a6b6;
  --color-primary-light: #ddf8fc;
  --bg-surface: #fff;
  --bg-subtle: #f8f6f2;
  --text-secondary: #716d66;
  --text-muted: #968e7e;
  --border-default: #eaeaea;
  --radius-default: 15.2px;
  --focus-ring: rgba(79, 201, 218, 0.25);
  --shadow-dropdown: 0 0 50px 0 rgba(82, 63, 105, 0.15);
}

*, *::before, *::after {
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
```

Style the field label at the approved caption level; trigger at 48px with solid warm background, 16px text, 16px horizontal padding, and focus ring; popup as absolute white surface with radius/shadow; search as a 44px warm input; options with warm hover and primary-light selected states; and static empty/disabled states. Ensure the option list, not the entire modal, scrolls.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- src/components/Select.test.tsx && npm run build`

Expected: tests PASS and TypeScript/Vite build succeeds.

- [ ] **Step 6: Commit styling and placement**

```bash
git add src/components/Select.tsx src/components/Select.test.tsx src/app/styles.css
git commit -m "feature: style Select with Good design system"
```

### Task 4: Integrate Select into task and event modals

**Files:**
- Modify: `src/modals/TaskModal.tsx`
- Modify: `src/modals/EventModal.tsx`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/modals/ModalRoot.test.tsx`

- [ ] **Step 1: Write failing task-modal integration tests**

Update task rendering to provide `events={sampleEvents}`. Assert comboboxes named `所属象限`, `优先级`, and `关联日程` exist. Verify initial values map from `task.quadrant`, `task.priority`, and `task.linkedEventId`; open searchable `关联日程`, search `站会`, choose it, and assert the trigger displays `站会`. Also verify an option `{ value: '', label: '无关联' }` is available.

- [ ] **Step 2: Write failing event-modal integration tests**

Update event rendering to provide `tasks={sampleTasks}`. Assert comboboxes named `分类` and `关联任务` exist. Verify category mapping (`work` → `工作`, `personal` → `个人`) and linked task mapping; search and select a task and assert the local display updates. Verify `无关联` is available.

- [ ] **Step 3: Run integration tests and verify failure**

Run: `npm test -- src/modals/ModalRoot.test.tsx`

Expected: FAIL because modal props and fields do not exist.

- [ ] **Step 4: Implement TaskModal fields**

Change props to include `events: CalendarEvent[]`. Add local state initialized from the task. Build exact option sets:

```tsx
const quadrantOptions = Object.entries(quadrantLabels).map(([value, label]) => ({ value, label }));
const priorityOptions = [
  { value: '1', label: '高' },
  { value: '2', label: '中' },
  { value: '3', label: '低' }
];
const eventOptions = [
  { value: '', label: '无关联' },
  ...events.map((event) => ({ value: event.id, label: event.title }))
];
```

Render standard Select for quadrant and priority and searchable Select for linked event. Preserve existing title and note fields. Replace obsolete arbitrary blue/slate modal field styling touched by this work with shared Good form/modal classes.

- [ ] **Step 5: Implement EventModal fields**

Change props to include `tasks: MatrixTask[]`. Add local state initialized from `event.categoryId` and `event.linkedTaskId`. Use categories `工作`, `个人`, and `生活`, and a searchable task option list prefixed with `无关联`. Preserve title, start, and note fields, using shared Good form/modal classes for touched controls.

- [ ] **Step 6: Supply collections in ModalRoot**

Import `sampleEvents` and `sampleTasks`. Pass `events={sampleEvents}` to `TaskModal` and `tasks={sampleTasks}` to `EventModal`. No global data layer or persistence changes are introduced.

- [ ] **Step 7: Run integration and full unit tests**

Run: `npm test -- src/modals/ModalRoot.test.tsx`

Expected: integration tests PASS.

Run: `npm test`

Expected: complete Vitest suite PASS.

- [ ] **Step 8: Commit modal integration**

```bash
git add src/modals/TaskModal.tsx src/modals/EventModal.tsx src/modals/ModalRoot.tsx src/modals/ModalRoot.test.tsx src/app/styles.css
git commit -m "feature: use Select in task and event forms"
```

### Task 5: Final verification and documentation

**Files:**
- Modify: `docs/00-index.md`
- Modify only if verification exposes defects: files from Tasks 1–4

- [ ] **Step 1: Link the implementation plan**

Add this entry under Implementation Plans in `docs/00-index.md`:

```markdown
- [Good 离线 Select 实施计划](./superpowers/plans/2026-07-29-good-offline-select.md)
```

- [ ] **Step 2: Run automated acceptance checks**

Run: `npm test && npm run build`

Expected: all tests PASS and production build succeeds.

- [ ] **Step 3: Run targeted source checks**

Run:

```bash
rg -n "transition:|animation:" src/app/styles.css
rg -n "#009EF7|#009ef7|#181C32|#181c32|#7E8299|#7e8299" src/components src/modals src/app/styles.css
```

Expected: only the mandatory global `animation: none` and `transition: none` rules are returned by the first command; the second command returns no matches in newly touched UI code.

- [ ] **Step 4: Run browser acceptance checks**

Start `npm run dev -- --host 127.0.0.1`, open a task and event modal, and verify pointer selection, Chinese search, no-result text, keyboard navigation, outside click, Escape focus return, upward placement near the lower modal edge, and zero animation. Confirm the popup stays inside the modal/viewport.

- [ ] **Step 5: Review the implementation against the design spec**

Compare the result with `docs/superpowers/specs/2026-07-29-good-offline-select-design.md` and the `design.md` acceptance checklist. Confirm no persistence, settings, or HTML prototype work entered the commit.

- [ ] **Step 6: Commit documentation and final fixes**

```bash
git add docs/00-index.md docs/superpowers/plans/2026-07-29-good-offline-select.md src/components src/modals src/app/styles.css
git commit -m "docs: add Good offline select implementation plan"
```

Do not stage the pre-existing unrelated modification to `docs/prototypes/nowly-final-uiux.html`.
