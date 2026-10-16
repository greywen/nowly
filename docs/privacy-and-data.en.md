# Privacy and data

[简体中文](privacy-and-data.zh.md) · [User guide](user-guide.en.md) · [Product definition and source evidence](product-definition.md)

This describes the current source implementation, not a promise that every feature is offline. Local-first means local records are the foundation; connected calendars, AI, update checks and externally opened links have network boundaries.

## What is stored where

| Data | Desktop storage |
|---|---|
| Local events and recurrence exceptions, tasks and board metadata, notes, focus records, clocks, alarms, layout and most settings | `nowly.sqlite` in the Tauri application-data directory |
| Connected calendar accounts, subscription configuration and cached external events | SQLite; account/provider labels and event content are not encrypted as a whole |
| OAuth access/refresh tokens and the AI API key | Windows current-user DPAPI encrypted blobs in SQLite; the database itself is not fully encrypted |
| Rich-text attachments (including notes, events and tasks) | Files in application-data `attachments`; database references/metadata; the existing attachment limit is 1 MiB |
| Sticker images | Files in application-data `stickers`; canvas and asset metadata in SQLite |
| Final screenshots | PNG files in the system `Pictures\Nowly\Screenshots` directory, which follows redirected Pictures locations; metadata in SQLite and separate regenerable thumbnail caches |
| Some UI preferences | WebView local storage, including blur and onboarding state |

The browser development backend is separate: most simulated records use localStorage, sticker artwork/images use IndexedDB, and rich-text attachment bytes are held in memory. Browser data is not the desktop SQLite database and browser mode does not implement the full native feature set.

Removing a Sticker module hides its canvas rather than deleting it. Successful canvas saves clean unreferenced images. Screenshot Save and Copy image and finish both archive the final output; screenshots are retained until deleted. Cancelled captures do not create history. Raw desktop frames are used only for the active capture session. Copy sends the final image to the Windows clipboard; other applications may read it.

## Optional AI: the exact context boundary

AI is not required for the workspace. Configure an endpoint, Model ID and API key and select allowed data categories before requesting assistance. Saving/connecting runs a fixed JSON connection test against candidate protocol paths on the configured origin, using the chosen model and credential but no workspace query results. Remote endpoints must use HTTPS; HTTP is allowed for loopback endpoints. A local model endpoint is possible, but choosing it does not prove that the model service itself never connects elsewhere.

A normal request sends system instructions, current local date/time, device timezone, week-start preference, permission flags, the entered message, up to 12 recent user/assistant history messages, and, when revising, the previous draft's actions. These messages and drafts are sent regardless of which record category is allowed. Do not paste sensitive content expecting category switches to redact your own messages or previous conversation context.

When the model asks to query records, the host validates the category and filters before adding results to a subsequent request:

| Permission | Fields returned to the model |
|---|---|
| Local calendar | Record key, domain, title, local source label, read-only flag; ID/target occurrence identity, start/end, all-day flag, reminder offsets, series ID |
| Local tasks | Record key, domain, title, local source label, read-only flag; ID, priority, due date, completion, lane ID and view membership; lane IDs/names, default/completion lanes and view-linking setting |
| External calendar (read-only to AI) | Record key, domain, title, subscription/source name, read-only flag; cached event ID, start/end, all-day flag and source's last successful sync timestamp |

**Google Calendar events are included when external-calendar permission is enabled**, as are cached Microsoft and ICS events. This is one shared permission, not a per-provider/per-account selector. Local-calendar permission alone does not include external events. The AI queries the local external-event cache, not Google or Microsoft directly; external synchronization is a separate network path. A cached Google event may therefore be sent to a different, user-configured AI provider.

Queries do not include local event notes, task descriptions, external descriptions/locations, attachment/image bytes, note entries, screenshots, sticker artwork, OAuth tokens or arbitrary database tables. This exclusion applies to the query adapter, not to content typed into messages or placed in a previous draft: draft actions can contain event notes or task descriptions. The API key is used to authenticate to the model endpoint, not as record context.

Calendar queries cover 1–90 days and each query returns at most 200 records with a truncation flag. A request can make at most four model steps and has a 192 KiB serialized-context cap. These bounds are not a guarantee that the selected context is nonsensitive.

The model can query and propose but cannot execute writes. Local calendar/task changes require a visible plan and explicit button confirmation; external events are read-only to AI even when the ordinary calendar editor supports remote writes. There are no arbitrary code, SQL, module, file or network-write tools exposed to the model. Plans and scoped inverse patches are stored locally; records older than seven days are pruned when assistant storage is accessed. Chat history is held in the panel's memory, not a durable full-chat archive. Expiry/conflict checks can prevent confirmation or undo. Stopping a request prevents unconfirmed local writes, but cannot retract content already sent to a provider. Provider retention and processing are governed by that service, not by local plan pruning.

Optional dictation uses the host Web Speech API where available. It fills a text draft rather than sending it automatically. Recognition processing may depend on the host's service and cannot be described as guaranteed offline; type instead when that boundary is unsuitable.

## Calendar connections and other network activity

- Basic local use does not require a Nowly account. Google/Microsoft account authorization is optional and opens the provider's browser sign-in flow with Authorization Code + PKCE (S256), a temporary loopback callback and state validation. Google uses `openid email https://www.googleapis.com/auth/calendar`; Microsoft uses `openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite`. These are calendar read/write scopes, not merely read-only scopes. No assertion about provider verification or approval is made here.
- Connected accounts supply a provider/email label, calendar list and selected calendar events. Tokens are refreshed as needed. Cached events include title, times, location, description and reminders; the AI adapter sends only the narrower fields listed above.
- ICS/webcal subscriptions fetch the configured feed; webcal is normalized to HTTPS. Subscription URLs can themselves contain access tokens: treat them as secrets when sharing a backup. ICS is read-only. Up to 50 sources, with refresh intervals of 1–30 minutes, are supported; the UI defaults to 15 minutes. Startup/manual/interval refresh can access configured sources while Nowly runs. Failures retain the last successful cache, which can be stale. ICS expansion covers the current month plus six months either side; OAuth fetches approximately 190 days either side of now.
- Ordinary calendar editing can create, update or delete Google/Microsoft remote events where the account has write scope. Edits send event titles, times, reminders and, for full edits, note/description content to that provider. Remote recurrence-rule creation/editing is not supported. This is distinct from AI's read-only external access.
- Disconnecting removes the local account and its dependent subscriptions/cache via database cascades; it is not a provider-side grant revocation. Revoke access in the provider's account settings as well if required. Deleting a local subscription does not delete the remote calendar.
- On launch, update checking requests the project's latest public GitHub release (`api.github.com/repos/greywen/nowly/releases/latest`). It does not send workspace records in its payload, but GitHub receives ordinary network request information. A failure leaves local use available.
- Feedback/about links can open HTTPS or mail targets in external applications. Their subsequent handling is outside Nowly's local storage boundary.

## Backups and control

Protect the application-data directory, screenshot directory and browser/WebView profile as personal data. Fully exit Nowly before manually copying desktop storage; preserve associated files and any SQLite sidecars, not just a single database file. A copied database alone is not a complete backup. DPAPI credentials are tied to the Windows user environment, so reconnect services after moving to another environment rather than treating encrypted tokens as portable. No automatic cross-device backup or full-workspace synchronization service is established by these storage paths.

Use the existing editors to delete records, the screenshot history confirmation to remove archived PNGs/caches, and calendar settings to disconnect sources. Changing AI permissions limits future host queries; it does not erase content already sent or conversation messages still in the panel. Clearing the API key is separate from deleting local plans or revoking a provider-issued key. Review provider settings for remote retention or deletion.
