# Nowly · 此刻

**Your personal workspace for Windows**

English | [简体中文](README.zh.md)

A desktop of your own for the day ahead. Nowly brings schedules, tasks, notes and time together in an adjustable workspace for people working, studying or freelancing on Windows. Use it as an ordinary window, set it behind your desktop icons, or keep reminders and quick tools within reach through Nowly Bar.

## Make room for your work

- **Plan the day:** local calendar events, reminders and optional Google/Microsoft calendar connections or read-only ICS feeds.
- **Choose what matters:** organize tasks in an Eisenhower matrix or a lightweight board, with lanes and task details.
- **Keep thoughts close:** capture notes and use an optional Sticker canvas for text and images.
- **See your time:** add Time for world clocks, local-time alarms, focus sessions and statistics. Switch between clocks and focus without stopping a session.
- **Arrange your desktop:** choose among six built-in modules on a 12×8 grid, resize and reposition them, and adjust density, color, blur and icon style.
- **Reach quick tools:** Nowly Bar offers reminders, screenshots, screenshot history and an optional AI assistant. Menu order/visibility and screenshot shortcuts are configurable.

For a workday, keep meetings, next actions and quick notes together. For study, pair deadlines with a focus session. For freelance delivery, keep your own board and reference notes in view. This is a personal workspace, not a shared team or cross-device cloud workspace.

## Start simply

1. Open Nowly and use **Edit layout → Add module** to choose what belongs on your desktop. Shrink or remove a module if the grid has no free space.
2. Add a schedule, a task or a note; add Time or Stickers when useful.
3. Use the wallpaper button to place the workspace behind your icons. Double-click the wallpaper or use the tray icon to return to the foreground.
4. Keep Nowly running in the tray for reminders. Closing a window is not fully exiting; use **Exit Nowly** from the tray to end the process.

See the [user guide](docs/user-guide.en.md) for clocks, alarms, autosave/retry, sticker limits, screenshot storage, native modes and development instructions.

## Local-first, with clear connection choices

Local work does not require a Nowly account. Structured records use local SQLite, while attachments, sticker images, screenshots and some UI preferences have separate local storage. Connected calendars fetch and cache external events; ordinary calendar editing can write to Google/Microsoft when authorized. Local-first does **not** mean every feature is offline or that nothing is synchronized.

AI is optional. Connect your chosen endpoint/model and allow calendar, task or external-calendar context as needed. Requests send your message, recent conversation, time metadata and allowed query results to that endpoint; **external-calendar permission includes cached Google, Microsoft and ICS events**, even when the model is a different provider. AI proposes local task/calendar changes for explicit confirmation and cannot edit external calendars. See [Privacy and data](docs/privacy-and-data.en.md) for exact fields, credentials, network activity and retention boundaries.

## Read more

- [User guide](docs/user-guide.en.md) · [Privacy and data](docs/privacy-and-data.en.md)
- [Product definition and source audit](docs/product-definition.md) · [Documentation index](docs/00-index.md)
- [Design system](design.md) · [Repository conventions](CLAUDE.md)

## For contributors

React + TypeScript + Vite, hand-authored CSS, Tauri 2/Rust, SQLite and separate local asset files. Existing tests use Vitest, Playwright and Rust tests. Windows development requires Node.js, Rust and Tauri's Windows prerequisites. Commands, source structure and scoped development-reset warnings are preserved in the [development section of the guide](docs/user-guide.en.md#development). This overview is not a platform compatibility test report.
