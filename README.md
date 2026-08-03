# Nowly

Nowly is a local-first Windows 10/11 desktop productivity panel combining a monthly calendar, Eisenhower task matrix, and notes. Data is stored locally in SQLite.

## Use

- Use the top-right button to set Nowly as wallpaper.
- Double-click the wallpaper or click the tray icon to return to foreground mode.
- Open **Settings** to control wallpaper close behavior, login startup, calendar formatting, density, and module visibility.
- Closing the foreground window restores wallpaper when wallpaper preference is enabled; otherwise it hides to the tray.
- **Exit Nowly** in the tray menu is the only action that terminates the process.

## Development

```bash
npm install
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright test
npm run tauri build
```

## Troubleshooting

If wallpaper embedding or Explorer recovery fails, open Nowly from its tray icon and retry setting wallpaper. User data remains in the Tauri application data directory as `nowly.sqlite`; back up that file before manual recovery operations.

See `docs/release/windows-verification.md` for the Windows verification matrix and known limitations.
