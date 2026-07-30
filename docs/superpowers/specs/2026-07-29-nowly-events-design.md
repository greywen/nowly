# Nowly 日程纵切设计规格

日期：2026-07-29

## 1. 目标与范围

本阶段交付 Nowly Windows 产品的第二个可独立验收纵向切片：从 React 月历交互，经类型化 Repository 和 Tauri Command，贯通到 SQLite 的日程月份查询、日期详情、创建、编辑和永久删除。

本规格继承并细化：

- `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`
- `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md`
- 根目录 `design.md`

冲突时，产品范围和业务规则以完整产品规格为准，视觉规则以 `design.md` 为准。

本阶段包括：

- 按月份范围查询日程；
- 上月、下月和今天导航；
- 日期详情及当天日程排序；
- 日程新建、编辑和永久删除；
- 日程表单可信校验；
- Good 离线单日期选择器、时间选择器和 Select 的生产 React 实现；
- 未保存更改确认和永久删除确认；
- 日程与已有任务的一对一事务关联；
- 保存、删除和关联变化后的模块刷新；
- 对应 Rust、React 和 Playwright 自动化测试。

本阶段不包括：

- 任务创建、编辑、删除或完成状态变更；
- 日期详情中的“新建任务”入口；
- 便签 CRUD；
- 设置持久化和窗口生命周期改造；
- Windows 自启动、单实例和显示器选择；
- 跨日事件、重复事件、提醒、导入导出或回收站。

## 2. 架构

采用独立 Calendar Feature 层，避免把月份状态和写操作继续堆入 `useAppBootstrap`、`App.tsx` 或通用 `commands.rs`。

```text
CalendarWidget / DateDetailDialog / EventDialog
                    │ 用户意图、受控草稿
                    ▼
               useEvents
                    │ typed repository
                    ▼
             NowlyRepository
                    │ Tauri invoke
                    ▼
        Rust event commands/service
                    │ transaction
                    ▼
                  SQLite
```

边界规则：

- SQLite 是持久业务数据的唯一事实来源；
- Widget 只展示数据并发出意图，不直接调用 Repository；
- Dialog 管理草稿、客户端校验、提交状态和局部错误；
- `useEvents` 管理显示月份、月份读取、过期响应隔离、CRUD 后刷新；
- `NowlyRepository` 暴露类型化读写方法；
- `src/data/tauri-nowly-repository.ts` 是唯一知道 Tauri 命令名的前端模块；
- Rust Command 只负责参数接收、调用日程业务层和序列化结果；
- 日程 SQL、可信校验和关联事务放在独立 Rust 日程模块；
- 阶段 1 的迁移、camelCase、`CommandError` 和模块状态契约保持不变。

## 3. 前端数据契约

### 3.1 实体和枚举

沿用 `CalendarEvent` 的 camelCase 字段：

```ts
type EventCategory = 'work' | 'important' | 'personal' | 'learning';
type EventColor = 'blue' | 'red' | 'green' | 'yellow';

type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  linkedTaskId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
```

固定中文标签：

| 分类值 | 标签 | 默认颜色 |
|---|---|---|
| `work` | 工作 | `blue` |
| `important` | 重要 | `red` |
| `personal` | 个人 | `green` |
| `learning` | 学习 | `yellow` |

分类与颜色默认对应，但允许用户独立选择；Rust 分别校验两个字段。

### 3.2 请求类型

```ts
type EventDraft = {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: EventCategory;
  color: EventColor;
  linkedTaskId: string | null;
  note: string;
};

type EventRange = {
  startAt: string;
  endAtExclusive: string;
};
```

Repository 增加：

```ts
listEventsInRange(range: EventRange): Promise<CalendarEvent[]>;
createEvent(draft: EventDraft): Promise<CalendarEvent>;
updateEvent(id: string, draft: EventDraft): Promise<CalendarEvent>;
deleteEvent(id: string): Promise<void>;
```

`listEvents()` 在 Calendar Feature 接管月份读取后退出生产启动路径；任务、便签和设置仍由既有启动装配加载。本阶段可在兼容迁移期间保留旧方法，但生产日历不得继续依赖全量事件读取。

## 4. 时间和查询语义

### 4.1 本地时间

首版不做时区换算。普通日程按本地分钟字符串保存：

```text
YYYY-MM-DDTHH:mm
```

普通日程必须满足：

- 开始和结束均包含日期与时间；
- 开始和结束属于同一日期；
- 结束时间不早于开始时间；
- 秒和时区后缀不进入持久化格式。

全天日程保存同一日期的显式边界：

```text
start_at = YYYY-MM-DDT00:00
end_at   = YYYY-MM-DDT23:59
```

界面不展示全天日程的时间。

### 4.2 月份范围

月份查询使用半开区间：

```text
[monthStart, nextMonthStart)
```

例如 2026 年 7 月：

```text
startAt        = 2026-07-01T00:00
endAtExclusive = 2026-08-01T00:00
```

查询条件按 `start_at >= startAt AND start_at < endAtExclusive` 执行。首版拒绝跨日事件，因此无需做范围重叠查询。结果按 `start_at ASC, end_at ASC, id ASC` 稳定排序。

日期详情从当前月份已加载事件中筛选，不额外新增数据库往返。若日期属于月历网格中的相邻月份，先切换到该日期所属月份并完成读取，再打开日期详情。

## 5. SQLite 迁移与关联完整性

新增迁移版本 5，不修改已发布的迁移 1–4。

迁移 5 通过 SQLite 表重建为日程和任务关联补齐可空外键：

- `events.linked_task_id REFERENCES tasks(id) ON DELETE SET NULL`；
- `tasks.linked_event_id REFERENCES events(id) ON DELETE SET NULL`；
- 保留全部已有列和数据；
- 保留 `CHECK` 约束；
- 重建 `(start_at, end_at)` 和任务排序索引；
- 重建两侧唯一部分索引；
- 在迁移事务中执行外键检查；
- 迁移失败回滚，不删除或覆盖用户数据库。

迁移现有不一致数据时采用保守规则：无法在另一表找到目标 ID 的关联字段写为 `NULL`；若历史数据违反一对一唯一性，按 `updated_at DESC, id ASC` 保留第一条关系，其余解除。迁移测试必须覆盖旧数据保留、悬空关系清理和重复关系清理。

## 6. Rust 日程业务

### 6.1 Command

新增并注册：

```text
list_events_in_range
create_event
update_event
delete_event
```

所有请求和响应使用 `#[serde(rename_all = "camelCase")]`。所有命令返回 `Result<T, CommandError>`。

Rust 生成：

- 日程 ID；
- `created_at`；
- `updated_at`。

ID 由 Rust 使用 UUID v4 生成并保存为小写连字符字符串；前端不得生成持久 ID。

### 6.2 可信校验

Rust 按以下顺序校验：

1. `title.trim()` 非空，成功保存时持久化 trim 后标题；
2. `startAt` 和 `endAt` 符合本地分钟格式；
3. 开始和结束属于同一天；
4. 结束不早于开始；
5. 全天日程输入规范化为该日 `00:00` 至 `23:59`；
6. `category` 属于 `work | important | personal | learning`；
7. `color` 属于 `blue | red | green | yellow`；
8. `linkedTaskId` 非空时目标任务存在；
9. 更新和删除的目标日程存在。

字段错误返回 `validation_error` 和稳定字段名：

```text
title
startAt
endAt
category
color
linkedTaskId
```

不存在实体返回 `not_found`。数据库锁、SQL 和文件错误映射为不泄漏内部信息的 `database_error`。

### 6.3 一对一关联事务

创建或更新日程时，在同一事务中：

1. 读取当前日程旧的 `linked_task_id`；
2. 若旧任务不再关联，将旧任务的 `linked_event_id` 清空；
3. 若新任务已关联另一日程，将另一日程的 `linked_task_id` 清空；
4. 将新任务的 `linked_event_id` 指向当前日程；
5. 将当前日程的 `linked_task_id` 指向新任务；
6. 更新所有受影响记录的 `updated_at`；
7. 提交前检查两侧关系一致。

这一定义允许用户在日程编辑中主动重新关联已有任务，不返回“已被占用”冲突。只有事务期间发现实体被并发删除或最终唯一约束无法满足时返回 `conflict`。

删除日程时，在同一事务中解除任务的 `linked_event_id` 后永久删除日程，不删除任务。

## 7. Calendar Feature 状态与数据流

`useEvents` 持有：

- 当前显示的 `year` 和 `monthIndex`；
- 当前月份事件资源状态；
- 当前请求序号或取消标识；
- `retryEvents`；
- `goToPreviousMonth`、`goToNextMonth`、`goToToday`；
- `createEvent`、`updateEvent`、`deleteEvent`；
- 与任务刷新协作的回调。

行为：

- 应用打开时读取当前月份；
- 切月立即显示静态加载文案，并保留旧数据但不将其渲染为新月份内容；
- 快速连续切月时，只有最新请求可以写入状态；
- 单次月份读取失败只影响日历模块；
- CRUD 成功后刷新当前月份；
- 保存的日程不在当前月份时，刷新仍以当前显示月份为准，不手工插入；
- 新旧 `linkedTaskId` 任一非空时刷新任务模块；
- CRUD 失败不进行乐观列表写入。

`useAppBootstrap` 继续负责任务、便签和设置。阶段完成时事件读取责任只能有一个生产入口，避免启动全量读取与月份读取并发覆盖。

## 8. 日历交互

### 8.1 月份导航

Header 操作：

- “上一个月”：切换到前一自然月；
- “下一个月”：切换到后一自然月；
- “今天”：切换到系统本地日期所在月份；
- “新建日程”：打开新建弹窗并预填系统本地今天。

跨年边界必须正确处理。

### 8.2 日期和日程入口

- 单击日期打开日期详情；
- 双击日期直接打开新建日程并预填该日期，不在双击序列中留下日期详情；
- 点击日程条目打开编辑弹窗，并阻止日期入口触发；
- 键盘激活日期等同单击；
- 日程条目自身可聚焦，Enter/Space 打开编辑。

当前 `button` 日期格内嵌 `role="button"` 日程条目的结构必须替换。实现使用合法、可访问且不会产生嵌套交互控件的 DOM；日期和日程均具有完整可访问名称。

月历每个日期最多展示前三条日程；超出时显示“另有 N 个”，激活后打开日期详情。

## 9. 日期详情弹窗

日期详情显示：

- 完整本地日期；
- 星期；
- 当天日程数量；
- 全天日程优先；
- 普通日程按开始时间、结束时间、ID 稳定排序；
- 每项的时间或“全天”、标题、分类标签和可选关联任务提示；
- 无日程时的静态空状态；
- “新建日程”操作。

本阶段不显示“新建任务”按钮和关联任务汇总区；这些在阶段 3 任务纵切接入。

从日期详情打开新建日程时预填详情日期。从日期详情打开某条日程编辑后，关闭编辑弹窗返回日期详情，并将焦点归还原日程条目；若保存或删除导致该条目消失，则焦点归还日期详情标题或“新建日程”按钮。

## 10. 日程弹窗

### 10.1 模式

新建和编辑共用受控 `EventDialog`：

- 新建标题为“新建日程”；
- 编辑标题为“编辑日程”；
- 新建模式不显示删除按钮；
- 编辑模式显示“删除日程”。

打开时复制实体或默认值为草稿，不直接修改主界面数据。

### 10.2 字段

表单包含：

- 日程标题；
- 全天事件 Checkbox；
- 开始日期；
- 结束日期；
- 非全天时的开始时间和结束时间；
- 分类 Select；
- 颜色 Radio 组；
- 可搜索关联任务 Select；
- 备注。

默认值：

- 标题为空；
- 全天关闭；
- 开始和结束日期为入口预填日期；
- 开始时间为下一有效 5 分钟刻度；
- 结束时间为开始后一小时，并限制在同一天；
- 分类为 `work`；
- 颜色为 `blue`；
- 无关联任务；
- 备注为空。

若当前时间后一小时会跨日，则开始时间使用 `22:55`，结束时间使用 `23:55`，确保默认草稿合法且不跨日。

开启全天时隐藏时间字段并将提交值规范化为日期边界；关闭全天时恢复本次弹窗中最近一次普通开始和结束时间。

### 10.3 离线控件

日期字段实现 `design.md` 规定的 Good 离线单日期选择器：

- 周一开始的 6×7、42 日网格；
- 前后月、今天、清除、点击外部和 Escape；
- 方向键、PageUp/PageDown、Enter/Space；
- 正确 ARIA 和焦点归还；
- 与时间面板互斥；
- 不使用 `type="date"`、CDN 或第三方运行时面板。

时间字段实现 Good 离线时间选择器：

- 24 小时制；
- 分钟步长 5；
- 小时和分钟 spinbutton；
- 快捷值、清除和“现在”；
- 完整键盘操作和 ARIA；
- 不覆盖业务弹窗 Header，不越出弹窗左右边界；
- 不使用 `type="time"`、CDN 或第三方运行时面板。

Select 复用项目现有 `Select`。分类不可搜索，关联任务可搜索并提供“无关联”。Checkbox 和颜色 Radio 使用 `design.md` 的 Good Custom Solid 原生 input 结构。

## 11. 草稿、关闭与确认层

草稿脏状态通过规范化后的当前草稿与初始草稿比较：标题和备注保留用户输入用于脏检查，提交时仅 trim 标题；全天隐藏的时间不参与全天草稿的有效提交值比较。

关闭规则：

- 无修改时，取消、关闭按钮或 Escape 直接关闭；
- 有修改时，打开“放弃更改”确认；
- 确认层文案明确未保存内容将丢失；
- Escape 只关闭最上层确认层并回到日程弹窗；
- 确认放弃后关闭日程弹窗并归还入口焦点。

保存期间：

- 禁用保存、删除、取消和重复提交；
- 保存按钮静态显示“正在保存”；
- 不显示 Spinner、进度动画或 Skeleton；
- 成功后关闭日程弹窗并刷新；
- 失败后恢复操作能力，保留草稿和弹窗。

## 12. 永久删除

编辑弹窗的“删除日程”打开独立确认层：

```text
永久删除“日程标题”？

删除后无法恢复。
若存在关联，只解除关联，不删除关联任务。

[取消] [永久删除]
```

确认层位于业务弹窗之上并拥有独立焦点陷阱。背景业务弹窗不可聚焦。Escape 只关闭确认层并将焦点归还“删除日程”。

删除期间禁用两项操作，危险按钮静态显示“正在删除”。删除成功后关闭确认层和业务弹窗并刷新当前月份；有关联时同时刷新任务。删除失败保留确认层并在操作区上方显示稳定错误。

## 13. 前端校验与错误呈现

前端在提交前执行与 Rust 一致的可判定校验：

- 标题 trim 后非空；
- 日期必填；
- 开始和结束同日；
- 非全天时间必填；
- 结束不早于开始；
- 分类和颜色属于固定选项。

字段错误显示在字段下方，并通过 `aria-describedby` 关联。Rust 返回的 `validation_error.field` 映射到相同字段。`linkedTaskId` 错误显示在关联任务字段下。

`conflict`、`database_error` 和无字段业务错误显示在弹窗 Footer 操作区上方并使用 `role="alert"`。界面不得显示 SQL、数据库路径、Rust 调用栈或原始系统错误。

月份读取错误继续使用日历模块的 `status: 'error'`、稳定文案和重试入口，不阻断任务和便签。

## 14. 弹窗层级与无障碍

Overlay 层级从低到高：

1. 日期详情；
2. 日程弹窗；
3. 日期或时间 Popover；
4. 放弃更改或永久删除确认。

同一时刻只有最上层浮层响应 Escape 和键盘焦点。所有 Dialog 使用 `role="dialog"`、`aria-modal="true"` 和可访问标题。关闭后按入口链路归还焦点。

其他要求：

- 图标统一使用 `lucide-react`；
- 图标按钮有可访问名称；
- 日期使用完整日期名称；
- 日程可访问名称包含时间或“全天”、标题和分类；
- 分类和颜色状态不只依赖颜色；
- 所有键盘焦点使用统一青绿色焦点环；
- 不存在无效嵌套交互元素。

## 15. 视觉约束

所有新增和修改 UI 严格遵循根目录 `design.md`：

- 主色 `#4FC9DA`，禁止旧 `#009EF7` 蓝色体系；
- 暖白、米灰背景和统一暖灰文字；
- 默认 `15.2px` 圆角；
- 普通卡片无阴影，弹窗使用规定最高层阴影；
- Header、Body、Footer 对齐规定内边距；
- 字号只使用设计规范语义层级；
- 页面保持 `100vw × 100vh` 且无 document 级滚动；
- 弹窗 Body 和业务列表可内部滚动；
- 不存在 transition、animation、smooth scrolling、Spinner 或 Skeleton；
- 不使用 Emoji、手写业务 SVG 或浏览器原生日期、时间、Select 面板。

本阶段同时将日程弹窗涉及的旧原型样式迁移到 `src/app/styles.css` 的权威 Token 和语义类名。不得顺带重构便签弹窗的阶段 4 遗留样式。

## 16. 测试策略

所有生产行为严格执行 Red-Green-Refactor。

### 16.1 Rust

覆盖：

- 迁移 5 顺序、幂等和旧数据保留；
- 悬空及重复关联清理；
- 外键和唯一部分索引；
- 月份半开区间查询和稳定排序；
- 创建、更新和永久删除；
- 标题、格式、同日、时间顺序、分类和颜色校验；
- 任务不存在；
- 建立、解除和重新关联时双向一致；
- 删除日程只解除任务关联；
- 更新和删除不存在实体；
- 数据库错误稳定映射且不泄漏内部信息。

测试使用内存 SQLite 或独立临时数据库，不访问用户数据。

### 16.2 React/Vitest

覆盖：

- 启动读取当前月份；
- 上月、下月、今天及跨年导航；
- 快速切月忽略过期响应；
- 月份错误和重试；
- 单击日期、双击日期和点击日程的独立行为；
- 合法 DOM 和键盘激活；
- 日期详情排序、空状态和“另有 N 个”；
- 各入口预填；
- 新建和编辑受控草稿；
- 全天切换和普通时间恢复；
- 客户端校验与服务端字段错误；
- 保存失败保留草稿；
- 关联变化刷新任务；
- 未保存更改确认；
- 永久删除成功和失败；
- 日期、时间和 Select 的键盘及 ARIA；
- 最上层 Escape、焦点陷阱和焦点归还。

### 16.3 Playwright

生产 React 页面通过 Tauri IPC 桩覆盖：

- 空月份创建日程；
- 月份导航发起正确范围查询；
- 日期详情进入编辑；
- 修改并保存；
- 永久删除；
- 日期、时间和 Select 键盘交互；
- 弹窗层级、Escape 和焦点；
- 1366×768、1920×1080、2560×1440、5120×1440 无页面级溢出；
- 无动画、旧蓝色 Token、浏览器原生日期时间面板和无效嵌套交互。

原型 HTML 测试继续作为视觉基准，但不能替代生产 React CRUD 路径测试。

## 17. 完成标准

阶段 2 只有同时满足以下条件才可关闭：

1. 月历只按当前月份范围读取 SQLite 日程；
2. 上月、下月和今天导航正确且无过期响应覆盖；
3. 日期详情排序、空状态和入口符合规格；
4. 日程可创建、编辑、永久删除并在重启后保留结果；
5. 日期、时间、分类、颜色和任务关联均经过前后端校验；
6. 日程与已有任务的双向关联在建立、解除、重新关联和删除后保持一致；
7. 保存失败保留草稿，删除失败保留确认层；
8. 未保存更改和永久删除均有正确确认与焦点行为；
9. 日期、时间和 Select 完全离线、可键盘操作且符合 `design.md`；
10. 生产 UI 无页面级滚动、无动效、无旧蓝色 Token 和无效嵌套交互；
11. `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npx playwright test` 和 `git diff --check` 全部通过；
12. 阶段代码审查完成后，才编写阶段 3 任务纵切详细计划。
