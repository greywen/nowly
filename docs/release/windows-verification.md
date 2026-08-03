# Nowly Windows Release Verification

## Automated evidence

Verified on 2026-08-03:

- Vitest: 30 files, 129 tests passed.
- Rust: 54 tests passed.
- Playwright: 192 tests passed across 1366×768, 1920×1080, 2560×1440, and 5120×1440.
- TypeScript/Vite production build passed.

## Manual Windows 10/11 matrix

Run each row on Windows 10 and Windows 11 at 100%, 125%, and 150% scaling:

- Foreground → wallpaper → tray restore; close restores wallpaper when enabled and hides to tray when disabled.
- Tray open/settings/toggle/exit and left-click activation.
- Login startup uses `--background`; duplicate launch activates the existing process.
- Select primary and secondary displays; disconnect falls back to primary without replacing saved ID; reconnect restores selection.
- Explorer restart reattaches WorkerW; taskbar top/bottom/left/right and auto-hide preserve usable bounds.
- Create/edit/delete events, tasks, and notes; restart and verify persistence and event-task links.

Record tester, OS build, display topology, result, and issue link for each run. Native checks require an interactive Windows desktop and are not represented as automated tests.

## Idle resource check

After five minutes with no interaction, record CPU, GPU, private memory, and handle count for foreground, wallpaper, and hidden-to-tray modes. Investigate sustained CPU/GPU activity or continuously increasing memory/handles before release.

## Data and recovery

User data is stored under the Tauri application data directory in `nowly.sqlite`. Uninstall behavior must be confirmed before deleting user data manually. If wallpaper attachment fails, use the tray to reopen Nowly; close fallback keeps the process reachable in the tray.

## Known limitations

- Windows 10/11 only.
- One selected display at a time; no multi-window wallpaper spanning.
- No cloud sync, account, import/export, automatic backup, recycle bin, or cross-day events.
- Explorer/display integration depends on an interactive Windows shell session.
