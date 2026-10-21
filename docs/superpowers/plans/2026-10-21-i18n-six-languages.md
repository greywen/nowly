# Six-language internationalization implementation plan

> **For agentic workers:** Use test-driven development for behavior changes and dispatching-parallel-agents for isolated locale dictionaries. Track evidence here. Preserve existing working-tree changes.

**Goal:** Add French, Spanish, Arabic, Japanese, Korean and Traditional Chinese to the desktop application.

**Architecture:** Retain the existing synchronous translation API and persisted language store. Centralize language metadata and Intl locale selection. Supply complete independent dictionaries, including time-module namespaces. Arabic applies RTL to application controls, with explicit LTR geometry boundaries for user-positioned content.

**Tech Stack:** React, TypeScript, Intl, Vitest, Playwright, existing handwritten CSS.

## Approved scope and constraints

- Existing `zh` and `en` persisted values remain compatible. New IDs: `fr`, `es`, `ar`, `ja`, `ko`, `zh-Hant`.
- Traditional Chinese follows Taiwan terminology by default; identify Hant/TW/HK/MO while respecting explicit Hans.
- Keep user-entered text, module coordinates, screenshot pixels, sticker coordinates and saved business data unchanged.
- Retain existing time-zone, Gregorian-calendar, first-weekday and hour-cycle business rules. Localize presentation, not scheduling.
- Translate app UI including existing hidden AI surfaces; do not re-enable hidden features.
- No website/manual translations or runtime translation service.
- Preserve unrelated changes to design.md, user guides and screenshot scroll files.
- Work in current `dev` checkout; no branch switch, publish or automatic commit of user files.

## Task 1 — Language foundation

- [x] Add failing store tests for eight supported IDs, BCP-47 aliases, persistence, cross-window events and html lang/dir.
- [x] Add failing translation tests for Arabic plural categories and locale-aware numeric placeholders.
- [x] Run `npm test -- src/i18n` and record RED.
- [x] Implement metadata (`src/i18n/locales.ts`), store normalization/detection and document attributes.
- [x] Update `src/i18n/index.ts` to use active language plural and number formatting.
- [x] Verify focused tests.

Contract examples:
```ts
expect(normalizeLanguage('zh-TW')).toBe('zh-Hant');
expect(normalizeLanguage('zh-Hans-HK')).toBe('zh');
expect(normalizeLanguage('fr-CA')).toBe('fr');
setLanguage('ar');
expect(document.documentElement.dir).toBe('rtl');
```

## Task 2 — Complete dictionaries

- [x] Add completeness tests comparing each locale against the full English catalog, with placeholder parity and no empty values.
- [x] Observe RED before creating locale dictionaries.
- [x] Create `src/i18n/locales/{fr,es,ar,ja,ko,zh-Hant}.ts`; each exports a flat dictionary.
- [x] Consolidate supplemental time strings into the existing translation API without changing helper call sites.
- [x] Verify key/placeholder parity and representative translations. English fallback remains a safety net, not a substitute for entries.

## Task 3 — Formats and language selector

- [x] Add failing tests for localized dates, month/weekday names and all eight selector options.
- [x] Use locale metadata across calendar, top bar, screenshot history, time and AI speech/date helpers.
- [x] Keep computation-only fixed-locale parsers unchanged.
- [x] Replace the two-option settings list with native language names.
- [x] Verify focused calendar/time/settings suites.

## Task 4 — RTL and browser verification

- [x] Add Playwright tests for all languages, persistence, secondary-window synchronization, RTL-to-LTR restoration and narrow-window overflow.
- [x] Extend design.md with a scoped internationalization contract, preserving its pre-existing edits.
- [x] Apply RTL-aware logical spacing/alignment and directional icons. Isolate module layout, stickers, screenshot geometry, numeric time controls and code/URL fields from unwanted mirroring.
- [x] Run browser tests on 1366×768 and 1920×1080; inspect screenshots/DOM geometry.
- [x] Run full `npm test`, `npm run build` and `git diff --check`.
- [x] Request independent code review; fix significant issues and repeat covering tests.

## Evidence / execution ledger

- Initial branch: `dev`, base `1914acc`. Existing dirty files recorded before edits.
- Preflight: Task 1 produces `Language`/locale metadata consumed by Tasks 2–4; Task 2 supplies all keys consumed by Task 3. Locale workers own only their assigned new files; shared logic stays with the integrator.
- TDD evidence: initial locale checks failed 26 cases, format checks failed 8, RTL keyboard checks failed 2, nested-placeholder plural check failed 1. All passed after implementation. Six dictionaries each contain 1,210 explicit entries; the shared native-error supplement adds six translated keys per language.
- Arabic catalogs cover zero/one/two/few/many/other. Machine clock parsing remains fixed `en-CA`/Latin digits; display formatter caches include locale.
- Independent review fixes: statistics labels in every locale; capture-entry RTL import; stable sticker fonts/measurement; repository and direct screenshot/Bar native-error boundaries; stable screenshot font shared by editor, SVG/export and measurement. Each defect gained a failing regression test before correction.
- Native tray: existing quit item is localized without rebuilding tray behavior. Startup and language-change sync are restricted to the native main window on both frontend and Rust boundaries. `cargo test native_language::tests -- --nocapture`: native compilation and 2 tests passed.
- Browser checks cover all eight languages, native-name selector, persisted reload, a real second history window, unchanged module rectangles, overflow, dedicated capture entry and text measurement, and saved sticker geometry across all languages/remounts. Both 1366×768 and 1920×1080 are exercised (22 cases).
- Baseline verification: a clean `git archive HEAD` snapshot at `.superpowers/i18n-baseline-20261021/source` reproduces four existing failures (82 passed): one obsolete note-title input assertion in `App.test.tsx`, three assertions expecting hidden AI menu entries in `StatusIslandApp.test.tsx`. These features remain unchanged; AI stays hidden.
- Final targeted independent review: no remaining actionable findings.
- Final `npm test -- --maxWorkers=4`: **1,633 passed / 4 baseline failures**, 149 files (147 passed, 2 with the documented baseline failures). The test-only capture rejection fixture now supplies the real structured error code; it passes without weakening the user-facing assertion.
- Final `PW_PORT=1431 npx playwright test tests/nowly-i18n.spec.ts --project=1366x768 --project=1920x1080 --workers=2`: **22/22 passed** after the last font correction. Arabic/French screenshots were inspected; no settings clipping. Latin-language font fallback no longer expands French apostrophes.
- Final `npm run build`: **passed**. `git diff --check`: **passed** (only Git LF/CRLF normalization notices). Compiled Rust test executable was independently rerun for `native_language::tests`: **2/2 passed**.
- Local diagnostic logs: `.i18n-tests-final.log`, `.i18n-browser-final.log`, `.i18n-build-final.log`, `.i18n-baseline.log`; intentionally ignored rather than committed.

## Verification boundaries

- Browser IPC is simulated; actual Windows tray interaction, multi-monitor capture, native hit regions and OS notifications were not end-to-end exercised. Native tray code is compiler/test verified, not visually certified.
- Translation completeness, placeholders and representative grammar are automated-checked. Six-language human/native-speaker linguistic review remains recommended.
- Existing Vite JSON-import/chunk-size warnings are not introduced or resolved by this scope.
- No commit, push, release, data migration or website/manual translation was performed. Pre-existing user edits are preserved.
