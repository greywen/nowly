# Spec C｜日历订阅（iCal URL 只读）

> 本 spec 是「ICS 日历彻底革新」三份子项目中的第三份，建在 Spec A 之上。
> 总览与开发进度见 `2026-08-21-ics-calendar-overview.md`。
> **前置依赖：Spec A 必须先落地**（引擎能解析/展开完整 RRULE、支持时区模型）。
> 不依赖 Spec B（订阅事件只读，不经过本地编辑 UI）。

## 目标

让用户把苹果 / 谷歌 / Outlook / Teams 等平台的日历，通过其导出的 iCalendar（`.ics` /
`webcal://`）订阅链接，只读地同步进 Nowly 日历一起展示。第一版只做「只读订阅」，不做
双向写回。

四家平台全部支持导出/发布 `.ics` 订阅链接（Google 的 secret iCal 地址、Outlook 的
publish calendar、iCloud 的公开共享日历、Teams 会议本质是 Outlook 日历事件），因此一套
iCal 订阅即可覆盖四家。

## 范围

本项目**做**：

- 订阅源管理：添加 / 编辑 / 删除订阅（名称、URL、颜色），最多 **3 个**。
- 定时拉取 + 解析 + 展开 + 只读展示。
- 拉取调度：启动时 + 定时 + 手动。定时间隔默认 **15 分钟**，可设 **1–30 分钟**。
- 订阅事件在月历上的呈现：实心竖条主体 + 右侧**来源徽标**区分来源；颜色取**订阅源固定
  颜色**（添加时选定）。
- 订阅事件只读详情弹窗（标题、时间、地点、描述、来源）。
- 拉取失败处理：保留上次成功数据继续显示，在订阅列表标记失败状态与原因，不弹全局报错。
- URL 安全：复用现有 `net.rs` 基线（强制 https、拦截内网 IP、禁止重定向、限制大小、
  超时）；`webcal://` 自动转 `https://`。

本项目**不做**：

- 双向同步 / 写回外部平台。
- 订阅事件的编辑 / 删除 / 关联任务（只读；移除整个订阅源才消失）。
- 原生 OAuth / Graph API / CalDAV 集成（未来增强，另立项目）。

## 数据模型

新增两张表，与本地事件表**隔离**，刷新时可整源替换而不误伤本地日程：

- `calendar_subscriptions`：`id`、`name`、`url`、`color`、`refresh_interval_minutes`、
  `last_synced_at`、`last_status`（ok / failed）、`last_error`、`created_at`、`updated_at`。
- `external_events`：`id`、`subscription_id`（外键，级联删除）、`uid`（ICS UID）、
  展开后的具体实例时间（`start_at` / `start_tz` / `start_utc` 等，对齐 Spec A 的时间模型）、
  `title`、`location`、`description`、`all_day`、`last_synced_at`。

订阅事件的重复：拉取时用 Spec A 的引擎，在窗口内（当前月前后各 6 个月，约 13 个月）
**展开成具体只读实例**存入 `external_events`。滚动到远期时下次刷新自然覆盖。

## 时区

订阅事件自带具名时区（ICS 的 `TZID` / UTC / 浮动 / 全天），**无损映射**到 Spec A 建立的
per-event 时区模型。展开与显示复用 Spec A 的换算逻辑。

## 管理界面

Settings 内新增「日历订阅」分区，采用看板字段管理（`KanbanFieldManagerDialog`）那种
**tab + 列表管理**形式：列表列出各订阅（名称、颜色、上次刷新时间/状态），配「添加/编辑」
表单与删除。全部复用 `design.md` 规范，无动效。

## 拉取与调度

- 启动时拉一次；之后按各源 `refresh_interval_minutes` 定时拉；列表提供手动「刷新」。
- 拉取走 `net.rs` 安全基线；`webcal://` → `https://`。
- 说明（写入用户可见文案或 README）：iCal 订阅源在服务端普遍有缓存，拉回内容的新鲜度
  取决于对方平台，非严格实时。

## 呈现与交互

- 月历：实心竖条 + 右侧来源徽标；颜色为订阅源固定色。
- 点击：打开只读详情弹窗；无编辑/删除/关联任务入口。
- 订阅事件不可被本地编辑逻辑改动；移除订阅源时其 `external_events` 级联删除。

## 测试

- 订阅 CRUD 与 3 个上限。
- ICS 解析：`VEVENT`、`TZID`、UTC、浮动、全天、`RRULE` / `RDATE` / `EXDATE`（复用 Spec A
  引擎）。
- 展开窗口正确性与刷新覆盖。
- 拉取失败保留旧数据 + 标记状态。
- URL 安全校验（复用 `net.rs`，含 `webcal://` 转换、内网拦截）。
- 月历呈现与只读详情弹窗组件测试。
- 时区映射：带 `TZID` 的订阅事件显示为设备时区对应钟点。
