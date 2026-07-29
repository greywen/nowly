# Nowly Windows 完整产品设计规格

日期：2026-07-29

## 1. 目标与范围

Nowly 首个正式版本仅支持 Windows 10/11。产品采用单主界面，将月历、四象限任务和便签整合为桌面壁纸型效率面板；所有查看详情、新增、编辑、删除和设置操作均通过弹窗完成。

本规格以 `docs/prototypes/nowly-final-uiux.html` 为页面结构和交互基准，以根目录 `design.md` 为最终视觉权威。原型与设计规范冲突时，颜色、字体、间距、圆角、边框、阴影和组件状态均遵循 `design.md`。

正式版本包括：

- 日程、任务、便签的完整 SQLite CRUD；
- 日程与任务的一对一可选关联；
- 设置持久化；
- WorkerW/Progman 壁纸嵌入和前台操作模式；
- 根据壁纸偏好决定关闭行为；
- 系统托盘、登录后静默启动和单实例；
- 单台目标显示器选择及断开回退；
- Windows 安装与实机验收。

首版不包括：

- 云同步或账号系统；
- 数据导入、导出或自动备份；
- 回收站和软删除；
- macOS/Linux 支持；
- 多显示器同时显示多个 Nowly 窗口；
- 开放插件系统；
- 跨日事件；
- 自动写入演示数据。

## 2. 实现策略

采用纵向功能切片。每个切片从 React 交互贯通到 Tauri Command 和 SQLite，并可独立测试、运行和验收。实现顺序为：

1. 数据基础与应用启动；
2. 日程完整链路；
3. 任务完整链路；
4. 便签完整链路；
5. 设置与窗口生命周期；
6. Windows 系统集成；
7. 综合验收与交付。

保留并扩展当前已经验证的 WorkerW、任务栏监听、托盘激活和窗口样式实现，不无关重写 Win32 逻辑。

## 3. 整体架构

```text
React
├─ AppBootstrap
├─ DesktopShell
├─ Calendar Feature
├─ Matrix Feature
├─ Notes Feature
├─ Settings Feature
├─ OverlayRoot
└─ Shared UI
       │
       │ typed repository / Tauri invoke
       ▼
Rust / Tauri
├─ Event Commands + Repository
├─ Task Commands + Repository
├─ Note Commands + Repository
├─ Settings Commands + Repository
├─ Window Lifecycle
├─ Monitor Service
├─ Startup Service
└─ Unified Error Model
       │
       ▼
SQLite
├─ schema_migrations
├─ events
├─ tasks
├─ notes
├─ settings
└─ widgets
```

### 3.1 前端边界

- SQLite 是持久业务数据的唯一事实来源。
- 正式运行路径不再依赖 `sample-data.ts`。
- 每项业务拥有自己的类型、Repository、状态 Hook 和组件。
- UI 不直接拼接 Tauri Command 名称或数据库字段。
- Widget 只负责展示和发出用户意图；Dialog 管理草稿、校验和提交状态；Feature Hook 管理读取、刷新和业务操作；Repository 封装 IPC。
- 当前月份、弹窗状态和未保存草稿是 React 临时状态，不写入数据库。
- 写操作成功后再刷新受影响的数据；日程或任务关联变化时同时刷新两者。
- Repository 接口可注入：正式构建使用 Tauri Repository，Vitest 使用内存实现。

### 3.2 Rust 边界

- Command 只接收参数、调用业务/数据层并返回序列化结果。
- SQL 按日程、任务、便签和设置拆分，不继续集中堆积于单个 Command 文件。
- Rust 生成 ID、`created_at` 和 `updated_at`。
- 所有写操作和关联更新使用事务。
- 前端提供即时校验，Rust 再执行可信校验。
- Windows 原生窗口逻辑与业务 CRUD 隔离。

## 4. SQLite 与迁移

### 4.1 版本化迁移

新增：

```text
schema_migrations
├─ version INTEGER PRIMARY KEY
└─ applied_at TEXT NOT NULL
```

应用启动时按版本顺序，在事务中执行所有未应用迁移。迁移可重复检查但不可重复应用。迁移失败时回滚当前迁移，保留原数据库，不自动删除、重建或覆盖用户数据；应用进入不可编辑的静态错误状态，并保留退出能力。

SQLite 连接启用 `PRAGMA foreign_keys = ON`。初始迁移建立核心表、约束、索引和默认设置，但不写入任何日程、任务或便签示例数据。

### 4.2 events

```text
events
├─ id TEXT PRIMARY KEY
├─ title TEXT NOT NULL
├─ start_at TEXT NOT NULL
├─ end_at TEXT NOT NULL
├─ all_day INTEGER NOT NULL CHECK (all_day IN (0, 1))
├─ category TEXT NOT NULL
├─ color TEXT NOT NULL
├─ linked_task_id TEXT NULL
├─ note TEXT NOT NULL DEFAULT ''
├─ created_at TEXT NOT NULL
└─ updated_at TEXT NOT NULL
```

规则：

- 标题去除首尾空白后不能为空；
- 普通日程按本地 ISO 8601 字符串保存到分钟；
- 全天日程保存日期边界，界面不展示时间；
- 结束时间不得早于开始时间；
- 首版不支持跨日事件；
- 分类和颜色使用固定、受验证的枚举；
- 建立 `(start_at, end_at)` 索引。

### 4.3 tasks

```text
tasks
├─ id TEXT PRIMARY KEY
├─ title TEXT NOT NULL
├─ quadrant TEXT NOT NULL
├─ due_at TEXT NULL
├─ priority INTEGER NOT NULL
├─ completed INTEGER NOT NULL CHECK (completed IN (0, 1))
├─ linked_event_id TEXT NULL
├─ note TEXT NOT NULL DEFAULT ''
├─ created_at TEXT NOT NULL
└─ updated_at TEXT NOT NULL
```

规则：

- 标题和四象限枚举必填；
- 优先级仅允许高、中、低；
- 截止时间首版按日期保存，可为空；
- 完成状态变更同步更新 `updated_at`；
- 已完成任务继续显示在所属象限，排在未完成任务之后；
- 同一完成状态下按截止日期升序，无截止日期排最后；
- 建立 `(quadrant, completed, due_at)` 索引。

### 4.4 notes

```text
notes
├─ id TEXT PRIMARY KEY
├─ title TEXT NOT NULL
├─ content TEXT NOT NULL DEFAULT ''
├─ color TEXT NOT NULL
├─ pinned INTEGER NOT NULL CHECK (pinned IN (0, 1))
├─ created_at TEXT NOT NULL
└─ updated_at TEXT NOT NULL
```

规则：

- 标题去除首尾空白后不能为空；
- 内容允许为空；
- 颜色仅允许 `yellow`、`blue`、`green`、`purple`；
- 排序为置顶优先，其次 `updated_at` 倒序；
- 建立 `(pinned, updated_at)` 索引。

### 4.5 settings

```text
settings
├─ key TEXT PRIMARY KEY
├─ value TEXT NOT NULL
└─ updated_at TEXT NOT NULL
```

设置值序列化为 JSON。Rust 向前端暴露完整、类型化的 `AppSettings`，前端不能任意读写键值。首版设置包括：

- `wallpaper_enabled`；
- `launch_at_login`；
- `target_monitor_id`；
- `density`；
- `week_start`；
- `date_format`；
- `show_weekends`；
- `calendar_enabled`；
- `matrix_enabled`；
- `notes_enabled`。

### 4.6 日程与任务关联

首版使用一对一可选关联：一个日程最多关联一个任务，一个任务最多关联一个日程。

- 关联字段使用可空外键和 `ON DELETE SET NULL`；
- 关联列建立唯一部分索引；
- 建立、变更或解除关联时在同一事务中同步两侧；
- 重新关联前先解除双方旧关联；
- 删除日程只解除任务的 `linked_event_id`；
- 删除任务只解除日程的 `linked_task_id`；
- 不级联删除另一业务对象。

## 5. 应用初始化和数据状态

应用启动后并行读取当前月份日程、全部任务、便签摘要、应用设置和当前窗口模式。

- 加载时只使用静态“正在读取本地数据”文案，不使用 Spinner、Skeleton 或闪烁效果；
- 单个业务模块读取失败时只显示该模块错误和“重试”，不阻断其他模块；
- 设置或数据库整体初始化失败时显示不可编辑的全局错误界面；
- 首次启动数据库为空，不插入原型演示数据。

空状态：

- 日历正常显示当前月份，摘要为“本月暂无日程”，保留“新建日程”；
- 四象限始终显示，每个空象限显示“暂无任务”，保留新增入口；
- 便签显示“还没有便签”和新建入口，不使用大面积插画。

## 6. 日程业务

入口：

- 单击日期打开日期详情；
- 双击日期打开新建日程并预填日期；
- 点击日程色块打开编辑弹窗；
- 月历 Header“新建日程”默认预填今天；
- 日期详情“新建日程”预填详情日期。

表单规则：

- 标题和日期必填；
- 非全天日程的开始、结束时间必填；
- 结束不得早于开始；
- 开始和结束必须属于同一天；
- 保存成功后关闭弹窗，并刷新当前月日程和可能关联的任务；
- 保存失败时保留草稿并显示明确错误。

日期详情排序为全天事件优先，随后按开始时间升序。

## 7. 任务业务

入口：

- 四象限 Header 新增按钮；
- 日期详情“新建任务”；
- 点击任务标题编辑；
- Checkbox 直接切换完成状态。

规则：

- 标题和象限必填，截止日期可空；
- 从日期详情创建时默认截止日期为该日期；
- Checkbox 更新失败时恢复原状态并显示模块错误；
- 保存后刷新任务；存在关联时同时刷新日历。

## 8. 便签业务

入口：

- 便签 Header 新增按钮；
- 点击便签卡片编辑；
- “查看全部便签”打开管理弹窗，不跳转页面。

规则：

- 标题必填，内容可空；
- 提供四种固定颜色；
- 支持置顶；
- 主界面按容器高度展示摘要，完整列表在弹窗内部滚动；
- 保存后按置顶和更新时间重新排序。

## 9. 表单、删除和错误处理

### 9.1 草稿与提交

- 编辑弹窗打开时复制实体数据，不直接修改主界面状态；
- 取消或 Escape 丢弃未修改草稿；
- 草稿发生变化后关闭，先显示“放弃更改”确认；
- 保存期间禁用保存、删除和重复提交，按钮静态显示“正在保存”；
- 日期和时间字段使用符合 `design.md` 的离线选择器；
- Select 使用项目现有 Good 离线 Select，不使用浏览器原生下拉面板。

### 9.2 永久删除

日程、任务和便签均永久删除，不提供撤销或回收站。编辑弹窗中的删除按钮先打开二次确认：

```text
永久删除“对象标题”？

删除后无法恢复。
若存在关联，只解除关联，不删除关联对象。

[取消] [永久删除]
```

确认对话框位于业务弹窗之上，拥有独立焦点陷阱。Escape 仅关闭确认框并返回原弹窗。删除成功后关闭两层弹窗；失败时保留确认框并显示错误。

### 9.3 统一错误

Rust Commands 返回：

```text
code
message
field?
```

错误代码包括：

- `validation_error`；
- `not_found`；
- `conflict`；
- `database_error`；
- `system_error`。

字段错误显示于对应字段下并通过 `aria-describedby` 关联。普通业务错误显示在弹窗操作区上方。设置失败时不关闭弹窗，也不展示虚假成功状态。UI 不显示 SQL、文件路径或调用栈，详细信息只写入 Rust 日志。

## 10. Windows 窗口生命周期

### 10.1 权威状态

Rust 维护：

```text
WindowMode
├─ Foreground
├─ Wallpaper
└─ HiddenToTray
```

前端订阅 `window-mode-changed`，不在原生操作成功前自行假定模式。

`wallpaper_enabled` 是持续偏好，而非瞬时窗口状态：

- `true`：关闭前台窗口时恢复壁纸；登录启动时可静默进入壁纸；
- `false`：关闭前台窗口时隐藏到托盘。

临时进入前台不会关闭壁纸偏好。只有“设为壁纸”或明确退出壁纸模式才更新该设置。

### 10.2 设置为壁纸

1. 解析目标显示器；
2. 嵌入对应 WorkerW/Progman；
3. 确认嵌入和尺寸成功；
4. 写入 `wallpaper_enabled = true`；
5. 发布 `window-mode-changed: wallpaper`。

失败时保留前台窗口，不写入已启用状态，并向用户显示可重试的系统错误。

### 10.3 进入前台

沿用现有能力：壁纸区域现有单击/双击入口和托盘左键单击/双击均可进入前台；托盘右键显示菜单。进入前台时恢复原生窗口边框、显示并聚焦窗口，但不改变持续壁纸偏好。

### 10.4 关闭行为

拦截 `CloseRequested`：

- `wallpaper_enabled = true`：请求前端关闭所有业务弹窗和日期/时间浮层，然后恢复 Wallpaper，不退出、不隐藏；
- `wallpaper_enabled = false`：关闭前端浮层，隐藏到托盘并进入 HiddenToTray；
- 恢复壁纸失败：退化为隐藏到托盘并记录错误，确保仍可从托盘恢复。

## 11. 托盘、自启动与单实例

托盘右键菜单：

```text
打开 Nowly
设为壁纸 / 退出壁纸模式
────────
开机自动启动（勾选）
设置
────────
退出 Nowly
```

- “打开 Nowly”进入前台并聚焦；
- “设置”进入前台并通知 React 打开设置；
- “退出 Nowly”是唯一彻底退出进程的入口；
- 菜单内容和勾选状态随设置即时同步。

登录自启动使用 Tauri 2 自启动插件或等效统一集成：

- 使用 `--background` 静默参数；
- `wallpaper_enabled = true` 时不显示、不聚焦，直接进入目标显示器壁纸；
- `wallpaper_enabled = false` 时保持隐藏到托盘；
- 初始化失败时保留托盘入口并记录日志。

用户手动启动时默认进入前台，即使已启用持续壁纸；关闭后再恢复壁纸。应用使用单实例机制，重复启动只激活既有实例，不创建第二个数据库连接或壁纸窗口。

## 12. 目标显示器

只在用户选择的一台显示器显示 Nowly。首次默认主显示器。

Rust 向前端提供：

```text
MonitorInfo
├─ id
├─ name
├─ is_primary
├─ position_x
├─ position_y
├─ width
├─ height
└─ scale_factor
```

- 持久化稳定的系统设备标识，不使用列表序号；
- 设置项展示名称、主显示器标记、分辨率和缩放；
- 壁纸状态下切换显示器时立即重新嵌入；
- 切换失败时保留旧显示器和旧设置；
- 目标显示器断开时临时回退主显示器，但不覆盖保存 ID；
- 重新连接后，在下一次启动或显示配置变化时恢复；
- 继续支持任务栏避让、自动隐藏任务栏和负坐标。

监听显示器/DPI变化、Explorer 重启和任务栏变化。重新解析桌面层并按需嵌入；原生操作串行执行，不使用高频轮询。

## 13. UI 结构和视觉约束

```text
App
├─ AppBootstrap
├─ DesktopShell
│  ├─ TopBar
│  └─ Workspace
│     ├─ CalendarWidget
│     └─ SideColumn
│        ├─ MatrixWidget
│        └─ NotesWidget
└─ OverlayRoot
   ├─ DateDetailDialog
   ├─ EventDialog
   ├─ TaskDialog
   ├─ NoteDialog
   ├─ NotesManagerDialog
   ├─ SettingsDialog
   ├─ ConfirmDialog
   ├─ DatePicker
   └─ TimePicker
```

要求：

- 不迁移原型控制器或演示专用元素；
- 图标统一使用 `lucide-react`，业务组件不手写 SVG、不使用 Emoji；
- 复用公共设计 Token 和组件；
- 不允许 CSS/JS 动画、过渡、平滑滚动、Spinner、Skeleton；
- `html`、`body`、`#root` 固定为 `100vw × 100vh` 且禁止页面级滚动；
- Grid/Flex 中间容器具有 `min-width: 0`、`min-height: 0`；
- 业务列表和弹窗 Body 可以内部滚动；
- 支持 1366×768、1920×1080、2560×1440，以及 Windows 100%、125%、150% 缩放；
- 高分辨率下使用完整工作区，不以固定最大宽度浪费桌面空间。

## 14. 无障碍

- 弹窗使用 `role="dialog"`、`aria-modal="true"` 和可访问标题；
- 焦点限制在最上层弹窗，Escape 只关闭最上层浮层，关闭后归还触发元素；
- 确认框打开时背景弹窗不可聚焦；
- 每个字段有可见 Label，错误与字段关联，提交错误区域使用合适的 `role="alert"`；
- Checkbox/Radio 使用 `design.md` 的 Good Custom Solid 原生 input 结构；
- Select、日期和时间选择器具有完整键盘操作和 ARIA 状态；
- 图标按钮有可访问名称；
- 日历日期使用完整日期名称，日程名称包含时间、标题和分类；
- 完成状态不只依赖颜色或删除线；
- 所有键盘焦点使用统一青绿色焦点环。

## 15. 测试策略

所有功能和缺陷修复严格采用 Red-Green-Refactor。

### 15.1 Rust

覆盖：

- 迁移顺序、重复启动和回滚；
- 三类数据 CRUD；
- 服务端字段校验；
- 双向关联、重新关联和删除解除关联；
- 设置默认值和持久化；
- 关闭及启动模式决策；
- 显示器选择和主显示器回退；
- 现有 WorkerW、任务栏和窗口样式测试。

使用内存 SQLite 或独立临时数据库，不访问用户数据。

### 15.2 React/Vitest

覆盖：

- 首次启动空状态；
- Widget 数据、加载和错误状态；
- 新建、编辑、删除及二次确认；
- 未保存更改确认；
- 表单校验；
- 任务完成失败后的状态恢复；
- 关联变更后的跨模块刷新；
- 设置失败保留弹窗；
- 原生窗口事件驱动模式；
- 焦点陷阱和焦点归还。

### 15.3 Playwright

覆盖：

- 1366×768、1920×1080、2560×1440；
- 无页面级滚动；
- 原型布局和权威设计 Token；
- 空状态和完整 CRUD 路径；
- 日期、时间、Select 键盘交互；
- 弹窗层级、Escape 和焦点；
- 不存在旧版蓝色 Token、CSS 动效和原型控制器。

### 15.4 Windows 实机

Windows 10/11 人工集成矩阵覆盖：

- WorkerW 壁纸嵌入和前台恢复；
- 启用壁纸后的关闭恢复；
- 未启用壁纸时关闭到托盘；
- 托盘打开、设置、切换壁纸和退出；
- 登录后静默启动与单实例；
- 显示器选择、断开回退、重新连接恢复；
- Explorer 重启恢复；
- 任务栏四个方向和自动隐藏；
- 100%、125%、150% 缩放；
- 安装、升级和卸载；
- 空闲 CPU/GPU/内存表现。

无法稳定自动化的 Win32 行为通过明确人工清单验收，不伪装为单元测试。

## 16. 分阶段交付

### 阶段 1：数据基础与启动

版本化迁移、统一错误、类型化 Repository、默认设置、启动加载、空状态、移除正式示例数据。

### 阶段 2：日程

月份查询、日期详情、日程 CRUD、日期/时间选择器、校验、删除确认和月历刷新。

### 阶段 3：任务

四象限查询排序、任务 CRUD、完成状态、日程任务关联和失败恢复。

### 阶段 4：便签

便签 CRUD、置顶、固定颜色、主界面摘要和全部便签管理弹窗。

### 阶段 5：设置与窗口生命周期

设置持久化、壁纸偏好、关闭分流、托盘扩展和前端浮层清理。

### 阶段 6：Windows 系统集成

自启动、静默参数、单实例、显示器枚举选择、显示配置变化和 Explorer 恢复。

### 阶段 7：验收交付

全量 Vitest、Cargo Test、Playwright、Windows 实机矩阵、性能检查、安装包、使用说明和已知限制。

每个阶段必须保持可构建、可测试，提交信息遵循 `<type>: <short description>`。

## 17. 完成标准

正式版本必须同时满足：

1. React 正式路径不依赖固定示例数据；
2. 日程、任务、便签均完成 SQLite CRUD，重启后保留；
3. 日程和任务关联在变更、重新关联及删除后保持一致；
4. 首次启动为空状态；
5. 删除为带二次确认的永久删除；
6. 关闭、托盘和静默自启动符合已确认规则；
7. 可选择一台目标显示器，断开时可靠回退；
8. 主界面符合原型结构和 `design.md`；
9. 不存在页面级滚动和任何动效；
10. 自动化测试通过；
11. Windows 10/11 关键路径实机验收通过。
