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
  and session statistics.
- **Kanban board** — customizable lanes, cards, and fields for lightweight
  project tracking.
- **Notes** — quick capture with a dedicated manager for organizing entries.
- **Wallpaper mode** — embed Nowly behind your desktop icons with taskbar-aware
  positioning, or run it as a regular window.
- **Flexible layout** — arrange every module on a 12x8 grid; toggle modules on
  or off and resize them freely.
- **Custom modules** — install sandboxed `.js` extensions from a local file or
  the built-in module market, each running in an isolated iframe.
- **Personalization** — Gaussian blur, a global color picker, calendar
  formatting, density controls, and login-on-startup.
- **Localization** — English and Simplified Chinese, following your system
  language on startup.

## Usage

- Use the top-right button to set Nowly as your wallpaper.
- Double-click the wallpaper or click the tray icon to return to foreground
  mode.
- Open **Settings** to control wallpaper close behavior, login startup, calendar
  formatting, density, and module visibility.
- Closing the foreground window restores the wallpaper when the wallpaper
  preference is enabled; otherwise it hides to the tray.
- **Exit Nowly** in the tray menu is the only action that terminates the
  process.

## Tech Stack

- **Frontend** — React + TypeScript, built with Vite and styled with
  Tailwind CSS.
- **Desktop shell** — Tauri 2 with a Rust backend.
- **Storage** — local SQLite via `rusqlite` (bundled).
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

## Project Structure

```text
src/                 React frontend
  app/               App shell, layout grid, bootstrap hooks
  calendar/          Monthly calendar and events
  matrix/            Eisenhower task matrix
  kanban/            Kanban board
  notes/             Notes
  focus/             Focus timer and statistics
  widgets/           Extension/custom-module system and sandbox
  components/        Shared UI (Dialog, Select, DatePicker, ...)
  data/              Repository interface and Tauri implementation
  i18n/              Localization (en/zh)
src-tauri/           Rust backend (Tauri commands, SQLite, wallpaper, tray)
registry/            Custom-module registry and examples
docs/                Design specs and implementation plans
```

## Custom Modules

Custom modules are self-describing `.js` files that run in an isolated iframe
sandbox (`allow-scripts`, null origin, strict CSP). They cannot import packages,
touch the parent DOM, or reach the network directly — the host exposes a small
`host` API (`state`, `today`, and a permissioned `host.fetch`) plus a `root`
element to render into. Once installed, a module becomes a freely placed widget
on the 12x8 grid alongside the built-in modules. See
`docs/custom-modules/SKILL.md` for the full module format and runtime contract.
