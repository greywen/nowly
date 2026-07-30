# Nowly 任务纵切设计规格

日期：2026-07-29

## 1. 目标与范围

本阶段交付 Nowly Windows 产品的第三个可独立验收纵向切片：从 React 四象限和任务弹窗，经类型化 Repository 与 Tauri Command，贯通到 SQLite 的任务稳定排序、创建、编辑、永久删除、完成状态切换，以及日程—任务一对一事务关联。

本规格继承并细化：

- `docs/superpowers/specs/2026-07-29-nowly-windows-complete-product-design.md`；
- `docs/superpowers/plans/2026-07-29-nowly-windows-product-roadmap.md`；
- 阶段 1–2 已发布的数据、Repository、错误、加载状态和关联契约；
- 根目录 `design.md`。

冲突时，产品范围和业务规则以完整产品规格为准，视觉规则以 `design.md` 为准。

本阶段包括：

- 全量任务读取及四象限稳定排序；
- 任务创建、编辑和永久删除；
- Checkbox 乐观完成切换、失败回滚和原意重试；
- 从四象限 Header 和日期详情创建任务；
- 任务与日程的一对一事务关联、重关联和解除关联；
- 任务弹窗中的离线日期选择器、Select、确认对话框和草稿保护；
- 紧凑双行任务行、无动画 Tooltip 和可访问完成状态；
- 关联变化后的任务与当前月份日程协调刷新；
- 对应 Rust、React 和 Playwright 自动化测试。

本阶段不包括：

- 跨月份日程搜索或全量日程读取；
- 任务拖拽、自定义排序、子任务、重复任务、提醒或通知；
- 批量完成、批量删除、撤销、回收站或软删除；
- 便签 CRUD；
- 设置、窗口生命周期或 Windows 原生系统集成修改；
- 数据导入、导出或云同步。

## 2. 架构与职责边界

采用独立 Task Feature，与阶段 2 的 Calendar Feature 对称：

```text
MatrixWidget / TaskModal / DateDetailDialog
                    │ 用户意图、受控草稿
                    ▼
                 useTasks
                    │ typed repository
                    ▼
             NowlyRepository
                    │ Tauri invoke
                    ▼
         Rust task commands/service
                    │ Immediate transaction
                    ▼
                  SQLite
```

边界规则：

- SQLite 是持久任务数据的唯一事实来源；
- `MatrixWidget` 只展示任务并发出创建、编辑和完成切换意图，不直接调用 Repository；
- `TaskModal` 管理草稿、客户端校验、提交状态、确认层和局部错误；
- `DateDetailDialog` 只发出“为该日期创建任务”的意图；
- `useTasks` 是任务数据的唯一前端状态拥有者，负责读取、稳定排序、CRUD 刷新、乐观完成切换、失败回滚和重试；
- 阶段完成时从 `useAppBootstrap` 移除任务读取，避免两个生产入口并发覆盖；
- `NowlyRepository` 暴露类型化任务方法；`src/data/tauri-nowly-repository.ts` 仍是唯一知道 Tauri 命令名的前端模块；
- Rust Command 只接收参数、调用任务业务层并序列化结果；任务 SQL、可信校验和事务放入独立 `src-tauri/src/tasks.rs`；
- 日程仍由 `useEvents` 拥有，任务仍由 `useTasks` 拥有。App 只装配两个 Feature 的跨模块刷新回调，不复制实体状态；
- 创建、更新或删除造成关联变化时刷新任务和当前月份日程；普通任务字段变化和完成切换不额外读取日程；
- 继续使用版本 5 的外键、唯一部分索引和任务查询索引，不修改迁移 1–5，也不新增无 schema 需求的迁移 6；
- 不重写阶段 2 弹窗基础组件、日期选择器、Select 或 Windows WorkerW/托盘子系统。

为避免 `useEvents` 与 `useTasks` 在 Hook 初始化时形成循环依赖，App 使用稳定的刷新回调/引用桥接两个 Feature；桥接只转发 `retryEvents` 与 `retryTasks`，不持有第三份业务数据。

## 3. 数据契约

### 3.1 实体与固定枚举

沿用 camelCase `MatrixTask`：

```ts
type Quadrant =
  | 'important_urgent'
  | 'important_not_urgent'
  | 'not_important_urgent'
  | 'not_important_not_urgent';

type TaskPriority = 1 | 2 | 3;

type MatrixTask = {
  id: string;
  title: string;
  quadrant: Quadrant;
  dueAt: string | null;
  priority: TaskPriority;
  completed: boolean;
  linkedEventId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
```

固定标签：

| 值 | 标签 |
|---|---|
| `important_urgent` | 重要且紧急 |
| `important_not_urgent` | 重要不紧急 |
| `not_important_urgent` | 不重要但紧急 |
| `not_important_not_urgent` | 不重要不紧急 |
| `1` | 高 |
| `2` | 中 |
| `3` | 低 |

### 3.2 写入请求

前后端新增同构 `TaskDraft`：

```ts
type TaskDraft = {
  title: string;
  quadrant: Quadrant;
  dueAt: string | null;
  priority: TaskPriority;
  completed: boolean;
  linkedEventId: string | null;
  note: string;
};
```

Repository 契约扩展为：

```ts
listTasks(): Promise<MatrixTask[]>;
createTask(draft: TaskDraft): Promise<MatrixTask>;
updateTask(id: string, draft: TaskDraft): Promise<MatrixTask>;
deleteTask(id: string): Promise<void>;
setTaskCompleted(id: string, completed: boolean): Promise<MatrixTask>;
```

Tauri 命令名和参数固定为：

```text
list_tasks          {}
create_task         { draft }
update_task         { id, draft }
delete_task         { id }
set_task_completed  { id, completed }
```

所有模型使用 `#[serde(rename_all = "camelCase")]`，所有命令返回 `Result<T, CommandError>`。

## 4. 可信校验与持久化

前端即时校验用于用户反馈，Rust 对每次创建和更新重复执行可信校验：

- 标题去除首尾空白后不能为空；持久化修剪后的标题；
- 象限必须属于四个固定值；
- `dueAt` 只能为 `null` 或严格的本地日期 `YYYY-MM-DD`，不得包含时间或时区；
- 优先级只能为整数 `1`、`2` 或 `3`；
- `completed` 为布尔值；
- `linkedEventId` 非空时，对应日程必须存在；
- 备注允许为空并保持用户输入，不自动修剪正文；
- 更新、删除或完成切换找不到任务时返回 `not_found`；
- 无效字段返回 `validation_error` 和 camelCase `field`；
- 唯一约束或并发关联冲突返回稳定 `conflict`；
- 其他数据库错误记录 Rust 日志后返回稳定 `database_error`，不暴露 SQL、路径或调用栈。

Rust 生成 UUID v4、`created_at` 和 UTC RFC3339 毫秒级 `updated_at`。编辑保留 `created_at`；创建、编辑和完成状态变化均更新 `updated_at`。

数据库迁移版本 5 已建立：

- `tasks.linked_event_id REFERENCES events(id) ON DELETE SET NULL`；
- `events.linked_task_id REFERENCES tasks(id) ON DELETE SET NULL`；
- 双侧唯一部分索引；
- `(quadrant, completed, due_at)` 索引。

因此本阶段不新增迁移。

## 5. 查询与稳定排序

`list_tasks` 返回全部任务。Rust 查询与前端乐观状态使用相同的稳定比较规则，确保写入前后视觉顺序不跳回不同位置：

1. `completed ASC`：未完成在前，已完成在后；
2. `due_at IS NULL ASC`：有截止日期在前，无截止日期最后；
3. `due_at ASC`：较早日期在前；
4. `priority ASC`：高（1）→中（2）→低（3）；
5. `created_at ASC`；
6. `id ASC`。

四象限由 UI 按固定顺序分组：重要且紧急、重要不紧急、不重要但紧急、不重要不紧急。每个象限内应用上述顺序。Rust 可在查询首位加入 `quadrant ASC` 以稳定全量结果，但 UI 不依赖数据库字符串顺序决定象限布局。

已完成任务不隐藏、不移出象限，始终排在该象限未完成任务之后。

## 6. 日程—任务一对一关联

任务侧的创建、更新和删除使用 `TransactionBehavior::Immediate`，并遵守阶段 2 已发布的双向关联契约。

### 6.1 建立或变更关联

在同一事务中：

1. 读取并锁定当前任务语义上的旧关联；
2. 校验目标日程存在；
3. 若任务原来关联其他日程，解除旧日程的 `linked_task_id`；
4. 若目标日程已关联其他任务，解除该旧任务的 `linked_event_id`；
5. 清理任何指向目标日程或当前任务的冲突单边关系；
6. 更新当前任务的 `linked_event_id`；
7. 更新目标日程的 `linked_task_id`；
8. 同步更新所有被改变实体的 `updated_at`；
9. 读回完整任务并提交。

任一步失败则整个事务回滚，不允许产生单边关联。

### 6.2 解除和删除

- 将 `linkedEventId` 改为 `null` 时，同一事务解除对应日程的 `linked_task_id`；
- 删除任务前先解除关联日程；随后只删除任务；
- 永不级联删除日程；
- 删除未关联任务不触碰日程表；
- `set_task_completed` 只改变 `completed` 和 `updated_at`，不改变关联。

### 6.3 前端刷新条件

- 创建任务且 `linkedEventId !== null`：写成功后刷新任务和当前月份日程；
- 编辑任务且旧、新 `linkedEventId` 不同：刷新任务和当前月份日程；
- 编辑任务但关联未变化：只刷新任务；
- 删除已关联任务：刷新任务和当前月份日程；
- 删除未关联任务或切换完成状态：只更新/刷新任务；
- 任一写入失败：不执行跨模块刷新，不关闭业务弹窗。

当前月查询可能不包含被修改的其他月份日程；当前月刷新仍必须执行，以清理目标日程或当前月旧关联的可见状态。其他月份将在用户切换月份时从 SQLite 读取最新状态。

## 7. `useTasks` 状态与操作

`useTasks` 对外提供：

```ts
{
  tasks,
  retryTasks,
  createTask,
  updateTask,
  deleteTask,
  setTaskCompleted,
  retryFailedCompletion,
  dismissTaskError,
  pendingTaskIds,
  failedCompletion
}
```

其中：

- `tasks` 遵循 `{ status: 'loading' | 'ready' | 'error', data, message? }`；
- 初次加载使用静态“正在读取本地任务”文案；
- 初次读取失败使用模块读取错误和“重试读取任务”，不影响日历、便签或设置；
- 写入错误与读取错误分离。完成切换失败时保留 `ready` 数据和四象限，只在模块顶部显示静态写入错误条；
- `pendingTaskIds` 用于禁用正在提交完成状态的 Checkbox；同一任务同时只允许一个完成切换请求；
- CRUD 成功后重新读取任务，确保服务端排序和被重关联实体一致；
- CRUD 失败保留现有任务数据，由 TaskModal 保留草稿和错误。

### 7.1 乐观完成切换

1. 记录任务当前实体、目标 `completed` 和本地任务修订号；
2. 立即用目标状态替换本地任务并执行稳定重排；
3. 将任务 ID 加入 `pendingTaskIds`，禁用对应 Checkbox；
4. 调用 `setTaskCompleted`；
5. 成功时使用服务端返回实体替换乐观实体、重新排序并清除失败意图；
6. 失败时恢复原实体和顺序，移出 `pendingTaskIds`，并保存 `{ taskId, targetCompleted, revision }` 作为可重试意图；
7. 四象限顶部显示错误文案和“重试”按钮，任务列表保持可见。

### 7.2 原意重试与陈旧保护

“重试”重新提交失败时记录的目标状态，而不是只重新读取：

- 重试期间禁用对应 Checkbox 和重试按钮；
- 若任务已不存在，清除失败意图并重新读取任务；
- 若该任务在失败后已成功编辑、删除或发生新的完成切换，本地修订号变化，旧失败意图自动失效并重新读取任务；
- 陈旧请求完成时不得覆盖更新后的实体；
- 用户可关闭错误条；关闭只丢弃重试入口，不改变已回滚的任务状态。

## 8. 四象限任务行与 Tooltip

任务行采用“紧凑双行 + Tooltip”：

- 每行左侧为 `28×28px` Good Custom Solid 原生 Checkbox；
- Checkbox 可访问名称为“完成任务：标题”或“标记任务为未完成：标题”；
- 右侧第一行为独立标题按钮，点击只打开编辑弹窗，不切换 Checkbox；
- 第二行显示短截止状态与优先级，例如“今天到期 · 高优先级”“7 月 31 日到期 · 中优先级”或“无截止日期 · 低优先级”；
- 已完成任务第二行追加可见文字“已完成”，标题使用删除线并降低文字强调；完成语义不得只依赖颜色或删除线；
- 标题过长时单行截断，不扩大象限宽度；
- 标题被鼠标 hover 或键盘 focus 时即时显示 Tooltip；移开/失焦即时隐藏；不使用延迟、过渡或动画；
- Tooltip 使用 `role="tooltip"`，标题按钮通过 `aria-describedby` 关联；
- Tooltip 展示完整标题、完整截止日期、优先级和关联日程；当前月份可解析时显示日程标题，否则显示“已关联其他月份日程”；无关联时显示“未关联日程”；
- Tooltip 只补充信息，不包含按钮或完成任务所必需的操作；
- 象限 Header 显示该象限任务总数；
- 各象限任务列表独立内部滚动，Grid/Flex 子项保持 `min-width: 0`、`min-height: 0`，不得产生页面级滚动。

模块完成写入错误条位于四象限 Grid 上方，使用 `role="alert"`，包含静态错误文案、“重试”和可访问的“关闭错误提示”。不使用 Toast 或自动消失提示。

## 9. 任务创建入口与默认值

入口：

- 四象限 Header 的“新增任务”按钮；
- 日期详情 Footer 的“新建任务”按钮；
- 点击任务标题打开编辑。

新建默认值：

```ts
{
  title: '',
  quadrant: 'important_urgent',
  dueAt: sourceDate ?? null,
  priority: 2,
  completed: false,
  linkedEventId: null,
  note: ''
}
```

其中：

- 默认象限固定为“重要且紧急”；
- 默认优先级为“中”，避免在用户未选择时虚构高优先级；
- 从日期详情创建时 `sourceDate` 为详情日期；
- 从四象限 Header 创建时截止日期为空；
- 日期详情中的按钮恢复于阶段 3；阶段 2 对该按钮“不显示”的约束在本阶段被本规格替代。

## 10. TaskModal 表单与关联选项

任务弹窗复用阶段 2 的 `Dialog`、`ConfirmDialog`、`DatePicker` 和 `Select`，不使用浏览器原生日期或下拉面板。

字段顺序：

1. 任务标题；
2. 所属象限；
3. 截止日期；
4. 优先级；
5. 关联日程；
6. 已完成；
7. 备注。

控件规则：

- 象限使用带 `<fieldset>`、`<legend>` 和唯一共享 `name` 的 Good Custom Solid 原生 Radio；
- 完成状态使用 Good Custom Solid 原生 Checkbox；
- 截止日期复用离线 `DatePicker`，支持清除；
- 优先级使用离线 `Select`；
- 关联日程使用可搜索离线 `Select`；
- 保存期间禁用保存、删除、关闭、表单控件和重复提交，按钮静态显示“正在保存”；
- 删除期间静态显示“正在删除”；
- 客户端字段错误显示在对应字段下并通过 `aria-describedby` 关联；
- Rust 返回的 `field` 映射到同名字段，其他错误在 Footer 上方使用 `role="alert"`；
- 保存失败保留全部草稿、选择器状态和弹窗；
- 保存成功后刷新所需 Feature，再关闭任务弹窗。

### 10.1 当前月份日程与跨月既有关联

任务弹窗不新增全量日程查询：

- 可选列表默认来自 `useEvents` 当前可见月份数据；
- 第一项为“无关联”；
- 创建任务只能从当前月份已加载日程中选择；
- 编辑任务若已关联当前月份日程，显示其真实标题；
- 编辑任务若 `linkedEventId` 不在当前月份数据中，额外插入值不变的受控选项，标签为“已关联其他月份日程”；
- 该占位选项保留原 ID，但不向用户显示原始 ID；
- 用户不改选时保存必须保留原关联；只有主动选择当前月日程或“无关联”才改变关联；
- Tooltip 对该情况同样显示“已关联其他月份日程”。

## 11. 草稿、关闭和永久删除

- 弹窗打开时复制实体为独立草稿，不直接修改四象限数据；
- 标题和备注在输入期间保留原始值，提交转换时只修剪标题；
- 创建或编辑草稿发生语义变化后，点击关闭、取消或 Escape 先打开“放弃更改”确认；
- 未修改草稿可直接关闭；
- 日期选择器或 Select 打开时，Escape 只关闭最上层浮层；
- 确认框打开时任务弹窗不再是顶层且不可聚焦；
- 关闭确认框后焦点返回任务弹窗；关闭任务弹窗后焦点返回原任务标题、新增按钮或日期详情按钮。

编辑模式提供危险按钮“删除任务”。确认文案：

```text
永久删除“任务标题”？

删除后无法恢复。
若存在关联，只解除关联，不删除关联日程。

[取消] [永久删除]
```

删除成功后关闭确认框和任务弹窗；失败时保留两层弹窗和错误。首版不提供撤销或回收站。

## 12. 日期详情集成

日期详情 Footer 同时提供：

```text
[新建任务] [新建日程]
```

- “新建任务”打开任务创建弹窗并预填详情日期为 `dueAt`；
- 任务弹窗位于日期详情之上；日期详情降为非顶层且不可响应 Escape；
- 取消任务创建后返回日期详情；
- 保存成功后刷新任务并返回日期详情；
- 本阶段不在日期详情新增独立任务摘要或任务编辑入口；日期详情已有的“关联任务”文案仍由最新任务资源解析，不额外查询数据库。

## 13. 模态路由与焦点

`ModalState` 扩展为显式创建/编辑状态：

```ts
type TaskModalState =
  | { type: 'task-create'; dueDate: string | null; trigger: HTMLElement | null; parentDate?: string }
  | { type: 'task-edit'; task: MatrixTask; trigger: HTMLElement | null; parentDate?: string };
```

- 四象限 Header 创建没有 `parentDate`；
- 日期详情创建带 `parentDate`；
- 四象限标题编辑没有 `parentDate`；
- 从日期详情任务摘要编辑时带 `parentDate`；
- 子弹窗关闭后按 `parentDate` 决定返回日期详情还是关闭 OverlayRoot；
- 永久删除确认和放弃更改确认始终是最上层；
- `Dialog` 的焦点陷阱、Escape 和焦点归还契约保持不变。

## 14. 错误处理

### 14.1 读取错误

任务初次读取失败时：

- 显示模块静态错误和“重试读取任务”；
- 四个象限容器仍保留；
- 不影响日历、便签和设置；
- 不显示 Spinner 或 Skeleton。

### 14.2 表单写入错误

创建、编辑或删除失败时：

- 保留任务弹窗、草稿和确认层；
- 字段错误落到字段下方；
- 普通错误落到 Footer 上方；
- 不虚假更新四象限；
- 不执行跨模块刷新。

### 14.3 完成写入错误

完成切换失败时：

- 恢复原完成状态和排序；
- 保留四象限内容；
- 模块顶部显示静态错误条；
- “重试”提交原目标状态；
- 不将整个模块改为读取错误态；
- 不使用 Toast、动画或自动消失。

## 15. 视觉与无障碍

所有 UI 修改前必须重新完整阅读根 `design.md`。本阶段：

- 复用 `src/app/styles.css` 的 `:root` Token 和语义类名；
- 普通卡片白底、`1px #EAEAEA` 边框、`15.2px` 圆角、无阴影；
- 主色为 `#4FC9DA`，禁止旧版 `#009EF7` 蓝色；
- Checkbox/Radio 必须保留原生 input 和 Good Custom Solid 结构；
- 使用项目既有 `lucide-react` 图标，不手写业务 SVG、不使用 Emoji；
- Tooltip 使用预定义 Tooltip 阴影，且无 transition/animation；
- 所有按钮、Checkbox、Radio、Select、日期控件和弹窗具有清晰 `focus-visible`；
- 图标按钮具有可访问名称；
- 弹窗使用 `role="dialog"`、`aria-modal="true"` 和可访问标题；
- Tooltip 只补充被截断或聚合的信息，不能替代可见 Label；
- 页面固定 `100vw × 100vh` 且禁止页面级滚动；业务列表和弹窗 Body 只允许内部滚动；
- 加载和提交状态只用静态文案，不使用 Spinner、Skeleton、闪烁、平滑滚动或任何动效。

## 16. 测试策略

所有生产行为严格执行 Red-Green-Refactor：每次先写一个失败测试，确认因缺失行为失败，再写最小实现并确认绿色。

### 16.1 Rust

覆盖：

- `TaskDraft` camelCase 反序列化；
- 标题修剪及空标题、无效象限、无效日期、无效优先级校验；
- 全量任务查询的稳定排序；
- 创建、编辑、删除和完成切换；
- 完成切换更新 `updated_at`；
- 双向建立、解除、抢占和重新关联；
- 删除任务保留日程并解除关联；
- 缺失任务和缺失日程的稳定错误；
- 约束或事务失败后不产生部分写入；
- 既有迁移和日程测试保持通过。

### 16.2 React/Vitest

覆盖：

- `useTasks` 初始读取、读取重试、CRUD 刷新和稳定排序；
- 跨象限编辑后重新分组；
- 完成状态乐观更新、失败回滚、原意重试和请求期间禁用；
- 陈旧完成响应与陈旧重试不覆盖编辑或删除后的任务；
- 关联变化刷新当前月日程，普通修改不产生额外日程读取；
- 四象限空态、加载态、读取错误和写入错误；
- 紧凑双行、Tooltip、截止提示和已完成文字；
- 新建默认值和日期详情截止日期预填；
- 客户端/服务端字段错误、失败保留草稿和忙碌状态；
- 当前月日程选项和跨月既有关联占位选项；
- 未保存更改与永久删除确认；
- 弹窗层级、Escape、焦点陷阱和焦点归还；
- App/ModalRoot 的跨 Feature 刷新装配。

### 16.3 Playwright

使用状态化 Tauri IPC stub 覆盖：

1. 四象限 Header 新建任务；
2. 日期详情新建任务并预填截止日期；
3. 编辑任务和跨象限移动；
4. Checkbox 完成后重新排序；
5. 完成写入失败、回滚和原意重试；
6. 关联、重新关联和解除日程；
7. 永久删除任务且保留关联日程；
8. Tooltip 的 hover/focus 内容；
9. 键盘操作、弹窗 Escape 和焦点归还；
10. 1366×768、1920×1080、2560×1440 等既有四组视口无页面级滚动；
11. 不存在动效、Spinner、旧版蓝色、原生日期面板或原型控制器。

## 17. 阶段门禁与完成标准

阶段关闭前必须通过：

```bash
npm test
npm run build
npx playwright test
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

同时必须满足：

1. 正式路径不依赖 `sample-data.ts`；
2. 任务 CRUD 和完成状态重启后保留；
3. 四象限排序与本规格一致；
4. 完成失败可见回滚，并可重新提交原目标状态；
5. 创建、编辑、解除、抢占和删除后的日程—任务关系双向一致；
6. 删除任务不删除日程；
7. 日期详情新建任务正确预填日期；
8. 任务弹窗保留草稿、字段错误、永久删除确认和焦点契约；
9. UI 符合 `design.md`，不存在页面级溢出或任何动效；
10. 禁止项扫描不包含旧蓝色、手写业务 SVG、Emoji、Spinner 或 Skeleton；
11. 阶段 1–2 自动化测试无回归；
12. 代码审查完成后，才将路线图和文档索引更新为“阶段 3 已完成”，并开始阶段 4 详细计划。
