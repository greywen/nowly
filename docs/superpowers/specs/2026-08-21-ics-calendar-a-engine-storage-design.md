# Spec A｜ICS 日历引擎与存储

> 本 spec 是「ICS 日历彻底革新」三份子项目中的第一份，也是 B、C 的地基。
> 总览与开发进度见 `2026-08-21-ics-calendar-overview.md`。

## 目标

把 Nowly 日历的**时间/时区模型**与**重复规则引擎**彻底重做，完全对齐 RFC 5545
（iCalendar / ICS）国际标准。完成后，Nowly 内部的日历数据模型与 Google 日历、Apple
日历、Outlook 使用的模型同构，为后续的完整 RRULE 编辑 UI（Spec B）与日历订阅（Spec C）
打下地基。

本项目是一次**清空重建**：现有日历数据整体删除，按新标准重建 schema。不做旧数据迁移
兼容。

## 范围

本项目**做**：

- ICS 时间/时区数据模型：钟面+TZID / UTC / 浮动 / 全天四形态。
- 本地定时事件默认绑定**设备当前时区**（ICS 标准形态）。
- **完整 RFC 5545 RRULE 引擎**：解析、校验、展开，含全部 `BY*` 部分、`WKST`、
  `COUNT`/`UNTIL`、`BYSETPOS`。
- `RDATE`（附加日期）与 `EXDATE`（排除日期）。
- 展开的 DST 边界处理。
- 清空重建的数据库 schema 与迁移。
- 范围查询适配（浮动/全天走钟面比较，带时区走 UTC 缓存比较）。
- 提醒触发时刻按时区正确计算。
- 前端 `CalendarEvent` 数据模型适配（新增时区字段，钟点按设备时区下发）。

本项目**不做**（属于 B、C）：

- 让用户在编辑弹窗里创建复杂 RRULE 的完整 UI（Spec B）。本项目的编辑 UI 维持现有
  能力水平（简单的频率/间隔/星期/结束条件），复杂规则仅要求引擎能**存储、展开、往返
  序列化**，即订阅进来或已存在的复杂规则能正确渲染，但本地暂不提供创建它们的完整表单。
- 日历订阅（Spec C）。

## ICS 时间/时区数据模型

四种时间形态，与 RFC 5545 对齐：

- **定时事件（带时区）** = 钟面时间 + 具名 IANA 时区（`DTSTART;TZID=Asia/Shanghai`）。
  绝对时刻锚定，跨时区显示为对应当地钟点。
- **定时事件（UTC）** = 以 `Z` 结尾的绝对时刻（`DTSTART:20260803T020000Z`）。等价于带
  时区，内部统一按「钟面 + 时区」表示，时区记为 `UTC`。
- **浮动事件** = 只有钟面时间、无时区（`DTSTART:20260803T100000`）。在任何时区都按本机
  时区显示同一钟点。
- **全天事件** = 只有日期（`DTSTART;VALUE=DATE:20260803`）。时区无关，按日期浮动。

本地新建行为（ICS 标准默认）：

- **定时事件默认绑定设备当前时区**：在上海创建即写入 `start_tz = Asia/Shanghai`，存为
  「绝对时刻 + 时区」。无需时区选择器——自动取设备当前时区。将来手动改时区（Spec B）是
  纯 UI 增量，不动存储模型。
- **全天事件**为浮动（无时区），符合 ICS 惯例。

显示层跟随设备当前时区：机器时区变化时，带时区事件的显示钟点随之换算（绝对时刻不变），
浮动/全天事件的钟面/日期不变。显示时区覆盖开关（Apple 式）不在本项目，加它不破坏模型。

## 存储模型

真值语义永远是「钟面时间 + 时区 + 重复规则」，UTC 列仅为查询/索引缓存。

### events 表（重建）

保留现有字段（`id`、`title`、`all_day`、`category`、`color`、`linked_task_id`、`note`、
`reminders`、`created_at`、`updated_at`），时间与重复相关字段按下述重建：

- `start_at TEXT` / `end_at TEXT`：钟面时间（`%Y-%m-%dT%H:%M`，全天为 `%Y-%m-%d`）。
- `start_tz TEXT` / `end_tz TEXT`：具名 IANA 时区；`NULL` 表示浮动/全天。
- `start_utc TEXT` / `end_utc TEXT`：预计算 UTC 瞬时点缓存（`%Y-%m-%dT%H:%MZ`），**仅带
  时区事件有值**，由钟面+时区经 `chrono-tz` 换算得出，写入路径负责维护一致。
- `rrule TEXT`：RFC 5545 RRULE 串（如 `FREQ=MONTHLY;BYDAY=3TU;COUNT=12`），`NULL` 表示
  单次事件。**取代**现有的 `recurrence_freq`/`recurrence_interval`/`recurrence_by_day`/
  `recurrence_until`/`recurrence_count` 分列——改为存标准 RRULE 串，保证与 ICS 无损往返。
- `recurrence_final_at TEXT`：由 RRULE + dtstart 归一化算出的绝对上界（UTC 或钟面），供
  范围预筛用。`NULL` 表示无限系列或单次事件。
- `rdate TEXT`：JSON 数组，附加的单次发生时刻（RFC 5545 `RDATE`），钟面时间串。`NULL`/空
  数组表示无。
- `exdate TEXT`：JSON 数组，排除的发生时刻（RFC 5545 `EXDATE`），钟面时间串。`NULL`/空
  数组表示无。

### event_exceptions 表（保留并扩展语义）

现有 override/excluded 机制对应 ICS 的 `RECURRENCE-ID` 覆盖与 `EXDATE` 排除，保留。
override 的 `start_at`/`end_at` 继承所属系列的 `start_tz`/`end_tz`，不单独存时区。

`EXDATE`（series 级排除，来自 ICS 或本地）与 `event_exceptions` 的 `excluded`（单实例
排除）语义合并规则：展开时先由 RRULE 生成候选 → 并入 `rdate` → 减去 `exdate` → 减去
`excluded` 例外 → 应用 `overridden` 例外覆盖。顺序固定，避免二义。

### reminder_dispatches 表（重建）

去重键 `(event_id, occurrence_start_at, offset_minutes)` 不变；`occurrence_start_at` 仍是
系列时区下的钟面 slot。

### 索引

```sql
CREATE INDEX idx_events_range ON events(start_at, end_at);          -- 浮动/全天钟面范围
CREATE INDEX idx_events_start_utc ON events(start_utc)              -- 带时区 UTC 范围
  WHERE start_utc IS NOT NULL;
CREATE UNIQUE INDEX idx_events_linked_task ON events(linked_task_id)
  WHERE linked_task_id IS NOT NULL;
```

## 数据迁移（清空重建）

新增一个迁移（编号顺延现有序列）：

1. `DROP TABLE IF EXISTS reminder_dispatches;`
2. `DROP TABLE IF EXISTS event_exceptions;`
3. `DROP TABLE IF EXISTS events;`
4. 按上述新 schema 重建三表与索引。

**这是不可逆的破坏性操作**：所有现有日程、改期、提醒记录被清空。已与需求方确认采用
彻底革新、不保留旧数据。任务表（`tasks`）不受影响，但 `linked_event_id` 指向的事件已被
清空，迁移中需一并把 `tasks.linked_event_id` 置 `NULL`（`UPDATE tasks SET
linked_event_id = NULL;`）以免留下悬空引用。

## 依赖

Rust 侧新增：

- `chrono-tz`：IANA 时区数据库，钟面↔UTC↔本机换算。
- `rrule`（推荐）：成熟的 RFC 5545 RRULE 解析与展开库，覆盖全部 `BY*`/`WKST`/`BYSETPOS`
  与 DST 语义。**推荐采用而非自研**——RRULE 展开是日历标准里最易错的部分，各 `BY` 组合、
  `BYSETPOS`、闰年月末边界的正确实现代价极高，成熟库能显著降低缺陷风险。

> 待确认：是否接受引入 `rrule` crate。若坚持自研，本项目工程量与风险显著上升，需单独
> 评估。下文按「采用 `rrule` crate」撰写。

## 完整 RRULE 引擎

- **解析/序列化**：`rrule` crate 负责 RRULE 串 ↔ 规则结构的往返。存储层存标准串，读出即
  解析，保证与 ICS 无损。
- **展开**：给定 dtstart（钟面+时区）、rrule、rdate、exdate 与查询窗口，`rrule` crate 在
  具名时区下展开出落窗的绝对时刻列表。每个 slot 再换算为 UTC 缓存与本机显示时间。
- **支持的 RRULE 部分**：`FREQ`（`DAILY`/`WEEKLY`/`MONTHLY`/`YEARLY`，以及库支持的
  `HOURLY` 等）、`INTERVAL`、`BYSECOND`/`BYMINUTE`/`BYHOUR`/`BYDAY`（含 `2MO`/`-1FR`
  序数）/`BYMONTHDAY`/`BYYEARDAY`/`BYWEEKNO`/`BYMONTH`/`BYSETPOS`、`WKST`、`COUNT`/
  `UNTIL`。
- **上限防御**：保留现有 `MAX_SERIES_OCCURRENCES` / `MAX_WINDOW_OCCURRENCES` 精神，对展开
  数量设上限，防止超大/无限系列耗尽内存。
- **RDATE/EXDATE**：按前述合并顺序并入/排除。

## DST 边界

遵循 RFC 5545 / `rrule` crate 语义：

- **钟面时间恒定**：夏令时切换前后「每周一 10:00」永远 10:00，变的是 UTC 偏移。
- **春季跳表不存在的钟面**：顺延到断层后有效时刻（`chrono` `LocalResult` 取 later）。
- **秋季回拨出现两次的钟面**：取第一次（earlier）。
- **浮动重复事件**：不换算，钟面在本机时区直接用。

以上语义须由测试锁定，确保与 `rrule` crate 的实际行为一致（若库默认行为不同，在换算层
统一到本规范）。

## 提醒

提醒触发时刻 = 该次事件 UTC 瞬时点 − 偏移：

- **带时区事件**：由钟面+时区算出 UTC，再减偏移。
- **浮动事件**：按本机当前时区解释钟面为瞬时点，再减偏移。

## 范围查询

日历以「设备当前时区的钟面窗口」发起查询。拆为两条谓词并集：

- **浮动/全天事件**（`start_tz IS NULL`）：钟面字符串与窗口比较，即现有 `list_in_range`
  逻辑，走 `idx_events_range`。
- **带时区事件**（`start_tz IS NOT NULL`）：窗口两端用设备时区换算成 UTC，用 `start_utc`
  与 `recurrence_final_at`（UTC）比较，走 `idx_events_start_utc`；命中后在系列时区展开
  slot，逐个换算判断落窗。

合并后按可比较的绝对时刻稳定排序（带时区用 UTC，浮动/全天用本机时区解释后的瞬时点），
再 `→ id → occurrence_start_at` 决胜。

## 前端

换算在后端完成，前端不引入时区库：

- **数据库列** `start_at`/`end_at`：事件自身时区的钟面时间。
- **下发字段** `CalendarEvent.startAt`/`endAt`：**设备当前时区的显示钟面**。带时区事件由
  后端读取路径换算后下发；浮动/全天二者相同。前端只展示，不做时区运算。
- **下发字段** `CalendarEvent.startTz`/`endTz`（`string | null`）：事件自身具名时区，
  浮动/全天为 `null`，用于详情标注（如「(北京时间)」），不参与月历钟点渲染。
- **下发字段** `CalendarEvent.rrule`（`string | null`）：标准 RRULE 串，供详情展示与
  Spec B 编辑 UI 使用。本项目前端只读展示，不提供复杂 RRULE 编辑表单。
- **重复实例身份** `occurrenceStartAt`：系列自身时区下的钟面 slot，不随设备时区换算——它
  是例外表身份键。
- **编辑弹窗**：本项目维持现有编辑能力（简单频率/间隔/星期/结束条件），本地定时事件写入
  设备时区、全天为浮动。复杂 RRULE 的创建 UI 属 Spec B。

## 兼容性与回归

- 清空重建后无旧数据，不存在旧数据兼容问题。
- 现有 `events.rs`/`recurrence.rs` 的测试大量依赖旧的分列重复模型与 naive 时间；本项目
  改动面大，这些测试需按新模型重写而非简单保留。重写后须覆盖等价的行为（单次/简单重复/
  例外/范围查询）。
- UTC 缓存列由写入路径统一维护：任何创建/更新带时区事件的路径都必须同步重算
  `start_utc`/`end_utc` 与 `recurrence_final_at`。

## 测试

Rust 单元测试：

- 时区换算往返（含非整点偏移时区，如 `Asia/Kathmandu` +5:45）。
- DST 春跳顺延 later、秋回取 earlier 的展开结果。
- 带时区重复系列跨 DST：钟面恒定、UTC 偏移在切换点前后不同。
- 完整 RRULE：`BYDAY=3TU`（每月第 3 个周二）、`BYDAY=-1FR`（每月最后一个周五）、
  `BYSETPOS`、`BYMONTHDAY`、`BYMONTH`+`BYDAY` 组合、`WKST` 对 weekly 的影响、`COUNT` 与
  `UNTIL`。
- `RDATE` 并入、`EXDATE` 排除、与 `excluded`/`overridden` 例外的合并顺序。
- RRULE 串往返序列化无损。
- 清空重建迁移：三表重建、`tasks.linked_event_id` 置空。
- 范围查询：带时区事件按设备时区窗口正确落窗/出窗（含跨时区临界事件）。
- 提醒触发时刻：带时区与浮动分别算出正确 UTC 瞬时点。
- 上限防御：超大/无限系列展开被上限截断。

前端组件测试：

- 带时区事件在给定设备时区下显示正确钟点。
- 浮动/全天显示钟面不变。
- `CalendarEvent` 新字段（`startTz`/`endTz`/`rrule`）序列化/反序列化。
