# Nowly user guide

[简体中文](user-guide.zh.md) · [Product overview](../README.md) · [Privacy and data](privacy-and-data.en.md)

## Start with your day

Use Nowly as a personal Windows workspace: add your schedule, sort tasks in the matrix or board, capture notes, then add Time or Stickers if useful. Enter **Edit layout → Add module** to choose modules, drag and resize within the 12×8 grid. If no space remains, shrink or remove another module. An empty layout shows a welcome canvas; the fallback layout contains Calendar, Matrix and Notes, while Board, Time and Stickers are optional.

The ordinary window, wallpaper, tray, quick panel and fullscreen focus serve different purposes. AI and connected calendars are optional; local task, note and focus work does not require connecting them. Nowly is not a shared team workspace.

> AI chat, the AI assistant option in Nowly Bar settings, and the Model Settings tab are temporarily hidden. Existing AI data and configuration are retained; other features are unaffected.

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
  settings-only **World clocks / Focus / Alarms** tabs. The separate clock/timer
  icons in the module header switch between clocks and focus; browsing settings tabs never changes the display.
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
or shrink another module first. Click a blank canvas area to add text or upload an
image at that position, without a dialog. Single-click text to edit inline; its box
adapts to content, font size and styling. The floating toolbar stays on one row and
scrolls horizontally in narrow modules. Style, size, opacity and layers use dropdowns;
click the color swatch to pick a color and the lock icon to lock or unlock. There is
no More panel or numerical geometry form.
Images support file selection, replacement, dropping and pasting:
PNG, JPEG and static WebP only, up to 10 MiB each, at most 4096 pixels per
dimension and 16 million pixels in total. Transparency is preserved. Circular
style crops the display; other styles show the full image without changing its file.

A canvas holds up to 50 objects. Text supports up to 2000 Unicode characters,
integer font sizes from 12 to 160px, hex colors, bold, italic, underline,
alignment and newlines. The transparent 800×600 logical canvas fits the module
uniformly; resizing the window does not rearrange the artwork.
Use the layer list to select covered, transparent or locked objects. Unlock
before editing. Drag a text box edge to move it, its top handle to rotate, and its
corner handle to change font size; image resizing preserves aspect ratio. With an
object focused, arrow keys move, Shift accelerates, Alt + Left/Right rotates, and
Alt + Up/Down resizes. The Default layer option restores the session's initial
relative order; reloading uses the saved order as its baseline. Invalid geometry
and overflowing text must be corrected before saving.

Changes autosave after about 500 ms of inactivity, or immediately after a gesture.
Failed saves retain the draft for explicit retry; conflicts never overwrite stored
work. Unreferenced images are cleaned after a successful save, with a separate
cleanup retry. Wallpaper and layout editing modes are read-only. Removing the module only hides it;
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

#### Pin an image

Choose **Pin** in the screenshot toolbar to open the final cropped and annotated image in an independent always-on-top desktop window. Move or close it while using other apps. Drag any window edge or corner to resize it proportionally (minimum 240 × 96px). The image viewport keeps its initial aspect ratio, both axes change together, and the toolbar height stays fixed; the complete image scales proportionally to fit, without separate zoom controls. Both ordinary screenshots and confirmed long images can be pinned. Up to **five** pins can remain open; a sixth request keeps your editor intact and asks you to close one first. Pinning does not copy to the clipboard or replace saving a permanent image.

Existing pins hide temporarily during another capture and return without taking focus when it ends or is cancelled. Closing a pin frees its slot. Pins are not restored after quitting the app.

#### Manual scrolling capture

1. Select a vertical content region within one monitor, avoiding fixed headers/footers, sidebars and video. Choose **Scrolling capture** on the toolbar before adding annotations.
2. Capture starts at once and stays in the same screenshot screen: outside the selection is dimmed but live, a hint above the selection says "Scroll the page to capture more", and a live preview of the long image appears beside it. Put the pointer inside the selection and scroll the page with the wheel; new content is stitched automatically, and nothing is added while you are not scrolling. Nowly never scrolls for you.
3. Choose **Done** (or press Enter / Ctrl+C) to copy the long image and close the screenshot, **Save** (or Ctrl+S) to save it and close, or **Cancel** / **Esc** to close the whole screenshot.

Frames are captured continuously while you scroll; there is no need to pause after each movement. Scrolling below the captured end appends new content; scrolling above the starting position prepends it. Revisiting captured content neither removes nor duplicates it. The preview follows the end that just grew. Unverified matches never overwrite confirmed pixels; feedback identifies capture or matching problems rather than asking you to control scroll speed. A selection that includes a bar that does not scroll is explained; automatic fixed-chrome removal is not included. Horizontal, cross-monitor and automatic scrolling modes are not included; the Windows frame-driven backend currently excludes rotated displays. Output is limited to **64 million pixels**, with neither edge exceeding **65,535 pixels**; at the limit you can finish with what was captured.

Browser development mode can validate the UI but cannot manage real screenshot files, desktop scrolling capture or global shortcuts. Full functionality requires the Windows desktop app.
## Connected calendars

Open the Calendar module settings and subscription manager. Local events need no connected account. For a feed, choose ICS, enter a name and HTTPS/webcal URL, then set category and refresh interval. For Google or Microsoft, connect an account in the provider's browser flow, select calendars and subscribe. Up to 50 sources are supported; intervals are 1–30 minutes (default 15). Use refresh to retry; a failed refresh retains the last successful events, so check sync status before relying on them.

ICS events are read-only. Authorized Google/Microsoft sources can be selected as the destination when creating an event; ordinary event editing supports remote changes and deletion when writable. This sends event content to the provider, not just to local storage. Remote recurrence-rule creation/editing is unsupported. Disconnecting removes the local account and dependent subscriptions/cache, not the provider's grant or remote calendar; revoke access in provider settings separately if required. See [Privacy and data](privacy-and-data.en.md).

## Optional AI assistant

Open AI settings, enter the complete API endpoint, Model ID and API Key, and select allowed local-calendar, task and/or external-calendar data. Save/connection testing sends a fixed JSON test and detects the protocol. Remote services require HTTPS and a key; loopback services can use HTTP and may work without a key. Changing the endpoint does not reuse the old key automatically. A failed connection leaves the previous saved settings intact.

Open the assistant from the main workspace or **Nowly Bar Logo → AI assistant**. Ask for a bounded lookup or a local change, such as “Show my incomplete important tasks” or “Create a study session tomorrow at 19:00.” Review exact dates, targets and changes. Clarify ambiguous requests; select/edit the preview and regenerate it before confirmation if needed. Only the explicit confirmation button executes the local plan. Cancel or stop does not confirm it.

Plans contain 1–20 unique actions in one domain, expire after five minutes, and become unconfirmable after restarting the app. AI supports local calendar/task creation, editing and deletion, not arbitrary code or board administration. Existing recurring events can only be changed/deleted as an explicitly queried occurrence; recurring rules and occurrence reminder-offset changes are not supported. Split calendar-plus-task requests. Calendar queries span at most 90 days and return at most 200 records; narrow incomplete results before batch changes. Data or permission changes may require a new query/preview. History holds recent local operation plans for seven days; undo is guarded and can be refused if affected data changed, rather than restoring the whole database.

Allowed query results, entered messages, recent conversation and optional previous drafts go to the configured model service. External permission includes cached Google, Microsoft and ICS events; they are read-only to AI even if the normal editor can write them. The switches do not redact text already in the conversation. Dictation, where supported, fills the draft and does not send automatically; its host recognition service is not guaranteed offline. Read the [exact AI context boundary](privacy-and-data.en.md#optional-ai-the-exact-context-boundary) before connecting.

## Desktop modes and data care

The quick panel is a top-edge native surface, separate from embedding the workspace as wallpaper. Fullscreen focus is a dedicated focus view, not wallpaper mode; keep the shared timer running when switching views. Under **Settings → Interface → Wallpaper appearance**, **Hide navigation and module headers** is enabled by default, while **Hide module backgrounds and borders** is disabled by default. These independent options apply only in wallpaper mode. The second option makes only module shells transparent, preserving internal cards, task rows and inputs. Returning to the foreground restores normal appearance; layout data, module content and the independent Nowly Bar are unchanged.

Wallpaper/tray operation is not a backup. SQLite is only one part of desktop data: preserve attachment/sticker files, screenshots and relevant WebView storage too. Follow [backup and control guidance](privacy-and-data.en.md#backups-and-control) before changing machines or manually resetting development data.

## Custom modules

No custom-module documentation or install/publish runtime is present in this checkout; the audited picker offers the six built-ins above. See the [source-audited product boundary](product-definition.md) rather than assuming custom code can run or access the network. Separate custom-module documentation, if restored, should be linked here after its runtime contract is checked.

## Tech Stack

- **Frontend** — React + TypeScript, built with Vite and styled with
  hand-authored CSS against the tokens in `design.md`. No utility-class or
  CSS-in-JS framework.
- **Desktop shell** — Tauri 2 with a Rust backend.
- **Storage** — SQLite for structured desktop records; attachments, sticker images and screenshots use separate files. Some UI preferences use WebView local storage.
- **Icons** — Solar glyphs through `src/components/icons.tsx`; regenerate with `npm run icons`. Duotone, solid and outline styles are switchable in Settings.
- **Testing** — Vitest for unit/component tests, Playwright for end-to-end,
  and `cargo test` for the Rust layer.

## Development

Requirements: Node.js, Rust toolchain, and the Tauri prerequisites for Windows.

```powershell
npm install                                        # install dependencies
npm run dev                                         # Vite dev server (127.0.0.1:1420)
npm test                                            # Vitest unit/component tests
npm run build                                       # tsc + vite build
npx playwright test                                 # end-to-end tests
cargo test --manifest-path src-tauri\Cargo.toml     # Rust tests
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
