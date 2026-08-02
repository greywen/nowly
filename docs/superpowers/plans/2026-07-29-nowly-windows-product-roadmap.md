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
| 2. Event vertical slice | **已完成**（2026-07-29） | 月份查询、完整 CRUD、离线日期/时间控件及自动化门禁通过 |
| 3. Task vertical slice | **已完成**（2026-07-29） | 稳定排序、完整 CRUD、乐观完成回滚/重试、日期详情创建及双向事务关联通过 |
| 4. Note vertical slice | **已完成**（2026-07-29） | 便签 CRUD、固定颜色、置顶排序、主界面摘要、全部便签管理及自动化门禁通过 |
| 5. Settings and window lifecycle | 待开始 | 下一步：先编写并审批详细计划 |
| 6. Windows system integration | 未开始 | |
| 7. Release verification | 未开始 | |

阶段 1–3 交付的、后续阶段必须遵守的契约：

- Rust 迁移由 `src-tauri/src/db.rs` 的 `MIGRATIONS` 表驱动，编号递增且每个版本在独立事务中执行；新增 schema 变更一律追加版本号，禁止修改已发布迁移。当前最高版本为 5。
- IPC 模型统一 `#[serde(rename_all = "camelCase")]`；`events.category` 为字符串列（旧 `category_id` 已由迁移 2 重命名）。
- 所有命令返回 `Result<T, CommandError>`；`CommandError` 只暴露 `code/message/field`，内部错误经 `eprintln!` 落日志后转为稳定文案。
- 前端只能通过 `NowlyRepository` 访问数据；`src/data/tauri-nowly-repository.ts` 是唯一知道 Tauri 命令名的模块。
- 日程只通过 `list_events_in_range` 按本地月份半开区间读取，并通过 `create_event`、`update_event`、`delete_event` 写入；旧全量事件读取已移除。
- 日程分类固定为 `work | important | personal | learning`，颜色固定为 `blue | red | green | yellow`，前后端分别可信校验。
- 日程与任务的一对一关联由 SQLite 外键、唯一部分索引和 Immediate 事务共同维护；重关联和删除必须双向解除，不得删除关联任务。
- 启动资源经 `useAppBootstrap` 独立加载，单模块失败不影响其他模块，且各自提供 `retry*`。
- 组件状态契约为 `status: 'loading' | 'ready' | 'error'` + `errorMessage?` + `onRetry`；加载态为静态文案，禁止 spinner/骨架。
- 样式令牌集中在 `src/app/styles.css` 的 `:root`，语义类名（`app-shell`/`card`/`btn`/`quadrant`/`note` 等）为唯一视觉入口。
- `useTasks` 是任务读取、CRUD、完成状态和写入错误的唯一前端状态拥有者；`useAppBootstrap` 不再读取任务。
- 任务排序在 Rust 查询与 React 乐观状态中遵循同一语义：未完成优先、有截止日期优先、截止日期、优先级、创建时间、ID。
- 完成状态写入失败必须回滚原任务与顺序，并保存受修订号保护的原始目标用于重试；陈旧响应不得覆盖后续编辑或删除。
- 任务侧关联写入继续使用 Immediate 事务并双向同步日程；任务关联变化后必须刷新任务和当前可见日程月份。
- `useNotes` 是便签读取、CRUD 与排序的唯一前端状态拥有者；`useAppBootstrap` 只保留设置读取。
- 便签颜色固定为 `yellow | blue | green | purple`，前后端分别可信校验；排序统一为置顶优先、更新时间倒序、ID 稳定兜底。
- 便签主界面只展示受容器约束的摘要；完整列表仅在内部滚动的“全部便签”弹窗展示。

## Plan sequence

1. **Data foundation and empty startup** — **已完成**
   Plan: `docs/superpowers/plans/2026-07-29-nowly-data-foundation.md`
   Outcome: versioned migrations, typed settings/data IPC, repository injection, static loading/error states, empty production startup, and prototype-aligned empty widgets.

2. **Event vertical slice** — **已完成**
   Planned document: `docs/superpowers/plans/2026-07-29-nowly-events.md`
   Outcome: month queries, date detail, event creation/edit/delete, validation, offline date/time pickers, permanent-delete confirmation, and calendar refresh.

3. **Task vertical slice** — **已完成**
   Plan: `docs/superpowers/plans/2026-07-29-nowly-tasks.md`
   Outcome: quadrant ordering, task creation/edit/delete/completion, event-task transactional linking, and failed-completion rollback.

4. **Note vertical slice** — **已完成**
   Plan: `docs/superpowers/plans/2026-07-29-nowly-notes.md`
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
