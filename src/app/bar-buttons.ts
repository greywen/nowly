// The Nowly Bar's configurable app buttons: which apps may sit in the bar, and
// how a persisted list is made safe to render.
//
// The geometry that follows from the button count lives in exactly two places,
// each owning one surface: `--app-buttons` in styles.css drives the WebView
// layout, and `quick_panel.rs` drives the native host and hit region. Both are
// pinned to design.md §8.3's table by their own tests. A third copy here would
// have no consumer and could only drift.

/** Apps that may occupy a bar button slot. */
export type BarAppId = 'screenshot';

export type BarApp = {
  id: BarAppId;
  /** i18n key for the button's accessible name and the picker's label. */
  labelKey: string;
};

// The catalogue is the single source of truth for what can be added. Adding an
// app here and giving it an icon in BarButtonLane is all it takes for it to
// appear in the picker. Mirrored by `BAR_APPS` in quick_panel.rs, which validates
// what may be persisted.
export const BAR_APPS: BarApp[] = [
  { id: 'screenshot', labelKey: 'barButtons.screenshot' }
];

/** How many slots the bar offers. design.md §8.3 fixes this at three. */
export const BAR_BUTTON_SLOTS = 3;

export function findBarApp(id: string): BarApp | undefined {
  return BAR_APPS.find(app => app.id === id);
}

/**
 * Drops unknown ids, removes duplicates and clamps to the slot count, so a
 * hand-edited or downgraded settings row can never render a button with no
 * handler or widen the shell past the geometry native sized the host for.
 */
export function normalizeBarButtons(buttons: readonly string[] | undefined | null): BarAppId[] {
  if (!buttons) return [];
  const seen = new Set<string>();
  const result: BarAppId[] = [];
  for (const id of buttons) {
    if (result.length >= BAR_BUTTON_SLOTS) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const app = findBarApp(id);
    if (app) result.push(app.id);
  }
  return result;
}
