# ICS 日历彻底革新 · 总览与开发进度

> 把 Nowly 日历彻底重做，完全对齐 RFC 5545（iCalendar / ICS）国际标准。
> 本文件是三份子项目 spec 的总入口，并跟踪整体开发进度。

## 背景与目标

Nowly 原有日历使用「不带时区的钟面时间」与一套简化的自研重复模型，无法无损表达
Google 日历 / Apple 日历 / Outlook 的事件（尤其是带时区的事件与复杂重复规则），因此也
无法可靠地做日历订阅。

本次革新的最终目标是：让 Nowly 的日历数据模型与 RFC 5545 同构——per-event 时区、完整
RRULE、RDATE/EXDATE、DST 正确处理——并在此地基上实现日历订阅。采用**清空重建**，不保留
旧数据。

## 子项目拆分

整个革新拆成三份独立 spec，各自有 spec → 实现计划 → 实现的完整周期。依赖关系：A 是地基，
B 与 C 都建在 A 之上，B 与 C 之间无依赖（谁先做都行）。

| 子项目 | 文件 | 内容 | 依赖 |
|---|---|---|---|
| **A** ICS 引擎与存储 | `2026-08-21-ics-calendar-a-engine-storage-design.md` | 时区模型、设备时区绑定、完整 RRULE 引擎、RDATE/EXDATE、DST、清空重建、范围查询、提醒、前端数据模型 | 无（地基） |
| **B** 完整 RRULE 编辑 UI | `2026-08-21-ics-calendar-b-rrule-editor-design.md` | 让用户创建复杂 RRULE 的编辑器、本地事件时区选择器 | A |
| **C** 日历订阅 | `2026-08-21-ics-calendar-c-subscription-design.md` | 订阅 Google/Apple/Outlook/Teams 的 .ics，只读展示 | A |

## 整体数据模型（对齐 ICS）

三份 spec 共享同一套时间/时区模型，定义在 Spec A，摘要如下：

- **定时事件（带时区）** = 钟面时间 + 具名 IANA 时区，绝对时刻锚定，跨时区显示对应当地钟点。
- **定时事件（UTC）** = 以 `Z` 结尾的绝对时刻，内部统一按「钟面 + `UTC` 时区」表示。
- **浮动事件** = 只有钟面时间、无时区，任何时区都显示同一钟点。
- **全天事件** = 只有日期，按日期浮动。
- **重复** = 标准 RFC 5545 RRULE 串 + RDATE/EXDATE，在系列时区下展开、逐 slot 换算。
- **本地新建**：定时事件默认绑设备当前时区，全天为浮动。

## 开发进度

状态图例：⬜ 未开始 · 🟡 进行中 · ✅ 已完成

### Spec A｜ICS 引擎与存储

实现计划分五份（对应里程碑）：
- Part 1 → `plans/2026-08-21-ics-calendar-a1-timezone-layer.md`（依赖 + 时区换算层，对应 A2 依赖 / A4）
- Part 2 → `plans/2026-08-21-ics-calendar-a2-rrule-engine.md`（RRULE 引擎，对应 A5）
- Part 3a → `plans/2026-08-21-ics-calendar-a3a-schema-models-bridge.md`（清空重建 schema + models + Recurrence↔RRULE 桥，对应 A3）
- Part 3b → `plans/2026-08-21-ics-calendar-a3b-read-write-range.md`（读写 + 范围查询，对应 A6）
- Part 4 → `plans/2026-08-21-ics-calendar-a4-reminders-frontend.md`（提醒时区适配 + 前端，对应 A7 / A8）

| # | 里程碑 | 状态 |
|---|---|---|
| A0 | spec 定稿并通过 review | ✅ |
| A1 | 实现计划（writing-plans）产出 | ✅ |
| A2 | 引入 `chrono-tz` / `rrule` 依赖 | ✅ |
| A3 | 清空重建迁移 + 新 schema + 索引 | ⬜ |
| A4 | 时区换算层（钟面↔UTC↔本机，DST 边界） | ✅ |
| A5 | 完整 RRULE 解析/展开/往返 + RDATE/EXDATE | ✅ |
| A6 | 范围查询适配（浮动钟面 / 带时区 UTC 两路） | ⬜ |
| A7 | 提醒触发时刻按时区计算 | ⬜ |
| A8 | 前端 `CalendarEvent` 模型与渲染适配 | ⬜ |
| A9 | 测试全绿（Rust + 前端 + 回归重写） | ⬜ |

### Spec B｜完整 RRULE 编辑 UI

| # | 里程碑 | 状态 |
|---|---|---|
| B0 | spec 定稿（交互细化）并通过 review | ⬜ |
| B1 | 实现计划产出 | ⬜ |
| B2 | 高级 RRULE 编辑器（序数星期/按月第几天/BYSETPOS/WKST 等） | ⬜ |
| B3 | 规则人类可读摘要（中/英） | ⬜ |
| B4 | 本地事件时区选择器（可搜索 IANA） | ⬜ |
| B5 | 与 RRULE 串双向绑定 + 测试全绿 | ⬜ |

### Spec C｜日历订阅

| # | 里程碑 | 状态 |
|---|---|---|
| C0 | spec 定稿并通过 review | ⬜ |
| C1 | 实现计划产出 | ⬜ |
| C2 | 订阅存储（subscriptions / external_events 表） | ⬜ |
| C3 | .ics 拉取（复用 net.rs 安全基线，webcal→https） | ⬜ |
| C4 | .ics 解析 + 用 Spec A 引擎展开为只读实例 | ⬜ |
| C5 | 刷新调度（启动 + 定时 15 分钟可调 1–30 + 手动） | ⬜ |
| C6 | Settings「日历订阅」管理界面（tab + 列表，最多 3 源） | ⬜ |
| C7 | 月历来源徽标 + 每源固定色 + 只读详情弹窗 | ⬜ |
| C8 | 拉取失败保留旧数据 + 状态标记 + 测试全绿 | ⬜ |

## 已确认的关键决策

跨子项目的决策集中记录于此，各子项目 spec 引用：

- **时区模型**：完整 per-event（钟面+TZID / UTC / 浮动 / 全天），显示跟随设备时区。
- **本地新建**：定时事件默认绑设备当前时区（ICS 标准），全天为浮动。
- **重复规则**：完整 RFC 5545 RRULE + RDATE/EXDATE，推荐采用 `rrule` crate 而非自研。
- **旧数据**：不保留，清空重建。`tasks.linked_event_id` 一并置空。
- **显示时区覆盖开关**：不做（power-user 功能，将来加不破坏模型）。

### 订阅（Spec C）专项决策

- 刷新：启动 + 定时 + 手动；定时默认 15 分钟，可设 1–30 分钟。
- 月历样式：实心竖条主体 + 右侧来源徽标。
- 颜色：每源一个固定色，添加订阅时选定。
- 展开窗口：当前月前后各 6 个月（约 13 个月）。
- 管理界面：Settings 内「日历订阅」，看板设置式 tab + 列表。
- 交互：订阅事件可点开只读详情；不可编辑/删除/关联任务；移除整源才消失。
- 订阅源上限：最多 3 个。
- 拉取失败：保留上次成功数据，列表标记失败状态与原因，不弹全局报错。
- URL 安全：复用 `net.rs` 基线；`webcal://` 自动转 `https://`。
