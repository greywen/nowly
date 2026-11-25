# Microsoft Store MSIX distribution

The MSIX build uses a full-trust desktop application on Windows 10 2004 (19041) or later. It retains the Tauri bundle identifier `com.nowly.app` and detects package identity at runtime. It does not migrate or delete existing user data. The unpackaged installer remains supported.

## Build

Use Windows, Rust MSVC, Node dependencies from the lockfile, and the Windows SDK (MakeAppx and SignTool). Run from this worktree. The script builds the frontend and release executable, compiles the small startup launcher, copies only known payload files and existing Store PNG assets, escapes manifest values, and runs MakeAppx with schema validation enabled. It produces an unsigned MSIX and SHA256 hash. Builds use Cargo.lock; reproducible inputs do not imply byte-identical compiler or ZIP output across SDK versions. Pin toolchain/SDK versions in release infrastructure.

```powershell
.\scripts\package-msix.ps1 -IdentityName 'grey.wen.Nowly' `
  -Publisher 'CN=8EE404CC-AF62-4F66-B957-03A6E4D91C11' `
  -PublisherDisplayName 'grey.wen' -DisplayName 'Nowly' `
  -ProductId '9NZ6S35M4CL2' -Version 1.0.5.0 -WebView2 Evergreen
```

The Store requires a positive major version, components <= 65535 and revision zero. The repository currently has version 0.1.5, so supply a Store version explicitly. Package version and application version can differ; About reads the running MSIX package's four-part version from Windows, including offline. Unpackaged installations display the Cargo application version. Increment the package version for each upload. x64 is the default; arm64 requires the corresponding Rust target, MSVC libraries and native dependency toolchain. ARM64 has not been validated.

`-TargetDirectory` selects a dedicated Cargo target directory. `-SkipBuild` packages an already built `<TargetDirectory>\<target-triple>\release\nowly.exe`; the caller must ensure this executable matches the checked-out sources. Output defaults to `artifacts\msix` inside this worktree. Output is ignored by Git. Never submit validation fixtures containing an older executable.

## GitHub Actions

The Release workflow runs on pushes to main and can also be started manually from Actions. It builds EXE/MSI and an unsigned x64 MSIX, uploads the MSIX as an Actions artifact, and attaches it to the GitHub Release. Download the MSIX and submit it manually in Partner Center; this workflow does not submit to the Store or sign packages for sideloading.

No additional GitHub Secrets are required for MSIX. Package identity, publisher and Store Product ID are public values in the workflow. GitHub provides GITHUB_TOKEN automatically. The existing optional LLM_API_KEY is used only for release notes. Do not upload the local test certificate or private key.

The workflow maps release X.Y.Z to MSIX (X+1).Y.Z.0 to support the current pre-1.0 application versions while preserving version order across major releases. For example, 0.1.11 becomes 1.1.11.0 and 1.0.0 becomes 2.0.0.0. The manual 1.0.5.0 validation package is below this release series.

## WebView2

Explicitly choose `-WebView2 Evergreen`. No runtime or bootstrapper is bundled, downloaded or installed by the packaging script. Supported installations must already have Microsoft Edge WebView2 Evergreen Runtime (normally present on current Windows 10/11). On a clean machine without it, Tauri webview creation can fail. Store deployment does not automatically execute an installer custom action. Verify this prerequisite in a clean VM before submission and disclose it in the listing/support documentation. Fixed Version runtime packaging is intentionally unsupported until a matching Tauri loader configuration, licensing review and architecture verification are implemented. Do not assume the NSIS runtime installer applies to MSIX.

## Identity, startup, notifications and updates

The packaged process uses its Windows package identity. Unpackaged builds set the process AUMID to `com.nowly.app` for consistent taskbar grouping. Identity API errors are logged. Nowly does not register an HKCU notification identity or send native system notifications: calendar reminders, focus completion and alarms use Nowly Bar in both packaged and unpackaged builds, with application sounds independent of Windows notification permissions.

`NowlyStartup` is disabled by default. The app enables/disables it with Windows StartupTask APIs and reads actual state when settings are loaded. A user or policy disablement cannot be silently overridden; an enable request returns an actionable error. The manifest starts `nowly-startup.exe`, which resolves its sibling executable and passes `--background`. Existing wallpaper/hide-to-tray behavior is preserved. A background second launch does not bring an existing instance forward. The launcher exits after spawning Nowly.

The package also ships `nowly-cli.exe`, the command external AI agents run, as a second application `NowlyCli` with no Start menu entry (`AppListEntry="none"`) and the console subsystem. Its `uap5:AppExecutionAlias` registers `nowly.exe`, so `nowly` works in any terminal; the alias does not shadow the main app, which is never launched by name. When Nowly is not running, the CLI activates `<package family>!Nowly` with `--background` through `IApplicationActivationManager`, so the app runs under its own application identity rather than as a child of the alias. `scripts/package-msix.ps1` builds and stages both binaries.
All installations offer a Microsoft Store entry in About; no application update check queries GitHub. MSIX builds query `StoreContext.GetAppAndOptionalStorePackageUpdatesAsync` once at launch and on explicit retries. Only updates matching the current main package family trigger the update badge. The desktop Store context is initialized with the calling window's HWND and starts the query on the UI thread, as required by Store. Completion is awaited asynchronously with a 15-second timeout and cancellation, without blocking the UI. Store can return cached results when its check-frequency limits are exceeded. Package identity alone does not prove Store acquisition: sideloaded packages can show their installed version but Store checks require a working Store association and entitlement environment.

Installed version retrieval is independent of the network check. Pending or failed checks never report that the app is up to date. A failed check preserves the package version and offers Retry. A successful empty result means no update is currently offered for this device/account; it does not promise a globally latest version. The API result is not used to infer a target version number or release notes.

The Store button first opens `ms-windows-store://pdp/?ProductId=...`; if activation fails it tries the HTTPS product page and informs the user of the browser fallback. Failure of both attempts remains visible and can be retried. Packaged builds read the validated Product ID from `nowly-store.json`; unpackaged builds use Nowly's public Product ID `9NZ6S35M4CL2`. Invalid package metadata produces an explicit operation error. The generic external-link command still only accepts HTTPS and mailto.

Unpackaged EXE/MSI installations and browser previews do not automatically query Store updates or claim they are up to date. Their Store entry opens the product page. The Store edition installs separately and existing unpackaged data is not automatically migrated. Store performs downloads and installation; Nowly does not force updates, restart itself, or migrate user data.

## Data, coexistence and uninstall

The logical Tauri app-data path remains `%APPDATA%\com.nowly.app`; it is not changed to the package install directory. MSIX can virtualize AppData writes into the package's per-user data area, including `LocalCache`, depending on Windows version and packaging behavior. Do not assume packaged and unpackaged installations share the same physical SQLite database. Package updates normally retain package data; uninstall/reset can remove package-managed data. External files and unpackaged data can remain. Back up before reset/uninstall and verify actual paths on supported Windows versions.

No automatic copy, merge, deletion or destructive migration is added. To transfer data, quit both editions, back up the entire source data directory (including attachments and SQLite WAL/SHM if present), identify the destination physical data directory in a test installation, and restore a copy while the app is closed. Preserve the source backup and validate tasks, notes, timers and attachments before removing either edition. Do not run both editions against one database or manually point one at the other's active files. Existing single-instance behavior also requires coexistence testing. Disable startup in the old edition before enabling it in the Store edition; the packaged app does not delete the old registry startup entry.

## Local signing and installation

Use a disposable Windows test account or VM. A local certificate's Subject must exactly match the manifest Publisher. Never commit a PFX or password. For local tests create a code-signing certificate in that test account, export only its public certificate for trust, trust it in the VM's TrustedPeople store, and sign using its thumbprint. Do not trust test certificates on production machines.

```powershell
$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=Nowly Test' `
  -KeyUsage DigitalSignature -FriendlyName 'Nowly MSIX test' `
  -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
# Build using -Publisher 'CN=Nowly Test' first.
Export-Certificate -Cert $cert -FilePath .\artifacts\msix\NowlyTest.cer
Import-Certificate -FilePath .\artifacts\msix\NowlyTest.cer -CertStoreLocation Cert:\CurrentUser\TrustedPeople
# Run the SDK's signtool.exe (full path if it is not on PATH).
signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My .\artifacts\msix\Nowly-1.0.5.0-x64.msix
signtool verify /pa /v .\artifacts\msix\Nowly-1.0.5.0-x64.msix
Add-AppxPackage .\artifacts\msix\Nowly-1.0.5.0-x64.msix
Get-AppxPackage -Name Nowly.Test | Select-Object Name,PackageFamilyName,InstallLocation
```

Launch from Start. Test a higher package version as an update. Back up data before removing the test package with `Remove-AppxPackage`; removal/reset can delete package data. Remove the test certificate and public trust entry by their exact thumbprints when finished. Store submissions use Partner Center signing; do not distribute a test-signed package as a production build.

## Partner Center submission materials

Reserve the product and obtain exact Package/Identity/Name, Publisher, PublisherDisplayName and Store Product ID. Supply localized descriptions, supported languages, age rating, category, pricing/availability, privacy-policy and support URLs, screenshots and Store artwork, release notes, copyright/license disclosures, and reviewer instructions. Explain the `runFullTrust` restricted capability and the desktop features requiring it (wallpaper integration, global shortcuts, the hold-to-talk keyboard hook, capture and local file access). The `microphone` device capability is declared for optional hold-to-talk voice input, which is off by default and recognizes speech on the device; describe it in the privacy disclosure. Declare network/OAuth/AI integrations and optional credentials accurately. Real OAuth credentials are not needed to compile but authentication integrations require authorized release configuration and redirect registrations. Run Windows App Certification Kit and address its results before submission. Acceptance and restricted-capability approval remain Partner Center decisions.

## Compatibility and performance verification gate

- Clean Windows 10 19041+ and Windows 11: install, Start launch, no unexpected elevation, icons and publisher attribution; verify WebView2 present and separately test the missing-runtime case.
- Log off/on with startup enabled and disabled; user-disable via Settings/Task Manager; policy-disabled state; background wallpaper on/off; duplicate background launch; foreground Start activation.
- Nowly Bar calendar reminders, focus completion, alarm acknowledgment/snooze and sounds, including tray operation and after a reboot or package update. Verify that Windows Notification Center receives no Nowly system notifications and disabling Windows notifications does not affect Bar reminders or sounds.
- Wallpaper attach/detach, multiple monitors/DPI, tray, screenshots/clipboard, shortcuts, file pickers, OAuth browser callbacks and network features under package identity.
- Offline launch and offline About: real four-part version remains visible, the failed check offers Retry, and the Store entry remains available. Verify EXE/MSI shows its build version without any GitHub or Store update query, and the Store button opens the correct product.
- With a Store-installed package, test both no available update and a newer main package offered to the test account; verify the red dot and Store update action, install through Store, then restart and confirm the new package version. A sideloaded package or a mocked browser check is not evidence of Store delivery. Verify package upgrade retaining data, reset/uninstall and manual migration with backups, and coexistence with the unpackaged edition.
- Compare cold/warm launch time, idle CPU/RAM, wallpaper frame activity, screenshot latency and focus/reminder timing against the same unpackaged version on the same machine. Startup launcher must exit promptly. Record OS/SDK/runtime versions and measurements; this change sets no unmeasured performance claims.

Implementation validation includes Cargo checks/tests and MakeAppx schema validation. Signing, installation, logon, Store delivery, WACK and the device/performance matrix require a signed installed package and are not implied by a successful build.
