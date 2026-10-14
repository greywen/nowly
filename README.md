# Nowly · 此刻

**A desktop dashboard that answers one question: what should I be doing right
now?**

English | [简体中文](./README.zh.md)

Nowly — *此刻* in Chinese, meaning *this moment* — is a local-first focus
dashboard for Windows 10/11. Instead of scattering your day across a calendar
app, a to-do app, a board, and a notes app, Nowly puts today's schedule, the
tasks that actually matter, and a focus timer on one surface you already look
at: your desktop.

Set it as your wallpaper and it disappears into the background — no window to
open, no app to switch to. Glance at the screen, see what's next, start
focusing. All data stays on your machine in a local SQLite database.

## Why Nowly

- **One glance, one answer.** Today's events, the task that matters, and the
  time left on your current session are visible without a single click.
- **Lives on your desktop.** Wallpaper mode embeds Nowly behind your icons, so
  the dashboard is always there and never in the way.
- **Focus, not accumulation.** The Eisenhower matrix and the focus timer exist
  to shrink your list down to the one thing worth doing now.
- **Yours alone.** No account, no sync, no telemetry — local-first by design.

## Features

- **Monthly calendar** — events with times, colors, and per-day detail views, so
  today's schedule is always in sight.
- **Eisenhower matrix** — sort tasks across the urgent/important quadrants and
  keep the "do it now" quadrant honest.
- **Focus timer** — countdown sessions with a distraction-free fullscreen mode
  and session statistics. On desktop, one native timer supplies the same remaining
  time to the dashboard, fullscreen focus, and Nowly Bar; views resync on resume.
- **World clocks and alarms** — an optional Time module arranges multiple time zones
  as pure digital clocks, pure analog faces, or mixed displays. City, date, and
  time-difference labels are hidden by default; layout adapts to the module size.
  Use the always-visible **Time settings** button in the module header for the
  settings-only **World clocks / Focus / Alarms** tabs. A separate display choice
  switches the module between clocks and focus; browsing tabs never changes it.
  All cities share display mode, horizontal/stacked layout, hour cycle, visibility
  and automatic or slider-controlled 32–160px font sizing. Dates have an independent
  visibility toggle; each city only has a name, time zone and order. Appearance, time zones, visibility options,
  and adding, removing, or reordering clocks apply immediately and save automatically.
  Failed saves retain edits and offer retry; closing settings does not undo changes.
  Once saved, settings survive reopening and refreshing. The comparison tool has
  been removed; optional difference labels still compare cities with local time.
  Focus settings only configure the default duration (1–720 minutes). **Focus statistics**
  is available in the module header only when focus is displayed. Switching the
  displayed content does not interrupt an active session.
  The **Alarms** settings tab creates a new alarm requiring one explicit creation
  confirmation. Existing alarms expand for editing within their own list rows;
  valid edits save automatically, ending editing does not undo changes, and deletion
  still requires confirmation. The Alarms tab has no count suffix. Alarms do not
  accept dates: turn repeat off to ring once at the next selected local time, or
  select weekdays for repeating alarms (default: 09:00, Monday–Friday).
  Alarm and calendar time pickers accept any minute from 00 to 59. Input, shortcuts,
  and Now remain drafts until Confirm or Enter; Escape or an outside click cancels
  unconfirmed edits. Invalid times or an empty repeat weekday selection are not saved.
  Upgrading to this date-free alarm format clears old alarms, alarm notices, and
  alarm scheduler state once; calendar events, tasks, focus records, clocks, and
  other settings are retained.
  Nowly Bar offers acknowledgment and a five-minute snooze. Enabled alarm
  sounds play for up to one minute per occurrence; after the sound stops, Nowly Bar
  keeps the pending reminder. Dismissal or acknowledgment ends that occurrence;
  snoozing silences it and rings again after five minutes.
  Keep Nowly running (including in the tray) for on-time reminders. Restarting or
  resuming after sleep produces one missed-alarm summary, not individual replay.
  Removing the Time module does not disable alarms. Fully exiting Nowly does not
  leave a Windows scheduled alarm behind.
- **Kanban board** — customizable lanes, cards, and fields for lightweight
  project tracking.
- **Notes** — quick capture with a dedicated manager for organizing entries.
- **Stickers** — an optional image and plain-text canvas with original, rounded,
  circular and photo-frame styles, text formatting, transforms, opacity, layers,
  locking, duplication and deletion.
- **Wallpaper mode** — embed Nowly behind your desktop icons with taskbar-aware
  positioning, or run it as a regular window.
- **Flexible layout** — arrange every module on a 12x8 grid; toggle modules on
  or off and resize them freely.
- **Personalization** — Gaussian blur, a global color picker, calendar
  formatting, density controls, and login-on-startup.
- **Reminder sounds** — eight bundled sounds for calendar reminders, alarms,
  missed-alarm summaries, and focus completion. Choose each sound, preview it,
  adjust volume, or mute all reminders under **Settings → Nowly Bar**. Selecting
  **None** mutes only that scene. Changes apply after saving; desktop reminders
  sound in the background while Nowly is running, without duplicate system chimes.
- **Localization** — English and Simplified Chinese, following your system
  language on startup. Language changes synchronize across screenshot and Bar
  windows. Missing translations fall back to English; native surfaces without
  localization, including the calendar authorization callback, use English.

## Usage

- Use the top-right button to set Nowly as your wallpaper.
- Double-click the wallpaper or click the tray icon to return to foreground
  mode. Within the same running session, this restores the window size, position,
  and maximized state from before entering wallpaper mode.
- Open **Settings** to control wallpaper close behavior, login startup, calendar
  formatting, density, and module visibility.
- Disabling login startup and saving removes the current user's startup entry;
  saving also succeeds if Windows or a manual action already removed it.
- Closing the foreground window restores the wallpaper when the wallpaper
  preference is enabled; otherwise it hides to the tray.
- **Exit Nowly** in the tray menu is the only action that terminates the
  process.

### Sticker canvas

Add **Stickers** under **Edit layout → Add module**. If the grid is full, remove
or shrink another module first. The module displays your work; **Edit stickers**
opens the editing dialog. Select files or drop them on the editing canvas:
PNG, JPEG and static WebP only, up to 10 MiB each, at most 4096 pixels per
dimension and 16 million pixels in total. Transparency is preserved. Circular
style crops the display; other styles show the full image without changing its file.

A canvas holds up to 50 objects. Text supports up to 2000 Unicode characters,
integer font sizes from 12 to 160px, hex colors, bold, italic, underline,
alignment and newlines. The transparent 800×600 logical canvas fits the module
uniformly; resizing the window does not rearrange the artwork.
Use the layer list to select covered, transparent or locked objects. Unlock
before editing. Position, size and rotation fields offer keyboard alternatives
to dragging. Invalid geometry and overflowing text must be corrected before saving.

Changes take effect on **Save**; closing a changed draft asks before discarding.
Failed saves retain the draft for retry. Removing the module only hides it;
adding it again restores the canvas. Images and layout stay local, independently
of the existing 1 MiB note/task attachment limit. The browser development mode
uses IndexedDB and also survives reloads. This version does not include online
assets, animated stickers, custom fonts, background removal or file export.

### Nowly Bar visibility

Set Nowly Bar to **Notification only** in **Settings → Notifications** to keep a thin top-edge entry when no notification needs attention, rather than hiding the Bar completely. Hovering continuously unfolds the same shell down into the full Bar; leaving folds it back up. Hover only reveals the Bar; click its status area or Logo to open a panel.

Pending notifications, open reminder/menu/AI/history panels, keyboard focus within the Bar, and actions in progress keep the surface available without acknowledging notifications or interrupting input. After a panel closes, the current state determines whether it folds back. Tab can enter the strip; reduced-motion preferences make the transition immediate. Persistent mode is unchanged. Disabling the Bar or suppressing it for capture also hides the strip, and transparent areas do not intercept desktop clicks.

### Screenshots and history

Click the **Nowly Bar Logo** to open the function menu, then choose **Screenshot**, **Screenshot history**, or **AI assistant**. Configure visibility and order under **Settings → Notifications → Nowly Bar → Function menu**. All three functions are visible by default, including after upgrading from the old app-button settings. Hiding a function only removes its menu entry; shortcuts continue to work. You may hide every function; the menu then explains how to enable them again. Global shortcuts default to **Ctrl+Alt+A** for screenshots and **Ctrl+Alt+H** for screenshot history; change them under **Settings → Shortcuts**. Conflicts are reported without preventing app startup.

**Save** writes directly to the system **Pictures\Nowly\Screenshots** folder instead of opening a Save As dialog. **Copy image and finish** archives the same final PNG before writing the image clipboard. Only cropped, annotated and redacted output is retained; cancelling creates no history. Redirected system Pictures folders are respected.

Screenshot history expands directly from the top-edge Nowly Bar into an animated panel, without a separate window. The collapsed Bar is **288 × 40px**, with only the status area and Logo entry; reminders, the function menu, AI, and history all expand to **432px** wide. Enable Nowly Bar to use the history shortcut. Press **Esc**, use the close button, or click outside to collapse it; Esc first cancels an open deletion confirmation. Click the Logo again to return to the function menu. The panel shows thumbnails with image-copy and confirmed-delete actions, plus **Open folder**. Images remain until deleted; confirmation removes the archived PNG and its thumbnail cache. SQLite stores metadata, not image bytes. Thumbnail caches can be regenerated.

An archive failure preserves the editor and does not copy. If archiving succeeds but the clipboard fails, retrying the same final image reuses its history entry. Copying from history never creates another entry. Raw desktop frames are retained only for the active capture session.

Browser development mode can validate the UI but cannot manage real screenshot files or global shortcuts. Full functionality requires the Windows desktop app.

## Tech Stack

- **Frontend** — React + TypeScript, built with Vite and styled with
  hand-authored CSS against the tokens in `design.md`. No utility-class or
  CSS-in-JS framework.
- **Desktop shell** — Tauri 2 with a Rust backend.
- **Storage** — local SQLite via `rusqlite` (bundled).
- **Icons** — the [Solar icon set](https://www.figma.com/community/file/1166831539721848736)
  by 480 Design, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Glyphs are vendored through a single adapter (`src/components/icons.tsx`) and
  regenerated with `npm run icons`; the duotone / solid / outline style is
  switchable in Settings.
- **Testing** — Vitest for unit/component tests, Playwright for end-to-end,
  and `cargo test` for the Rust layer.

## Development

Requirements: Node.js, Rust toolchain, and the Tauri prerequisites for Windows.

```bash
npm install                                        # install dependencies
npm run dev                                         # Vite dev server (127.0.0.1:1420)
npm test                                            # Vitest unit/component tests
npm run build                                       # tsc + vite build
npx playwright test                                 # end-to-end tests
cargo test --manifest-path src-tauri/Cargo.toml     # Rust tests
npm run tauri build                                 # build the Windows executable
```

The unified time/focus settings are a development-only breaking change; the old
per-clock configuration is not migrated. Back up the development database before
resetting it. Debug builds can perform the one-time, scoped reset by setting
`NOWLY_RESET_DEVELOPMENT_TIME_V32` to the database's exact absolute path. It resets
only time/focus settings, alarms and related notices, focus records and old module
entries; unrelated data is preserved. Release builds never execute this reset.
The browser development backend resets legacy time/focus data separately in local storage.

## Project Structure

```text
src/                 React frontend
  app/               App shell, layout grid, bootstrap hooks
  calendar/          Monthly calendar and events
  matrix/            Eisenhower task matrix
  kanban/            Kanban board
  notes/             Notes
  focus/             Focus timer and statistics
  time/              Unified time/focus module, world clocks and alarm settings
  widgets/           Module registry, picker, and grid layout
  components/        Shared UI (Dialog, Select, DatePicker, ...)
  data/              Repository interface and Tauri implementation
  i18n/              Localization (en/zh)
src-tauri/           Rust backend (Tauri commands, SQLite, wallpaper, tray)
docs/                Design specs and implementation plans
```
