// Which surface a window renders, decided from its Tauri label.
//
// Kept as a pure function because main.tsx resolves the route at module top
// level, where an unguarded throw would blank the window before React renders.
//
// The labels mirror `src-tauri/src/screen_capture/window.rs`: one
// `screenshot-session-<session id>` window owning the single taskbar/Alt+Tab
// entry, plus one `screenshot-overlay-<session id>-<display id>` per display.
export type WindowRoute =
  | 'main'
  | 'status-island'
  | 'screenshot-session'
  | 'screenshot-overlay'
  | 'screenshot-history';

const STATUS_ISLAND_LABEL = 'quick-panel-handle';
const SCREENSHOT_SESSION_PATTERN = /^screenshot-session-\d+$/;
// Both ids require at least one digit: a bare or legacy prefix is not a window
// belonging to the active native session.
const SCREENSHOT_OVERLAY_PATTERN = /^screenshot-overlay-\d+-\d+$/;

export function routeForLabel(label: string): WindowRoute {
  if (label === STATUS_ISLAND_LABEL) return 'status-island';
  if (label === 'screenshot-history') return 'screenshot-history';
  if (SCREENSHOT_SESSION_PATTERN.test(label)) return 'screenshot-session';
  if (SCREENSHOT_OVERLAY_PATTERN.test(label)) return 'screenshot-overlay';
  return 'main';
}
