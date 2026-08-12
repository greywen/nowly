# Unified Color Picker and Kanban Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every calendar, note, lane, priority, and tag color as HEX; provide one accessible preset/custom/recent color picker; and simplify and align the kanban UI.

**Architecture:** A framework-independent color utility owns HEX validation, normalization, derived display colors, and recent-color ordering. A shared React `ColorPicker` renders module-specific presets plus native system color input and global recent colors. `App` owns the settings-backed recent-color callback and passes it through `ModalRoot` and `KanbanWidget`; Rust migration 10 converts all legacy color names and adds the settings value before commands switch to strict HEX validation.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS custom properties, Tauri 2, Rust, rusqlite, Playwright.

---

## File map

**Create**

- `src/lib/color.ts` — canonical HEX constants, validation, normalization, derived rendering colors, style variables, and recent-color ordering.
- `src/lib/color.test.ts` — pure color and recent-list tests.
- `src/components/ColorPicker.tsx` — reusable accessible preset/recent/custom chooser.
- `src/components/ColorPicker.test.tsx` — shared picker behavior and markup tests.
- `src-tauri/src/color.rs` — Rust HEX validation and normalization shared by events, notes, and kanban.

**Modify**

- `src/calendar/calendar-model.ts`, `src/notes/notes-model.ts`, `src/kanban/kanban-model.ts` — replace named color unions with `HexColor` and publish module presets/defaults.
- `src/lib/event-draft.ts`, `src/lib/event-draft.test.ts`, `src/lib/note-draft.ts`, `src/lib/note-draft.test.ts`, `src/kanban/card-draft.test.ts` — use HEX defaults and validation.
- `src-tauri/src/db.rs` — migration 10 for legacy values and `recent_colors` setting.
- `src-tauri/src/main.rs` — register the shared Rust color module.
- `src-tauri/src/events.rs`, `src-tauri/src/notes.rs`, `src-tauri/src/kanban.rs` — strict shared HEX validation and normalization.
- `src-tauri/src/models.rs`, `src-tauri/src/settings.rs` — add `recent_colors` to settings and sanitize it.
- `src/data/nowly-repository.ts` — add `recentColors` to `AppSettings`.
- `src/settings/useSettings.ts` and associated settings/app/modal tests — default and transport the new field.
- `src/modals/EventModal.tsx`, `src/modals/NoteModal.tsx`, `src/modals/ModalRoot.tsx` — use `ColorPicker` and record a custom color only after successful business save.
- `src/kanban/KanbanLaneDialog.tsx`, `src/kanban/KanbanFieldManagerDialog.tsx`, `src/kanban/KanbanWidget.tsx` — use the shared picker and recent-color callback.
- `src/calendar/CalendarWidget.tsx`, `src/notes/NotesWidget.tsx`, `src/kanban/KanbanCard.tsx`, `src/kanban/KanbanLane.tsx`, `src/kanban/KanbanFieldManagerDialog.tsx`, `src/kanban/kanban-view.ts` — render derived colors through CSS variables.
- `src/kanban/KanbanCard.tsx`, `src/kanban/KanbanLane.tsx`, `src/kanban/KanbanWidget.tsx` — remove card menus and card menu movement props; reorder lane title/count.
- `src/app/App.tsx`, `src/app/styles.css` — wire recent colors, add shared picker/variable styles, and remove obsolete named-color rules.
- Existing unit and E2E fixtures that construct colors or settings — update to HEX and `recentColors`.
- `tests/nowly-kanban.spec.ts`, `tests/nowly-events.spec.ts`, `tests/nowly-notes.spec.ts` — reusable end-to-end assertions for the new behavior.

## Commit safety

The working tree already contains uncommitted kanban implementation work. Before each commit, use path-specific `git add` exactly as shown. Never use `git add .`, and do not amend, discard, or reformat unrelated existing changes.

---

### Task 1: Add the canonical TypeScript color domain

**Files:**
- Create: `src/lib/color.ts`
- Create: `src/lib/color.test.ts`

- [ ] **Step 1: Write failing tests for HEX normalization and presets**

```ts
// src/lib/color.test.ts
import { describe, expect, it } from 'vitest';
import {
  addRecentColor,
  contrastRatio,
  deriveColorTone,
  isHexColor,
  normalizeHexColor,
  sanitizeRecentColors
} from './color';

describe('HEX colors', () => {
  it('accepts only six-digit HEX and normalizes it to uppercase', () => {
    expect(isHexColor('#7c5cfc')).toBe(true);
    expect(normalizeHexColor('#7c5cfc')).toBe('#7C5CFC');
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('7C5CFC')).toBe(false);
    expect(normalizeHexColor('purple')).toBeNull();
  });

  it('derives a quiet background and readable foreground', () => {
    const tone = deriveColorTone('#7C5CFC');
    expect(tone.base).toBe('#7C5CFC');
    expect(tone.background).toMatch(/^#[0-9A-F]{6}$/);
    expect(tone.foreground).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrastRatio(tone.foreground, tone.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('recent colors', () => {
  it('deduplicates, moves the newest color first, filters invalid values, and keeps eight', () => {
    const initial = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'];
    expect(addRecentColor(initial, '#333333')).toEqual([
      '#333333', '#111111', '#222222', '#444444', '#555555', '#666666', '#777777', '#888888'
    ]);
    expect(addRecentColor(initial, '#999999')).toEqual([
      '#999999', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'
    ]);
    expect(sanitizeRecentColors(['bad', '#abcdef', '#ABCDEF', '#123456'])).toEqual(['#ABCDEF', '#123456']);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/lib/color.test.ts`

Expected: FAIL because `./color` does not exist.

- [ ] **Step 3: Implement the pure color utility**

```ts
// src/lib/color.ts
import type { CSSProperties } from 'react';

export type HexColor = `#${string}`;
export type ColorPreset = { value: HexColor; label: string };

export const DESIGN_COLORS = {
  primary: '#4FC9DA',
  success: '#B8D935',
  info: '#4F55DA',
  warning: '#E8C444',
  danger: '#F06445'
} as const satisfies Record<string, HexColor>;

export const MAX_RECENT_COLORS = 8;
const HEX = /^#[0-9A-F]{6}$/i;

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX.test(value);
}

export function normalizeHexColor(value: unknown): HexColor | null {
  return isHexColor(value) ? (value.toUpperCase() as HexColor) : null;
}

function rgb(color: HexColor): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

function hex(channels: [number, number, number]): HexColor {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase() as HexColor;
}

function mix(left: HexColor, right: HexColor, rightWeight: number): HexColor {
  const a = rgb(left);
  const b = rgb(right);
  return hex(a.map((channel, index) => channel * (1 - rightWeight) + b[index] * rightWeight) as [number, number, number]);
}

function luminance(color: HexColor): number {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(left: HexColor, right: HexColor): number {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

export function deriveColorTone(value: HexColor) {
  const base = normalizeHexColor(value) as HexColor;
  const background = mix(base, '#FFFFFF', 0.86);
  let foreground = mix(base, '#211F1C', 0.45);
  for (let weight = 0.5; contrastRatio(foreground, background) < 4.5 && weight <= 1; weight += 0.05) {
    foreground = mix(base, '#211F1C', weight);
  }
  return { base, background, foreground };
}

export type ColorStyle = CSSProperties & {
  '--selected-color': HexColor;
  '--selected-color-bg': HexColor;
  '--selected-color-fg': HexColor;
};

export function colorStyle(color: HexColor): ColorStyle {
  const tone = deriveColorTone(color);
  return {
    '--selected-color': tone.base,
    '--selected-color-bg': tone.background,
    '--selected-color-fg': tone.foreground
  };
}

export function sanitizeRecentColors(values: unknown): HexColor[] {
  if (!Array.isArray(values)) return [];
  const result: HexColor[] = [];
  for (const value of values) {
    const normalized = normalizeHexColor(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length === MAX_RECENT_COLORS) break;
  }
  return result;
}

export function addRecentColor(values: readonly string[], value: string): HexColor[] {
  const normalized = normalizeHexColor(value);
  if (!normalized) return sanitizeRecentColors(values);
  return [normalized, ...sanitizeRecentColors(values).filter((color) => color !== normalized)].slice(0, MAX_RECENT_COLORS);
}

export function isPresetColor(color: HexColor, presets: readonly ColorPreset[]): boolean {
  return presets.some((preset) => preset.value === color);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- src/lib/color.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the utility**

```bash
git add src/lib/color.ts src/lib/color.test.ts
git commit -m "feature: add canonical HEX color utilities"
```

---

### Task 2: Convert frontend business models and draft validation to HEX

**Files:**
- Modify: `src/calendar/calendar-model.ts`
- Modify: `src/notes/notes-model.ts`
- Modify: `src/kanban/kanban-model.ts`
- Modify: `src/lib/event-draft.ts`
- Modify: `src/lib/event-draft.test.ts`
- Modify: `src/lib/note-draft.ts`
- Modify: `src/lib/note-draft.test.ts`
- Modify fixtures under `src/**/*.test.tsx` and `src/**/*.test.ts` that use named event/note/kanban colors

- [ ] **Step 1: Change draft tests to require HEX defaults, output, and validation**

Use these assertions in the existing suites:

```ts
expect(createEventDraft('2026-08-12', now)).toMatchObject({ color: '#4FC9DA' });
expect(validateEventForm({ ...form, color: '#7c5cfc' })).toEqual({});
expect(toEventDraft({ ...form, color: '#7c5cfc' })).toMatchObject({ color: '#7C5CFC' });
expect(validateEventForm({ ...form, color: 'purple' as never })).toEqual({ color: '请选择有效颜色。' });

expect(createNoteForm()).toEqual({ title: '', content: '', color: '#E8C444', pinned: false });
expect(toNoteDraft({ ...createNoteForm(), title: '原则', color: '#7c5cfc' })).toMatchObject({ color: '#7C5CFC' });
expect(validateNoteForm({ ...createNoteForm(), title: '原则', color: 'yellow' as never })).toEqual({ color: '请选择有效颜色。' });
```

Update test entities to use `#4FC9DA`, `#B8D935`, `#4F55DA`, `#E8C444`, or `#F06445` rather than named values.

- [ ] **Step 2: Run affected tests and verify RED**

Run: `npm test -- src/lib/event-draft.test.ts src/lib/note-draft.test.ts src/kanban`

Expected: FAIL because defaults/types/validators still use named colors.

- [ ] **Step 3: Define module presets and HEX model types**

```ts
// relevant exports in src/calendar/calendar-model.ts
import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
export type EventColor = HexColor;
export const eventColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.danger, label: '珊瑚红' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.warning, label: '暖黄' }
];
export const DEFAULT_EVENT_COLOR = DESIGN_COLORS.primary;

// relevant exports in src/notes/notes-model.ts
import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
export type NoteColor = HexColor;
export const noteColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.warning, label: '暖黄' },
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.info, label: '靛蓝' }
];
export const DEFAULT_NOTE_COLOR = DESIGN_COLORS.warning;

// relevant exports in src/kanban/kanban-model.ts
import { DESIGN_COLORS, type ColorPreset, type HexColor } from '../lib/color';
export type KanbanColor = HexColor;
export const kanbanColorPresets: readonly ColorPreset[] = [
  { value: DESIGN_COLORS.primary, label: '青绿' },
  { value: DESIGN_COLORS.success, label: '草绿' },
  { value: DESIGN_COLORS.info, label: '靛蓝' },
  { value: DESIGN_COLORS.warning, label: '暖黄' },
  { value: DESIGN_COLORS.danger, label: '珊瑚红' }
];
export const DEFAULT_KANBAN_COLOR = DESIGN_COLORS.primary;
```

Remove `eventColorLabels`, `noteColors`, `kanbanColors`, and `kanbanColorLabels` after their consumers move in later tasks.

- [ ] **Step 4: Normalize and validate in draft helpers**

In `event-draft.ts` and `note-draft.ts`, initialize with the module default, validate with `normalizeHexColor`, and normalize in `toEventDraft` / `toNoteDraft`:

```ts
const normalized = normalizeHexColor(form.color);
if (!normalized) return { color: '请选择有效颜色。' };
// returned draft field
color: normalizeHexColor(form.color) as HexColor
```

- [ ] **Step 5: Update all TypeScript fixtures to HEX and verify GREEN**

Run: `npm test -- src/lib/event-draft.test.ts src/lib/note-draft.test.ts src/kanban src/calendar src/notes`

Expected: PASS after every fixture uses canonical HEX.

- [ ] **Step 6: Commit the model conversion**

```bash
git add src/calendar/calendar-model.ts src/notes/notes-model.ts src/kanban/kanban-model.ts src/lib/event-draft.ts src/lib/event-draft.test.ts src/lib/note-draft.ts src/lib/note-draft.test.ts src/calendar src/notes src/kanban
git commit -m "refactor: unify frontend colors as HEX"
```

Before committing, run `git diff --cached --name-only` and ensure only color model/fixture changes are staged; unstage unrelated kanban files with `git restore --staged <path>`.

---

### Task 3: Add Rust HEX validation and migrate legacy stored colors

**Files:**
- Create: `src-tauri/src/color.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/notes.rs`
- Modify: `src-tauri/src/kanban.rs`

- [ ] **Step 1: Add failing Rust tests for normalization and migration 10**

```rust
// tests in src-tauri/src/color.rs
#[cfg(test)]
mod tests {
    #[test]
    fn normalizes_only_six_digit_hex() {
        assert_eq!(super::normalize_hex("#7c5cfc"), Some("#7C5CFC".into()));
        assert_eq!(super::normalize_hex("#fff"), None);
        assert_eq!(super::normalize_hex("purple"), None);
    }
}
```

Add a `db.rs` test that migrates a version-9 database containing every legacy value:

```rust
#[test]
fn migration_10_converts_legacy_colors_and_adds_recent_colors() {
    let mut connection = Connection::open_in_memory().unwrap();
    migrate(&mut connection).unwrap();
    connection.execute("UPDATE events SET color='blue'", []).unwrap();
    connection.execute("UPDATE notes SET color='purple'", []).unwrap();
    connection.execute("UPDATE kanban_lanes SET color='danger'", []).unwrap();
    connection.execute("DELETE FROM schema_migrations WHERE version=10", []).unwrap();

    migrate(&mut connection).unwrap();

    assert_eq!(connection.query_row("SELECT color FROM events LIMIT 1", [], |r| r.get::<_, String>(0)).unwrap(), "#4FC9DA");
    assert_eq!(connection.query_row("SELECT color FROM notes LIMIT 1", [], |r| r.get::<_, String>(0)).unwrap(), "#4F55DA");
    assert_eq!(connection.query_row("SELECT color FROM kanban_lanes LIMIT 1", [], |r| r.get::<_, String>(0)).unwrap(), "#F06445");
    assert_eq!(connection.query_row("SELECT value FROM settings WHERE key='recent_colors'", [], |r| r.get::<_, String>(0)).unwrap(), "[]");

    connection.execute("DELETE FROM schema_migrations WHERE version=10", []).unwrap();
    migrate(&mut connection).unwrap();
    assert_eq!(connection.query_row("SELECT color FROM notes LIMIT 1", [], |r| r.get::<_, String>(0)).unwrap(), "#4F55DA");
}
```

Ensure the test inserts at least one event and note row before updating them; use complete valid columns matching migration 1.

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cd src-tauri && cargo test color db::tests::migration_10_converts_legacy_colors_and_adds_recent_colors`

Expected: FAIL because `color` and migration 10 do not exist.

- [ ] **Step 3: Implement shared Rust normalization**

```rust
// src-tauri/src/color.rs
pub fn normalize_hex(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(value.to_ascii_uppercase())
}
```

Add `mod color;` beside the other module declarations in `src-tauri/src/main.rs`.

- [ ] **Step 4: Implement migration 10**

Append `(10, migration_10_hex_colors_and_recent_colors)` to `MIGRATIONS`. The migration must execute these deterministic mappings:

```rust
fn migration_10_hex_colors_and_recent_colors(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "UPDATE events SET color = CASE lower(color)
           WHEN 'blue' THEN '#4FC9DA' WHEN 'red' THEN '#F06445'
           WHEN 'green' THEN '#B8D935' WHEN 'yellow' THEN '#E8C444'
           ELSE upper(color) END;
         UPDATE notes SET color = CASE lower(color)
           WHEN 'yellow' THEN '#E8C444' WHEN 'blue' THEN '#4FC9DA'
           WHEN 'green' THEN '#B8D935' WHEN 'purple' THEN '#4F55DA'
           ELSE upper(color) END;
         UPDATE kanban_lanes SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         UPDATE kanban_priorities SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         UPDATE kanban_tags SET color = CASE lower(color)
           WHEN 'primary' THEN '#4FC9DA' WHEN 'success' THEN '#B8D935'
           WHEN 'info' THEN '#4F55DA' WHEN 'warning' THEN '#E8C444'
           WHEN 'danger' THEN '#F06445' ELSE upper(color) END;
         INSERT OR IGNORE INTO settings(key,value,updated_at)
           VALUES ('recent_colors','[]',strftime('%Y-%m-%dT%H:%M:%fZ','now'));"
    )?;

    for (table, fallback) in [
        ("events", "#4FC9DA"), ("notes", "#E8C444"),
        ("kanban_lanes", "#4FC9DA"), ("kanban_priorities", "#4FC9DA"),
        ("kanban_tags", "#4FC9DA")
    ] {
        transaction.execute(
            &format!("UPDATE {table} SET color=?1 WHERE color NOT GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'"),
            [fallback]
        )?;
    }
    Ok(())
}
```

Also change migration 9 seed values to HEX so a fresh database is canonical before migration 10.

- [ ] **Step 5: Replace command-specific named palettes with strict normalization**

In `events.rs`, `notes.rs`, and `kanban.rs`, remove `COLORS`/`KANBAN_COLORS`. Normalize before returning the draft:

```rust
draft.color = crate::color::normalize_hex(&draft.color)
    .ok_or_else(|| CommandError::validation("color", "请选择有效颜色。"))?;
```

Keep every existing title/date/relation validation unchanged.

- [ ] **Step 6: Update Rust fixtures to HEX and verify GREEN**

Run: `cd src-tauri && cargo test`

Expected: all Rust tests PASS.

- [ ] **Step 7: Commit backend migration and validation**

```bash
git add src-tauri/src/color.rs src-tauri/src/main.rs src-tauri/src/db.rs src-tauri/src/events.rs src-tauri/src/notes.rs src-tauri/src/kanban.rs
git commit -m "feature: migrate stored colors to HEX"
```

---

### Task 4: Persist and sanitize recent colors in application settings

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/data/nowly-repository.ts`
- Modify: `src/settings/useSettings.ts`
- Modify: `src/settings/useSettings.test.tsx`
- Modify: `src/settings/SettingsDialog.test.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/useAppBootstrap.ts`
- Modify: `src/app/useAppBootstrap.test.tsx`
- Modify: `src/modals/ModalRoot.test.tsx`

- [ ] **Step 1: Write failing Rust settings tests**

Extend fresh/default and atomic write tests:

```rust
assert!(settings.recent_colors.is_empty());

let settings = crate::models::AppSettings {
    // existing fields unchanged
    recent_colors: vec!["#7c5cfc".into(), "bad".into(), "#7C5CFC".into(), "#123456".into()],
};
let saved = super::write_app_settings(&mut connection, &settings).unwrap();
assert_eq!(saved.recent_colors, vec!["#7C5CFC", "#123456"]);
```

- [ ] **Step 2: Run settings tests and verify RED**

Run: `cd src-tauri && cargo test settings`

Expected: FAIL because `AppSettings` has no `recent_colors`.

- [ ] **Step 3: Add and sanitize the Rust settings field**

Add `pub recent_colors: Vec<String>` to `AppSettings`. Add this helper to `settings.rs`:

```rust
fn sanitize_recent_colors(values: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        if let Some(color) = crate::color::normalize_hex(value) {
            if !result.contains(&color) { result.push(color); }
        }
        if result.len() == 8 { break; }
    }
    result
}
```

Read `recent_colors`, sanitize it, and write the sanitized value. `write_app_settings` must clone settings into `normalized`, assign `normalized.recent_colors`, validate/write `normalized`, and return the reread settings.

- [ ] **Step 4: Verify Rust settings GREEN**

Run: `cd src-tauri && cargo test settings`

Expected: PASS.

- [ ] **Step 5: Write failing frontend settings tests**

Add `recentColors: []` to every `AppSettings` fixture. In `useSettings.test.tsx`, add:

```ts
it('persists recent colors with the rest of settings', async () => {
  const changed = { ...settings, recentColors: ['#7C5CFC'] };
  const updateSettings = vi.fn().mockResolvedValue(changed);
  const { result } = renderHook(useSettings, { wrapper: wrapper(repository(updateSettings)) });
  await waitFor(() => expect(result.current.settings.status).toBe('ready'));
  await act(() => result.current.saveSettings(changed));
  expect(updateSettings).toHaveBeenCalledWith(changed);
  expect(result.current.settings.data.recentColors).toEqual(['#7C5CFC']);
});
```

- [ ] **Step 6: Run frontend settings tests and verify RED**

Run: `npm test -- src/settings src/app/useAppBootstrap.test.tsx src/app/App.test.tsx src/modals/ModalRoot.test.tsx`

Expected: FAIL until types/defaults/fixtures include `recentColors`.

- [ ] **Step 7: Add `recentColors` to frontend settings**

```ts
// in AppSettings
recentColors: HexColor[];

// in both default settings objects
recentColors: []
```

Update all settings fixtures and leave `SettingsDialog` controls unchanged; the field travels through its draft but is not directly editable there.

- [ ] **Step 8: Verify settings tests and commit**

Run: `npm test -- src/settings src/app/useAppBootstrap.test.tsx src/app/App.test.tsx src/modals/ModalRoot.test.tsx`

Expected: PASS.

```bash
git add src-tauri/src/models.rs src-tauri/src/settings.rs src/data/nowly-repository.ts src/settings src/app/useAppBootstrap.ts src/app/useAppBootstrap.test.tsx src/app/App.test.tsx src/modals/ModalRoot.test.tsx
git commit -m "feature: persist recent custom colors"
```

---

### Task 5: Build the shared accessible ColorPicker

**Files:**
- Create: `src/components/ColorPicker.tsx`
- Create: `src/components/ColorPicker.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing component tests**

```tsx
// src/components/ColorPicker.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

const presets = [
  { value: '#4FC9DA' as const, label: '青绿' },
  { value: '#F06445' as const, label: '珊瑚红' }
];

describe('ColorPicker', () => {
  it('renders Good radios for presets and deduplicated recent custom colors without showing HEX text', () => {
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC', '#4FC9DA']} onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '青绿' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '最近使用 1' })).toBeInTheDocument();
    expect(screen.queryByText('#7C5CFC')).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveClass('form-check-input');
      expect(radio.closest('label')).toHaveClass('form-check', 'form-check-custom', 'form-check-solid');
    }
  });

  it('emits a normalized color from the native system picker', () => {
    const onChange = vi.fn();
    render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('选择自定义颜色'), { target: { value: '#7c5cfc' } });
    expect(onChange).toHaveBeenCalledWith('#7C5CFC');
    expect(screen.queryByText('#7C5CFC')).not.toBeInTheDocument();
  });

  it('selects a recent color through its radio and respects disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC']} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '最近使用 1' }));
    expect(onChange).toHaveBeenCalledWith('#7C5CFC');
    rerender(<ColorPicker legend="颜色" name="test-color" value="#4FC9DA" presets={presets} recentColors={['#7C5CFC']} disabled onChange={onChange} />);
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByLabelText('选择自定义颜色')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -- src/components/ColorPicker.test.tsx`

Expected: FAIL because `ColorPicker` does not exist.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/ColorPicker.tsx
import { useId, useRef } from 'react';
import { colorStyle, isPresetColor, normalizeHexColor, sanitizeRecentColors, type ColorPreset, type HexColor } from '../lib/color';

type Props = {
  legend: string;
  name: string;
  value: HexColor;
  presets: readonly ColorPreset[];
  recentColors: readonly HexColor[];
  disabled?: boolean;
  onChange(color: HexColor): void;
};

export function ColorPicker({ legend, name, value, presets, recentColors, disabled = false, onChange }: Props) {
  const id = useId();
  const nativeRef = useRef<HTMLInputElement>(null);
  const recent = sanitizeRecentColors(recentColors).filter((color) => !isPresetColor(color, presets));
  const selectedIsCustom = !isPresetColor(value, presets) && !recent.includes(value);
  const customValue = selectedIsCustom ? value : '#4FC9DA';
  const choices = [
    ...presets.map((preset) => ({ value: preset.value, label: preset.label })),
    ...recent.map((color, index) => ({ value: color, label: `最近使用 ${index + 1}` }))
  ];

  return (
    <fieldset className="color-picker">
      <legend>{legend}</legend>
      <div className="color-picker__choices">
        {choices.map((choice) => (
          <label key={choice.value} className="form-check form-check-custom form-check-solid color-picker__choice" style={colorStyle(choice.value)}>
            <input className="form-check-input" type="radio" name={name} checked={value === choice.value} disabled={disabled} onChange={() => onChange(choice.value)} />
            <span className="color-picker__swatch" aria-hidden="true" />
            <span className="form-check-label">{choice.label}</span>
          </label>
        ))}
        <label className="form-check form-check-custom form-check-solid color-picker__choice" style={colorStyle(customValue)}>
          <input className="form-check-input" type="radio" name={name} checked={selectedIsCustom} disabled={disabled} onChange={() => nativeRef.current?.click()} />
          <span className="color-picker__swatch" aria-hidden="true" />
          <span className="form-check-label">自定义</span>
        </label>
        <input
          ref={nativeRef}
          id={`${id}-native`}
          className="color-picker__native"
          type="color"
          aria-label="选择自定义颜色"
          value={customValue.toLowerCase()}
          disabled={disabled}
          onChange={(event) => {
            const color = normalizeHexColor(event.target.value);
            if (color) onChange(color);
          }}
        />
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Add static design-system CSS**

```css
.color-picker { margin: 0; padding: 0; border: 0; }
.color-picker legend { width: 100%; margin-bottom: 8px; color: var(--text-secondary); font-size: 15.2px; font-weight: 500; }
.color-picker__choices { display: flex; flex-wrap: wrap; gap: 12px 16px; }
.color-picker__choice { position: relative; }
.color-picker__swatch { width: 16px; height: 16px; flex: none; border-radius: 50%; background: var(--selected-color); box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.color-picker__native { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
```

Do not add `transition` or `animation`.

- [ ] **Step 5: Run test and verify GREEN**

Run: `npm test -- src/components/ColorPicker.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the picker**

```bash
git add src/components/ColorPicker.tsx src/components/ColorPicker.test.tsx src/app/styles.css
git commit -m "feature: add shared custom color picker"
```

---

### Task 6: Wire recent colors through App and calendar/note dialogs

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/modals/EventModal.tsx`
- Modify: `src/modals/EventModal.test.tsx`
- Modify: `src/modals/NoteModal.tsx`
- Modify: `src/modals/NoteModal.test.tsx`
- Modify: `src/modals/ModalRoot.test.tsx`

- [ ] **Step 1: Write failing dialog tests for HEX save and post-save recent recording**

For each modal, pass `recentColors={['#7C5CFC']}` and `onRememberCustomColor={remember}`. Add tests equivalent to:

```tsx
it('saves a custom HEX and remembers it only after business save succeeds', async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue({ ...event, color: '#7C5CFC' });
  const remember = vi.fn().mockResolvedValue(undefined);
  render(<EventModal {...baseProps} createEvent={create} recentColors={['#7C5CFC']} onRememberCustomColor={remember} />);
  // Fill the existing required title/date/category fields using current test helpers.
  await user.click(screen.getByRole('radio', { name: '最近使用 1' }));
  await user.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ color: '#7C5CFC' })));
  expect(remember).toHaveBeenCalledWith('#7C5CFC', eventColorPresets);
  expect(create.mock.invocationCallOrder[0]).toBeLessThan(remember.mock.invocationCallOrder[0]);
});
```

Also reject the business save and assert `remember` is not called. Mirror this for `NoteModal` and `noteColorPresets`.

- [ ] **Step 2: Run modal tests and verify RED**

Run: `npm test -- src/modals/EventModal.test.tsx src/modals/NoteModal.test.tsx src/modals/ModalRoot.test.tsx`

Expected: FAIL because recent-color props and `ColorPicker` are absent.

- [ ] **Step 3: Replace both modal-specific Radio maps with ColorPicker**

Add these props to each modal:

```ts
recentColors: HexColor[];
onRememberCustomColor(color: HexColor, presets: readonly ColorPreset[]): Promise<void> | void;
```

Render:

```tsx
<ColorPicker legend="颜色" name="event-color" value={form.color} presets={eventColorPresets} recentColors={recentColors} disabled={busy} onChange={(color) => update('color', color)} />
```

For notes, use legend `便签颜色`, name `note-color`, and `noteColorPresets`.

Immediately after the successful create/update call and before closing, call the recorder only for a non-preset value:

```ts
if (!isPresetColor(saved.color, eventColorPresets)) {
  await onRememberCustomColor(saved.color, eventColorPresets);
}
```

`App`'s callback will swallow settings failures, so this await does not turn a completed business save into a retryable form error.

- [ ] **Step 4: Add one non-throwing recent-color callback in App**

```ts
const rememberCustomColor = useCallback(async (color: HexColor, presets: readonly ColorPreset[]) => {
  if (isPresetColor(color, presets)) return;
  const current = settingsFeature.settings.data;
  const next = addRecentColor(current.recentColors, color);
  if (next.join('|') === current.recentColors.join('|')) return;
  try {
    await settingsFeature.saveSettings({ ...current, recentColors: next });
  } catch {
    // useSettings already exposes writeError; do not roll back saved business data
  }
}, [settingsFeature.settings.data, settingsFeature.saveSettings]);
```

Pass `recentColors` and `rememberCustomColor` to `ModalRoot`. Extend `ModalRoot` props and pass them to event/note dialogs.

- [ ] **Step 5: Run modal/app tests and verify GREEN**

Run: `npm test -- src/modals src/app/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit calendar/note picker wiring**

```bash
git add src/app/App.tsx src/modals/ModalRoot.tsx src/modals/ModalRoot.test.tsx src/modals/EventModal.tsx src/modals/EventModal.test.tsx src/modals/NoteModal.tsx src/modals/NoteModal.test.tsx
git commit -m "feature: add custom colors to events and notes"
```

---

### Task 7: Replace kanban color choosers and align all kanban checks/radios

**Files:**
- Modify: `src/kanban/KanbanWidget.tsx`
- Modify: `src/kanban/KanbanLaneDialog.tsx`
- Modify: `src/kanban/KanbanFieldManagerDialog.tsx`
- Modify: `src/kanban/KanbanFieldManagerDialog.test.tsx`
- Modify: `src/kanban/KanbanWidget.test.tsx`
- Modify: `src/kanban/KanbanMultiSelect.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing kanban picker/control tests**

Add assertions that opening a lane dialog and field manager yields shared Good radios, and task dialog checkboxes retain the same structure:

```ts
for (const radio of screen.getAllByRole('radio')) {
  expect(radio).toHaveClass('form-check-input');
  expect(radio.closest('label')).toHaveClass('form-check', 'form-check-custom', 'form-check-solid');
}
for (const checkbox of screen.getAllByRole('checkbox')) {
  expect(checkbox).toHaveClass('form-check-input');
  expect(checkbox.closest('label')).toHaveClass('form-check', 'form-check-custom', 'form-check-solid');
}
```

Create a priority using recent color `#7C5CFC`, then assert:

```ts
expect(createPriority).toHaveBeenCalledWith({ name: '紧急', color: '#7C5CFC' });
expect(onRememberCustomColor).toHaveBeenCalledWith('#7C5CFC', kanbanColorPresets);
```

- [ ] **Step 2: Run kanban dialog tests and verify RED**

Run: `npm test -- src/kanban/KanbanFieldManagerDialog.test.tsx src/kanban/KanbanWidget.test.tsx`

Expected: FAIL because kanban uses dedicated 20px/default radios and lacks recent-color props.

- [ ] **Step 3: Replace lane and field color markup with ColorPicker**

Add `recentColors` and `onRememberCustomColor` props through `App → KanbanWidget → KanbanLaneDialog/KanbanFieldManagerDialog`.

Use:

```tsx
<ColorPicker legend="泳道颜色" name="lane-color" value={color} presets={kanbanColorPresets} recentColors={recentColors} disabled={busy} onChange={setColor} />
```

and:

```tsx
<ColorPicker legend="颜色" name="kanban-field-color" value={color} presets={kanbanColorPresets} recentColors={recentColors} disabled={busy} onChange={setColor} />
```

After successful lane/priority/tag save, invoke the recorder when `!isPresetColor(color, kanbanColorPresets)`. Do not record collaborator operations.

- [ ] **Step 4: Remove obsolete kanban-only control CSS**

Delete `.kanban-color-option__input`, `.kanban-color-swatch input`, named swatch-dot modifier rules, and any `accent-color`. Keep `.form-check` rules as the sole Radio/Checkbox appearance. Confirm the global rules in `styles.css` specify `28px`, `appearance:none`, `#DAD3C3`, checked `#4FC9DA`, white check/dot, focus ring, and disabled state exactly as `design.md` requires.

- [ ] **Step 5: Run kanban tests and verify GREEN**

Run: `npm test -- src/kanban src/app/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit kanban picker/control consistency**

```bash
git add src/app/App.tsx src/app/styles.css src/kanban/KanbanWidget.tsx src/kanban/KanbanLaneDialog.tsx src/kanban/KanbanFieldManagerDialog.tsx src/kanban/KanbanFieldManagerDialog.test.tsx src/kanban/KanbanWidget.test.tsx src/kanban/KanbanMultiSelect.tsx
git commit -m "feature: unify kanban color and selection controls"
```

---

### Task 8: Render all HEX colors with derived static CSS variables

**Files:**
- Modify: `src/calendar/CalendarWidget.tsx`
- Modify: `src/calendar/CalendarWidget.test.tsx`
- Modify: `src/notes/NotesWidget.tsx`
- Modify: `src/notes/NotesWidget.test.tsx`
- Modify: `src/kanban/KanbanCard.tsx`
- Modify: `src/kanban/KanbanCard.test.tsx`
- Modify: `src/kanban/KanbanLane.tsx`
- Modify: `src/kanban/KanbanFieldManagerDialog.tsx`
- Modify: `src/kanban/kanban-view.ts`
- Modify: `src/kanban/kanban-view.test.ts`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing rendering tests**

For a custom `#7C5CFC` event, note, lane, priority, and tag, assert the rendered element has variables rather than a named tone class:

```ts
expect(element).toHaveStyle({
  '--selected-color': '#7C5CFC',
  '--selected-color-bg': expect.stringMatching(/^#[0-9A-F]{6}$/),
  '--selected-color-fg': expect.stringMatching(/^#[0-9A-F]{6}$/)
});
```

Because jest-dom does not accept asymmetric matchers inside `toHaveStyle`, read properties explicitly:

```ts
expect(element.style.getPropertyValue('--selected-color')).toBe('#7C5CFC');
expect(element.style.getPropertyValue('--selected-color-bg')).toMatch(/^#[0-9A-F]{6}$/);
expect(element.style.getPropertyValue('--selected-color-fg')).toMatch(/^#[0-9A-F]{6}$/);
```

For overflow dots and lane dots, assert `--selected-color` is used.

- [ ] **Step 2: Run rendering tests and verify RED**

Run: `npm test -- src/calendar/CalendarWidget.test.tsx src/notes/NotesWidget.test.tsx src/kanban/KanbanCard.test.tsx src/kanban/kanban-view.test.ts`

Expected: FAIL because views still map named colors to classes.

- [ ] **Step 3: Apply `colorStyle` to every colored view element**

Remove `eventToneClass`, `noteColorClass`, and `colorClass`. Every calendar event/chip/dot receives `style={colorStyle(event.color)}` and class `event--colored`; every note receives `style={colorStyle(note.color)}`; lane dots, priority badges, tag presentations, and field-manager badges receive the same variables.

Representative JSX:

```tsx
<button className="event event--colored" style={colorStyle(event.color)}>...</button>
<button className="note" style={colorStyle(note.color)}>...</button>
<span className="kanban-lane__dot" style={colorStyle(lane.color)} aria-hidden="true" />
<span className="kanban-badge" style={colorStyle(priority.color)}>{priority.name}</span>
```

Keep existing accessible text and labels unchanged.

- [ ] **Step 4: Replace named-color CSS with variable CSS**

```css
.event--colored, .kanban-badge { color: var(--selected-color-fg); background: var(--selected-color-bg); }
.event-overflow-dot, .kanban-lane__dot, .color-picker__swatch { background: var(--selected-color); }
.note { background: var(--selected-color-bg); }
.note-title { color: var(--selected-color-fg); }
```

Remove `.event--work`, `.event--important`, `.event--personal`, `.event--learning`, `.note--yellow/blue/green/purple`, `.kanban-lane__dot--*`, `.kanban-badge--*`, and `.kanban-color-swatch--*`. Preserve non-color layout rules.

- [ ] **Step 5: Run rendering tests and verify GREEN**

Run: `npm test -- src/calendar src/notes src/kanban`

Expected: PASS.

- [ ] **Step 6: Commit variable rendering**

```bash
git add src/calendar/CalendarWidget.tsx src/calendar/CalendarWidget.test.tsx src/notes/NotesWidget.tsx src/notes/NotesWidget.test.tsx src/kanban/KanbanCard.tsx src/kanban/KanbanCard.test.tsx src/kanban/KanbanLane.tsx src/kanban/KanbanFieldManagerDialog.tsx src/kanban/kanban-view.ts src/kanban/kanban-view.test.ts src/app/styles.css
git commit -m "refactor: render business colors from HEX variables"
```

---

### Task 9: Remove task-card menus and reorder lane name/count

**Files:**
- Modify: `src/kanban/KanbanCard.tsx`
- Modify: `src/kanban/KanbanCard.test.tsx`
- Modify: `src/kanban/KanbanLane.tsx`
- Modify: `src/kanban/KanbanWidget.tsx`
- Modify: `src/kanban/KanbanWidget.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Replace menu tests with failing absence/order tests**

Delete tests that move/delete through task menus. Add:

```ts
it('does not render a task-card three-dot menu', () => {
  render(<KanbanCard {...props()} />);
  expect(screen.queryByRole('button', { name: '任务操作：写设计稿' })).not.toBeInTheDocument();
});

it('renders lane name before its task count while retaining the lane menu', async () => {
  renderWidget(repository());
  const lane = await screen.findByRole('region', { name: '泳道：待处理' });
  const name = within(lane).getByRole('heading', { name: '待处理' });
  const count = within(lane).getByLabelText('待处理 2 张任务');
  expect(name.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(lane).getByRole('button', { name: '泳道操作：待处理' })).toBeInTheDocument();
});
```

Retain title-click editing and dialog deletion tests.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/kanban/KanbanCard.test.tsx src/kanban/KanbanWidget.test.tsx`

Expected: FAIL because the card menu remains and count precedes name.

- [ ] **Step 3: Remove card menu API and implementation**

From `KanbanCardProps`, component arguments, and JSX remove:

```ts
canMoveUp; canMoveDown; canMoveLeft; canMoveRight;
onMoveUp; onMoveDown; onMoveLeft; onMoveRight; onDelete;
```

Remove `KanbanMenu` import, `menuItems`, and the menu node. Keep priority inside `.kanban-card__top-right`.

From `KanbanLaneProps` and `KanbanWidget`, remove the corresponding card movement/deletion callback plumbing and the now-unused `moveCardUp`, `moveCardDown`, and `moveCardToLane` functions. Keep drag functions and task-dialog deletion.

- [ ] **Step 4: Reorder lane header and adjust flex**

Use this order in `KanbanLane.tsx`:

```tsx
<span className="kanban-lane__dot" style={colorStyle(lane.color)} aria-hidden="true" />
<h3 className="kanban-lane__name">{lane.name}</h3>
<span className="kanban-lane__count" aria-label={`${lane.name} ${laneCards.length} 张任务`}>{laneCards.length}</span>
<div className="kanban-lane__actions">...</div>
```

Keep `.kanban-lane__name { min-width:0; flex:0 1 auto; }`, count flex-none, and actions pushed right with `.kanban-lane__actions { margin-left:auto; }`. This makes the count follow the displayed name while preserving operation alignment.

Delete task-menu-only CSS selectors such as `.kanban-card__top-right .kanban-menu .good-icon-button`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- src/kanban`

Expected: PASS, including title editing, drag helpers, and task-dialog deletion.

- [ ] **Step 6: Commit kanban polish**

```bash
git add src/kanban/KanbanCard.tsx src/kanban/KanbanCard.test.tsx src/kanban/KanbanLane.tsx src/kanban/KanbanWidget.tsx src/kanban/KanbanWidget.test.tsx src/app/styles.css
git commit -m "feature: simplify kanban cards and lane headers"
```

---

### Task 10: Add end-to-end coverage for custom/recent colors and kanban polish

**Files:**
- Modify: `tests/nowly-events.spec.ts`
- Modify: `tests/nowly-notes.spec.ts`
- Modify: `tests/nowly-kanban.spec.ts`

- [ ] **Step 1: Add failing reusable E2E scenarios**

Use Playwright's DOM assignment to make native color selection deterministic:

```ts
async function chooseNativeColor(page: Page, color: string) {
  const input = page.getByLabel('选择自定义颜色');
  await input.evaluate((element, value) => {
    const target = element as HTMLInputElement;
    target.value = String(value).toLowerCase();
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
}
```

Add these assertions to the appropriate existing flows:

```ts
await chooseNativeColor(page, '#7C5CFC');
await page.getByRole('button', { name: /保存/ }).click();
await expect(page.locator('[style*="--selected-color: #7C5CFC"]')).toBeVisible();

// Open another color-enabled module after save.
await expect(page.getByRole('radio', { name: '最近使用 1' })).toBeVisible();
await expect(page.getByText('#7C5CFC')).toHaveCount(0);
```

In kanban E2E:

```ts
await expect(page.getByRole('button', { name: /^任务操作：/ })).toHaveCount(0);
await expect(page.getByRole('button', { name: /^泳道操作：/ }).first()).toBeVisible();
const headerText = await page.locator('.kanban-lane__head').first().innerText();
expect(headerText.indexOf('待处理')).toBeLessThan(headerText.indexOf('2'));
```

Reload after recording and reopen a color dialog to assert `最近使用 1` persists.

- [ ] **Step 2: Run E2E tests and verify RED or expose missing wiring**

Run: `npm run e2e -- tests/nowly-events.spec.ts tests/nowly-notes.spec.ts tests/nowly-kanban.spec.ts`

Expected: new assertions FAIL before all integration behavior is complete.

- [ ] **Step 3: Make only integration-level corrections found by E2E**

Allowed corrections are prop wiring, selectors, focus labels, or save ordering already specified above. Do not add new color-management features. Re-run the narrow failing spec after each correction.

- [ ] **Step 4: Verify E2E GREEN**

Run: `npm run e2e -- tests/nowly-events.spec.ts tests/nowly-notes.spec.ts tests/nowly-kanban.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add tests/nowly-events.spec.ts tests/nowly-notes.spec.ts tests/nowly-kanban.spec.ts
git commit -m "test: verify shared colors and kanban polish"
```

---

### Task 11: Full verification and design-system regression audit

**Files:**
- Modify only files implicated by a failing check

- [ ] **Step 1: Run the complete frontend test suite**

Run: `npm test`

Expected: all Vitest suites PASS with no warnings.

- [ ] **Step 2: Run the complete Rust test suite**

Run: `cd src-tauri && cargo test`

Expected: all Rust tests PASS.

- [ ] **Step 3: Run TypeScript/build verification**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 4: Run the complete E2E suite**

Run: `npm run e2e`

Expected: all Playwright specs PASS.

- [ ] **Step 5: Audit forbidden and obsolete styling**

Run:

```bash
rg -n "accent-color|kanban-color-option__input|kanban-color-swatch--|event--work|note--yellow|kanban-badge--|kanban-lane__dot--" src
rg -n "transition:|animation:" src/app/styles.css
```

Expected: first command returns no matches. For the second command, remove any remaining feature-touched transitions, including the pre-existing event resize-handle transition, so the final stylesheet conforms to `design.md`; only the global explicit `transition: none !important` / `animation: none !important` constraints may remain.

- [ ] **Step 6: Inspect repository state and diff quality**

Run:

```bash
git status --short
git diff --check
git log --oneline -12
```

Expected: no whitespace errors; only intentional pre-existing/uncommitted work remains; commits follow `<type>: <short description>`.

- [ ] **Step 7: Commit any verification-only repair**

If verification required source changes, stage only those exact paths and commit:

```bash
git commit -m "fix: resolve unified color verification issues"
```

If no repair was required, do not create an empty commit.

- [ ] **Step 8: Request code review**

Invoke the `requesting-code-review` skill, review against:

- `docs/superpowers/specs/2026-08-12-unified-color-picker-and-kanban-polish-design.md`
- this implementation plan
- the final diff and all verification outputs

Address blocking findings with a new failing regression test before modifying production code.
