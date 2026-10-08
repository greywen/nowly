import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Esc ends the session, per §7's Esc ladder: with no local editing context open,
// Esc cancels the whole capture.
//
// Every capture window installs this, so a session stays cancellable even if one
// overlay never takes focus. Cancelling is idempotent on the Rust side, so two
// windows answering the same keypress is harmless.
//
// This is a window-local listener, not a global shortcut: the spec explicitly
// rules out registering a new global hotkey.
export function useCancelOnEscape() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // An unfinished IME composition owns Esc first.
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      void invoke('cancel_screen_capture').catch((error: unknown) => {
        // The window is about to be destroyed on success, so a rejection is the
        // only case worth surfacing, and only to the log: there is no surface
        // left to render it on.
        console.error('failed to cancel the capture session', error);
      });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
