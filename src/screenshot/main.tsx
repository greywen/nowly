// Entry point for capture windows only.
//
// Capture surfaces are created *during* a user-visible startup budget
// (`STARTUP_TIMEOUT`, §3.2.7): nothing is shown until every window has decoded
// its frame and acked `capture_window_ready`. Sharing `main.tsx` with the app
// put the dashboard, its data layer and the editor stack on that critical path,
// so each overlay paid for code it can never render.
//
// This entry imports only the capture surfaces. The label still decides which
// one renders, matching `src-tauri/src/screen_capture/window.rs`.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ScreenshotOverlayApp, ScreenshotSessionApp } from './ScreenshotApp';
import { routeForLabel } from './window-route';
import '../app/styles.css';

// Only native capture windows load this document, but the label is still read
// defensively: a throw at module top level would blank the window, and a blank
// overlay never acks, which fails the whole session rather than one surface.
function currentWindowLabel(): string {
  if (!('__TAURI_INTERNALS__' in window)) return 'main';
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
}

function surface() {
  // The session window owns the taskbar entry and shows the placeholder; the
  // overlays carry the frozen frame. Anything else reaching this document is a
  // routing mistake, and the placeholder is the safe thing to show: it never
  // displays desktop pixels.
  return routeForLabel(currentWindowLabel()) === 'screenshot-overlay'
    ? <ScreenshotOverlayApp />
    : <ScreenshotSessionApp />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{surface()}</React.StrictMode>
);
