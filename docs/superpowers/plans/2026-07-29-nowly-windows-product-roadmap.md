# Nowly Windows Product Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each linked plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Nowly Windows 10/11 product as seven independently testable vertical stages.

**Architecture:** React feature repositories call typed Tauri commands; Rust validates requests and persists data in versioned SQLite transactions; isolated Windows services own wallpaper, tray, startup, and monitor behavior. Each stage leaves the application buildable and usable before the next stage starts.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Tauri 2, Rust, rusqlite/SQLite, Win32 `windows` crate, lucide-react.

---

**Approved specification:** `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`

## Overall status

| 阶段 | 状态 | 说明 |
|---|---|---|
| 1. Data foundation and empty startup | **已完成**（2026-07-29） | 阶段门禁全部通过；详见阶段 1 计划文首状态表 |
| 2. Event vertical slice | 待开始 | 下一步：先写详细计划，再执行 |
| 3. Task vertical slice | 未开始 | |
| 4. Note vertical slice | 未开始 | |
| 5. Settings and window lifecycle | 未开始 | |
| 6. Windows system integration | 未开始 | |
| 7. Release verification | 未开始 | |

阶段 1 交付的、后续阶段必须遵守的契约：

- Rust 迁移由 `src-tauri/src/db.rs` 的 `MIGRATIONS` 表驱动，编号递增且每个版本在独立事务中执行；新增 schema 变更一律追加版本号，禁止修改已发布迁移。当前最高版本为 4。
- IPC 模型统一 `#[serde(rename_all = "camelCase")]`；`events.category` 为字符串列（旧 `category_id` 已由迁移 2 重命名）。
- 所有命令返回 `Result<T, CommandError>`；`CommandError` 只暴露 `code/message/field`，内部错误经 `eprintln!` 落日志后转为稳定文案。
- 前端只能通过 `NowlyRepository` 访问数据；`src/data/tauri-nowly-repository.ts` 是唯一知道 Tauri 命令名的模块。
- 启动资源经 `useAppBootstrap` 独立加载，单模块失败不影响其他模块，且各自提供 `retry*`。
- 组件状态契约为 `status: 'loading' | 'ready' | 'error'` + `errorMessage?` + `onRetry`；加载态为静态文案，禁止 spinner/骨架。
- 样式令牌集中在 `src/app/styles.css` 的 `:root`，语义类名（`app-shell`/`card`/`btn`/`quadrant`/`note` 等）为唯一视觉入口。

## Plan sequence

1. **Data foundation and empty startup** — **已完成**
   Plan: `docs/superpowers/plans/2026-07-29-nowly-data-foundation.md`
   Outcome: versioned migrations, typed settings/data IPC, repository injection, static loading/error states, empty production startup, and prototype-aligned empty widgets.

2. **Event vertical slice** — 下一阶段
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-events.md`
   Outcome: month queries, date detail, event creation/edit/delete, validation, offline date/time pickers, permanent-delete confirmation, and calendar refresh.

3. **Task vertical slice**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-tasks.md`
   Outcome: quadrant ordering, task creation/edit/delete/completion, event-task transactional linking, and failed-completion rollback.

4. **Note vertical slice**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-notes.md`
   Outcome: note creation/edit/delete, pinning, fixed colors, dashboard summaries, and the all-notes dialog.

5. **Settings and window lifecycle**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-window-lifecycle.md`
   Outcome: persisted settings, authoritative window mode, close-to-wallpaper/close-to-tray decision, overlay cleanup, and expanded tray actions.

6. **Windows system integration**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-windows-integration.md`
   Outcome: login startup, background launch, single instance, stable monitor enumeration/selection, disconnect fallback, display-change handling, and Explorer recovery.

7. **Release verification**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-release-verification.md`
   Outcome: full automated suites, Windows 10/11 manual matrix, idle-resource checks, installer verification, usage documentation, and known limitations.

## Sequencing rules

- Execute plans in order because later slices depend on the data/repository contracts established in stage 1.
- Write the next detailed stage plan only after the preceding stage passes its tests and review; this keeps exact paths and APIs synchronized with the actual codebase.
- Every production behavior follows Red-Green-Refactor: add one failing test, verify the expected failure, implement the minimum, verify green, then refactor.
- Use the commit format required by `CLAUDE.md`: `<type>: <short description>`.
- Do not rewrite the existing WorkerW/taskbar subsystem during business CRUD stages.
- Before every UI edit, reread root `design.md`; it overrides the prototype and older styles.
- Do not introduce transitions, animations, smooth scrolling, spinners, skeleton shimmer, legacy blue tokens, hand-written business SVG, or emoji icons.

## Stage gates

A stage may close only when:

- its focused Rust and React tests pass;
- `npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` pass;
- changed UI has no page-level overflow and follows `design.md`;
- `git diff --check` is clean;
- the stage receives code review before the next detailed plan is written.
