# Nowly 产品定义 / Product definition

## 定位 / Positioning

**Nowly · 此刻，你的 Windows 个人工作桌面**  
**Your personal workspace for Windows**

面向在 Windows 上工作、学习和独立交付的人：个人工作者、学生、自由职业者。把安排、任务、记录和时间放在可自行组织的桌面上，而不是要求用户围绕 AI 或某一种生产力方法工作。AI 是可选助手，不是产品主体。

For personal Windows work, study and freelance delivery: arrange schedules, tasks, notes and time on your own desktop. The product is a workspace, not an AI agent product, enterprise collaboration suite or cross-device cloud service.

## 当前产品范围 / Current scope

| Area | Implemented boundary and source evidence |
|---|---|
| Modules | Six built-in picker entries: Calendar, Matrix, Notes, Kanban, Time, Stickers. `src/widgets/widget-registry.ts`: 12×8 non-overlapping layout; fallback/default definitions contain Calendar/Matrix/Notes, others are optional. `src/app/layout` and onboarding handle empty-layout welcome. Focus lives in Time rather than a separate current picker entry. |
| Tasks and notes | `src/tasks`, `src/matrix`, `src/kanban`, `src/notes`, `src-tauri/src/task_workspace.rs`: local task views, lanes, metadata and notes. Collaborator labels are local metadata, not evidence of live multi-user collaboration. |
| Desktop surfaces | `src-tauri/src/wallpaper.rs`, `window_lifecycle.rs`, `shell.rs`, `quick_panel.rs`, `status_island.rs`: ordinary foreground, desktop wallpaper behind icons, tray, top-edge quick panel/Nowly Bar and fullscreen focus. Closing is not fully exiting; tray Exit terminates the process. Wallpaper-mode chrome can be hidden by a setting, independently of Bar. |
| Time and notifications | `src/time`, `src/focus`, `src-tauri/src/focus_timer.rs`, `time/scheduler.rs`, `sounds.rs`: shared native focus state, world clocks, local-time alarms, reminders and bundled sounds. App must remain running for scheduled reminders; no detached Windows alarm task is installed. |
| Screenshots and stickers | `src-tauri/src/screenshot_history`, `screen_capture`, `stickers.rs`: final screenshot PNG archive and local image canvas. Screenshot metadata is not screenshot image bytes. Sticker deletion/cleanup and read-only modes differ from simply hiding a module. Detailed limits remain in the guides. |
| External calendars | `oauth.rs`, `calendar_api.rs`, `subscriptions.rs`, `subscription_sync.rs`, `remote_events.rs`, `src/calendar/useEvents.ts`: Google/Microsoft OAuth, selected calendars, cached events, refresh, manual remote create/update/delete with write scope; HTTPS ICS is read-only. Remote recurrence-rule creation/editing is unsupported. Not a general full-workspace sync service, but definitely not “no sync.” |
| Optional AI | `src/assistant`, `src-tauri/src/assistant/provider.rs`, `actions.rs`, `store.rs`, `detection.rs`, `rig_transport.rs`: endpoint/model/key configuration, six protocol families (OpenAI Chat/Responses, Azure, Anthropic, Gemini, Ollama), same-origin fixed connection probes, bounded queries, local plan preview/confirmation and guarded undo. No autonomous or external-calendar writes. |
| Storage | `src-tauri/src/main.rs`, `attachments.rs`, `stickers.rs`, `screenshot_history/store.rs`, `token_store.rs`, `src/app/useBlur.ts`, `src/app/onboarding/useOnboarding.ts`: SQLite plus separate asset/archive/cache files and some WebView localStorage. DPAPI protects credential blobs on Windows, not all personal record content. Browser shim uses localStorage, in-memory rich-text attachments and sticker IndexedDB. |
| Network | Subscription/OAuth/provider requests; `src-tauri/src/update.rs` and `src/settings/useUpdateCheck.ts` request GitHub Releases; feedback links open external targets. Optional Web Speech recognition cannot be promised offline. No blanket “all data local” or “no network” claim. |

## AI 数据边界 / AI context boundary

The initial request includes entered text, up to 12 recent user/assistant messages, current time/timezone/week-start/permission metadata and optional previous draft actions. Category switches control host record queries, not user text/history/draft redaction.

- **Local calendar:** title, record/occurrence identity, start/end, all-day, reminders, series identity and source/read-only metadata. Not event note bodies.
- **Local tasks:** title, ID, priority, due date, completion, lane/view membership and lane names/IDs/default/completion/linking metadata. Not task descriptions.
- **External calendar:** cached title, event ID, start/end, all-day, source/subscription name and last sync timestamp. **This includes Google, Microsoft and ICS with the shared external permission enabled**, even if the configured model is a different provider. Not external descriptions/locations or OAuth tokens.
- Query results exclude notes, attachments, screenshots, sticker content and arbitrary tables. User messages or previous draft actions can still contain notes/descriptions.
- Calendar range is 1–90 days, 200 results per query, at most four model steps, 192 KiB context cap. Writes require explicit plan confirmation, at most 20 unique actions in one domain; previews expire after five minutes and cannot be confirmed across application sessions. Stored plans/inverse patches have a seven-day access-triggered retention window; guarded undo is not an unconditional rollback.

完整双语边界见 [隐私与数据](privacy-and-data.zh.md) / [Privacy and data](privacy-and-data.en.md)。

## 传播与文档边界 / Editorial boundaries

- 先讲个人 Windows 桌面与实际使用场景，再讲模块；将 AI 和外部日历标明为按需连接。
- Do not promise all records are SQLite, all features offline, no synchronization, automatic backup, autonomous AI execution or live team collaboration.
- Do not infer pricing, product licensing, provider verification, release readiness or a tested Windows compatibility matrix from source support. This document is a source audit, not a platform test report.
- Preserve operational details, migration warnings and limits in [中文指南](user-guide.zh.md) / [English guide](user-guide.en.md); READMEs are product entry points.
- **Custom modules:** this checkout has no tracked custom-module documentation or runtime registry beyond the six built-ins (`extensionDefinitions` is empty). Do not invent an install/publish capability or a broken link. If separate custom-module documentation is restored, link that authoritative document from the index/guides and audit its runtime/network contract before advertising it as supported.

## 文档入口 / Reading paths

- [中文产品介绍](../README.zh.md) / [English overview](../README.md)
- [中文用户指南](user-guide.zh.md) / [English user guide](user-guide.en.md)
- [中文隐私与数据](privacy-and-data.zh.md) / [Privacy and data](privacy-and-data.en.md)
- [文档索引](00-index.md)

Audit scope: source and existing documentation only; no OAuth credential file, personal database or real user content was read. No runtime changes or platform/provider verification are asserted.
