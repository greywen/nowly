# Nowly Docs

## Current Status

- 阶段 1「数据基础与空状态启动」、阶段 2「日程纵切」与阶段 3「任务纵切」已完成（2026-07-29）。
- 下一阶段为阶段 4「便签纵切」；开始实施前必须先编写并审批详细计划。
- 总进度见 [Nowly Windows 完整产品实施路线图](./superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md) 的 Overall status 表。

## Module Index

| 模块 | 路径 | 职责 |
|---|---|---|
| 数据迁移 | `src-tauri/src/db.rs` | 编号化事务迁移、连接打开、外键开关 |
| IPC 模型 | `src-tauri/src/models.rs` | camelCase 序列化的 Event/Task/Note/AppSettings |
| 设置读取 | `src-tauri/src/settings.rs` | 从 settings 表读取 JSON 值为强类型 |
| 错误契约 | `src-tauri/src/error.rs` | `CommandError`，屏蔽内部细节 |
| 命令层 | `src-tauri/src/commands.rs`、`src-tauri/src/events.rs`、`src-tauri/src/tasks.rs` | 启动查询、日程范围查询及日程/任务事务 CRUD |
| 壁纸/托盘 | `src-tauri/src/wallpaper.rs`、`src-tauri/src/main.rs` | WorkerW、任务栏感知、托盘交互 |
| 仓储边界 | `src/data/` | `NowlyRepository` 接口、Tauri 实现、注入 Context |
| 启动装配 | `src/app/useAppBootstrap.ts`、`src/calendar/useEvents.ts`、`src/matrix/useTasks.ts` | 启动资源与日程/任务 Feature 独立加载、写入及重试 |
| 应用外壳 | `src/app/layout/DesktopShell.tsx`、`src/app/styles.css` | 单屏栅格与全部设计令牌 |
| 业务组件 | `src/calendar/`、`src/matrix/`、`src/notes/` | 日历、四象限、便签 |
| 弹窗 | `src/modals/` | 日程/任务/便签编辑弹窗 |

## Common Commands

```bash
npm test          # Vitest 单元/组件测试
npm run build     # tsc + vite build
npm run dev       # Vite 开发服务器（127.0.0.1:1420）
npx playwright test                                # 端到端（四组视口）
cargo test --manifest-path src-tauri/Cargo.toml    # Rust 测试
```

## Product Specs

- [Nowly 设计规格](./superpowers/specs/2026-07-23-nowly-design.md)
- [Nowly Windows 完整产品设计规格](./superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md)
- [Nowly 任务纵切设计规格](./superpowers/specs/2026-07-29-nowly-tasks-design.md)
- [Nowly 最终 UI/UX HTML 设计规格](./superpowers/specs/2026-07-29-nowly-final-uiux-html-design.md)
- [Nowly Good 设计系统原型重设计规格](./superpowers/specs/2026-07-29-nowly-good-design-system-prototype-redesign.md)
- [Good Custom Solid Checkbox 与 Radio 设计规格](./superpowers/specs/2026-07-29-good-custom-solid-checks-radios-design.md)
- [Good 离线单日期选择器设计规格](./superpowers/specs/2026-07-29-good-single-date-picker-design.md)
- [Good 离线时间选择器设计规格](./superpowers/specs/2026-07-29-good-offline-time-picker-design.md)
- [Good 离线 Select 设计规格](./superpowers/specs/2026-07-29-good-offline-select-design.md)

## Prototypes

- [Nowly 最终 UI/UX HTML 原型](./prototypes/nowly-final-uiux.html)

## Implementation Plans

- [Nowly Windows 完整产品实施路线图](./superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md)
- [Nowly 数据基础与空状态启动实施计划](./superpowers/plans/2026-07-29-nowly-data-foundation.md)
- [Nowly 日程纵切实施计划](./superpowers/plans/2026-07-29-nowly-events.md)
- [Nowly 任务纵切实施计划](./superpowers/plans/2026-07-29-nowly-tasks.md)
- [Nowly MVP Implementation Plan](./superpowers/plans/2026-07-23-nowly-mvp.md)
- [Nowly Final UI/UX HTML Implementation Plan](./superpowers/plans/2026-07-29-nowly-final-uiux-html.md)
- [Nowly Good 设计系统原型重设计实施计划](./superpowers/plans/2026-07-29-nowly-good-design-system-prototype-redesign.md)
- [Good Custom Solid Checkbox 与 Radio 实施计划](./superpowers/plans/2026-07-29-good-custom-solid-checks-radios.md)
- [Good 离线单日期选择器实施计划](./superpowers/plans/2026-07-29-good-single-date-picker.md)
- [Good 离线时间选择器实施计划](./superpowers/plans/2026-07-29-good-offline-time-picker.md)
- [Good 离线 Select 实施计划](./superpowers/plans/2026-07-29-good-offline-select.md)
