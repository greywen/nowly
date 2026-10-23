# Nowly Bar 快速创建 Implementation Plan

> **For agentic workers:** 按任务顺序执行，步骤用 `- [ ]` 跟踪；每个任务先写/改测试，再实现，再验证，最后提交。

**状态：** 已在 `feature/bar-quick-create` 完成并合并到 `main`；仅真实 Tauri 运行时实测（Task 12 第一项后半）尚未执行。设计规格见 [2026-10-23-bar-quick-create-design.md](../specs/2026-10-23-bar-quick-create-design.md)。

**Goal:** 不打开主应用，从 Nowly Bar 功能菜单（或可选全局快捷键，默认不设）弹出紧贴 Bar 下方的置顶窗口，直接新建日程 / 四象限任务 / 便签；同时把功能菜单重排为「快速创建」磁贴 +「截图」两组。

**Architecture:** 新增惰性创建、关闭后隐藏复用的 `quick-create` 原生窗口（透明、无边框、无阴影、置顶、skipTaskbar），前端在该窗口内复用 EventModal / UnifiedTaskDialog / NoteModal。Bar 菜单与全局快捷键共用 Rust 入口 `quick_create::open(app, kind)`。快捷键注册表由 2 槽泛化为 5 槽（后 3 槽可空）。保存成功后发 `nowly-records-changed`，主窗口静默刷新。

**Tech Stack:** Tauri 2（Rust）、React + TypeScript + Vite、Vitest、Playwright、SQLite 设置存储。

---

## 已定设计（用户已确认）

- **菜单**：432×288 不变，头部不变。正文两组：
  - 「快速创建」：组标题（0.8rem/600，`--text-muted`）+ 三列等宽磁贴（间距 8、内边距 12、圆角 `--radius-sm`、底 `--bg-subtle`；hover/active 文字 `--color-primary-active`、底 `--bg-secondary`）。首行左侧 18px 图标、右侧快捷键（0.85rem/500，设了才显示）；名称 0.95rem/500 在图标下方 8px；已设但未注册时在名称下显示「快捷键不可用」。名称：日程 / 四象限任务 / 便签。名称、快捷键、提示最多两行，超出省略号。
  - 「截图」：截图、截图历史两项并排，沿用现有列表项样式。
  - 组内全隐藏 → 组标题隐藏；全部隐藏 → 现有空态。方向键按视觉顺序线性移动（RTL 左右互换），Home/End。焦点样式以 design.md 与现有 CSS 为准。
  - 点磁贴：先收起菜单，再打开快速创建窗口。
- **快速创建窗口**：Bar 正下方 8px（无 Bar 时目标显示器顶部 56px 处），水平对齐 Bar 中心并夹在工作区内；宽：日程 720 / 任务 680 / 便签 760；高度跟随内容，最高至工作区底部留 16px，超出在 Body 内滚动。无遮罩、`--shadow-none`、置顶，点击外部/切应用不关闭。保存成功即关闭（主应用刷新）；失败保持打开。取消/关闭键/Esc/Alt+F4 走现有关闭流程（有改动时确认放弃）。同类型再次触发 → 聚焦并保留草稿；不同类型 → 干净则直接切换，有改动先确认。截图期间隐藏，结束后不抢焦点恢复。截图进行中忽略打开请求。
- **设置**：通知页「Nowly Bar 功能菜单」按两组列出，组内显示/隐藏 + 上移/下移，组顺序固定（快速创建在上），新项默认显示，组内默认顺序 日程→任务→便签。快捷键页新增「快速创建」三个录制框（新建日程 / 新建四象限任务 / 新建便签），默认空、显示「未设置」、带清除按钮；五个全局快捷键互不重复（前后端都校验）。

## 命名约定

| 项 | 值 |
|---|---|
| 菜单 id | `createEvent` / `createTask` / `createNote`（追加在现有 3 项之后） |
| 设置字段 TS | `quickCreateEventShortcut` / `quickCreateTaskShortcut` / `quickCreateNoteShortcut`（可选 string，空串=未设置） |
| 设置字段 Rust / DB | `quick_create_event_shortcut` 等，`#[serde(default)] String` |
| 快捷键状态 binding | `createEvent` / `createTask` / `createNote`（shortcut 可为空） |
| 窗口 label / 路由 | `quick-create` |
| 命令 | `open_quick_create(kind)`（main、quick-panel-handle 可调）；`get_quick_create_request()`、`quick_create_layout(requestId, kind, height)`、`close_quick_create(requestId)`（仅 quick-create 窗口；过期 requestId 忽略） |
| 事件 | `quick-create-open`（payload = request）、`quick-create-close-requested`、`nowly-records-changed {kind: 'event'|'task'|'note'|'category'}` |
| kind | `'event' | 'task' | 'note'` |

## 文件地图

**新建**
- `src-tauri/src/quick_create.rs`：kind、请求状态、几何计算、窗口创建、4 个命令。
- `src/quick-create/QuickCreateApp.tsx` + `quick-create.css` + `QuickCreateApp.test.tsx`：窗口前端。
- `docs/superpowers/specs/2026-10-23-bar-quick-create-design.md`、`docs/superpowers/plans/2026-10-23-bar-quick-create.md`（如 `.gitignore` 忽略则加白名单）。

**修改（Rust）**
- `models.rs`：`default_bar_menu` 追加 3 id；AppSettings 加 3 字段。
- `settings.rs`：读写、`validate` 用统一快捷键校验。
- `commands.rs`：`update_settings_blocking` 规范化 5 个快捷键并注册。
- `screenshot_shortcuts.rs`：5 槽注册表、状态、录制暂停、错误字段映射。
- `quick_panel.rs`：`WorkArea.height`、`BarAnchor` / `bar_anchor()`；菜单收起辅助。
- `screenshot_windows.rs`：截图期间隐藏/恢复 `quick-create`。
- `main.rs`：manage 状态、快捷键 setup 5 个 action、`on_window_event` 早返回 quick-create（CloseRequested→prevent+emit）、注册命令、所有 AppSettings 字面量。
- `capabilities/default.json`：windows 加 `quick-create`。

**修改（前端）**
- `src/app/bar-menu.ts`（+测试）：id、分组、`groupBarMenu`、`moveBarMenuItem`。
- `src/app/layout/BarMenuPanel.tsx`（+测试）、`src/app/styles.css`：分组布局。
- `src/screenshot-history/client.ts`：可选 create bindings。
- `src/settings/{BarMenuSettings,ShortcutRecorder,SettingsDialog,useSettings}.tsx/ts`（+测试）。
- `src/data/{nowly-repository,browser-tauri-shim}.ts`（+测试）。
- `src/modals/EventModal.tsx`、`src/modals/NoteModal.tsx`、`src/tasks/UnifiedTaskDialog.tsx`：可选 `onDirtyChange`。
- `src/main.tsx`、`src/screenshot/window-route.ts`（+测试）：新路由。
- `src/app/App.tsx`、`src/calendar/useEvents.ts`、`src/notes/useNotes.ts`、`src/tasks/TaskWorkspaceContext.tsx`：静默刷新。
- `src/i18n/translations.ts`、`src/i18n/locales/{fr,es,ar,ja,ko,zh-Hant}.ts`。
- `tests/nowly-bar-menu.spec.ts`：e2e 按新布局重写。
- 文档：`design.md`（§8.3、§12.3、§14.1、新增快速创建窗口小节）、`docs/user-guide.{zh,en}.md`、`README.md`、`README.zh.md`。

---

### Task 1: Worktree 与基线
- [x] `git worktree add D:\Codes\nowly\.worktrees\bar-quick-create -b feature/bar-quick-create main`
- [x] worktree 内 `npm ci`；`$env:CARGO_TARGET_DIR='D:\Codes\nowly\src-tauri\target'`；如构建需要，拷贝被忽略的 `src-tauri/oauth-credentials.json`。
- [x] 基线：`npm test`、`cargo test --manifest-path src-tauri/Cargo.toml`、`npx playwright test tests/nowly-bar-menu.spec.ts --project=1366x768`（PW_PORT=1421），记录已有失败。

### Task 2: 设计文档
- [x] `design.md`：§8.3 / §14.1 单列描述改为分组布局；§12.3 增加快速创建窗口几何；新增「快速创建窗口」小节（无遮罩、`--shadow-none`、置顶、关闭规则、无动画）；§10.11 注明窗口模式。
- [x] spec + plan 文档写入 `docs/superpowers/`。
- [x] 提交 `docs: specify bar quick create`。

### Task 3: i18n（8 种语言）
新增键：`barMenu.groupCreate` 快速创建（同时作为快捷键页分区标题）/ `barMenu.groupCapture` 截图 / `barMenu.createEvent` 日程 / `barMenu.createTask` 四象限任务 / `barMenu.createNote` 便签 / `settings.quickCreateEventShortcut` 新建日程 / `settings.quickCreateTaskShortcut` 新建四象限任务 / `settings.quickCreateNoteShortcut` 新建便签 / `settings.quickCreateShortcutHint` / `settings.shortcutNotSet` 未设置 / `settings.shortcutClearLabel` 清除「{feature}」快捷键（清除按钮的可访问名称）；`settings.shortcutDuplicate` 改为「快捷键不能与其他快捷键重复。」。fr/es/ar/ja/ko/zh-Hant 按已拟译文补齐。
- [x] `npm test -- src/i18n` 通过（键与占位符一致）。

### Task 4: 菜单模型（TS + Rust）
- [x] 测试先行：`bar-menu.test.ts` 断言默认 6 项顺序、旧 3 项数据规范化后追加 3 个创建项、`groupBarMenu` 分组与过滤、`moveBarMenuItem` 只在组内交换且跳过 assistant。
- [x] 实现：
```ts
export type BarFeatureId = 'screenshot' | 'screenshotHistory' | 'assistant' | 'createEvent' | 'createTask' | 'createNote';
export type BarMenuGroupId = 'create' | 'capture';
export const BAR_MENU_GROUPS: ReadonlyArray<{ id: BarMenuGroupId; ids: readonly BarFeatureId[] }> = [
  { id: 'create', ids: ['createEvent', 'createTask', 'createNote'] },
  { id: 'capture', ids: ['screenshot', 'screenshotHistory', 'assistant'] },
];
export function barMenuGroupOf(id: BarFeatureId): BarMenuGroupId;
export function groupBarMenu(items: BarMenuItem[], include: (item: BarMenuItem) => boolean): Array<{ id: BarMenuGroupId; items: BarMenuItem[] }>;
export function moveBarMenuItem(items: BarMenuItem[], id: BarFeatureId, offset: -1 | 1, exclude?: ReadonlySet<BarFeatureId>): BarMenuItem[];
```
- [x] Rust `default_bar_menu()` 追加 3 id；更新 settings/db 测试中的长度与顺序断言。
- [x] `npm test -- src/app/bar-menu.test.ts`、`cargo test bar_menu` 通过，提交 `feature: add quick create bar menu items`。

### Task 5: 设置字段 + 5 槽快捷键
- [x] Rust 测试先行：空创建快捷键不注册且无错误；非法 → 对应字段错误；五键重复 → 后者字段错误；`replace` 失败回滚；status 返回 5 个 binding。
- [x] `screenshot_shortcuts.rs`：`Slot {Screenshot, History, CreateEvent, CreateTask, CreateNote}`，`configured_keys(&AppSettings) -> [String;5]`，`validate_keys([String;5]) -> Result<[String;5], InvalidShortcut{field}>`（前两槽必填，后三可空），Registry/Controller 泛化为 5，空槽跳过注册；`setup(app, actions: [Action;5])`。
- [x] `models.rs` / `settings.rs` / `commands.rs` / 所有字面量同步；`settings::validate` 与 `update_settings_blocking` 走 `validate_keys`。
- [x] TS：AppSettings 类型、`useSettings` 默认、shim 默认与 `screenshot_shortcut_status`、`normalizeShortcutStatus` 可选 bindings（空→null），对应测试。
- [x] `cargo test`、`npm test` 定向通过，提交 `feature: support optional quick create shortcuts`。

### Task 6: 设置界面
- [x] 测试先行：BarMenuSettings 两个 fieldset、组内上下移、边界禁用；ShortcutRecorder 空值占位「未设置」、清除按钮、与多个值查重；SettingsDialog 新三项保存、五键冲突报错到对应字段。
- [x] `ShortcutRecorder` props：`optional?: boolean`、`otherValues: string[]`、`onClear?`；`SettingsDialog` 快捷键 Tab 新增「快速创建」分区；冲突字段列表扩展为 5 个。
- [x] 提交 `feature: configure quick create menu and shortcuts`。

### Task 7: 功能菜单分组布局
- [x] 测试先行（`BarMenuPanel.test.tsx`）：渲染两个 `role="group"`，磁贴 3 个、截图 2 个；点击磁贴 invoke `open_quick_create {kind}`；快捷键行只在设置后出现；组全隐藏时组标题隐藏；方向键/Home/End 按视觉顺序；RTL 左右互换。
- [x] 实现 + CSS（`.bar-menu-panel__group`、`__group-label`、`__items`、`__tile`、`__keys`、`__note`；两行省略作用于 `__label`、`__keys`、`__note`、`__shortcut > span`），只用 design.md 允许字号。
- [x] Rust：`open_quick_create` 被 Bar 菜单调用时先 `close_details_for_navigation`。
- [x] 提交 `feature: regroup nowly bar function menu`。

### Task 8: Rust 快速创建窗口
- [x] 测试先行（纯函数）：`placement(anchor, width)` 居中 Bar、夹到工作区；`clamp_height` 上下限；请求 id 递增、过期 id 忽略；kind 宽度。
- [x] `quick_panel.rs`：`WorkArea` 加 `height`；`pub(crate) struct BarAnchor {scale, center_x, top_y, work_left, work_top, work_right, work_bottom}` + `pub(crate) fn bar_anchor(app)`。
- [x] `quick_create.rs`：`QuickCreateState` 存待处理请求；`open` 在截图中忽略、记录请求、`ensure_window`（`WebviewWindowBuilder` 透明/无边框/无阴影/置顶/skipTaskbar/不可调整/隐藏）、emit `quick-create-open`；`quick_create_layout` 首次应用定位+尺寸+show+focus，后续只调高度；`close_quick_create` 隐藏并清请求。所有命令 `#[tauri::command(async)]`，校验调用窗口 label。
- [x] `main.rs`：manage、注册命令、`on_window_event` 早返回 quick-create（CloseRequested → prevent_close + emit `quick-create-close-requested`）、快捷键 action 调 `quick_create::open`；`screenshot_windows::suppress_for_capture` 加 label；capabilities 加 window。
- [x] `cargo test` 通过，提交 `feature: add native quick create window`。

### Task 9: 前端快速创建窗口
- [x] 测试先行（`QuickCreateApp.test.tsx`、`window-route.test.ts`）：挂载时拉取请求并渲染对应弹框；保存成功 → emit `nowly-records-changed` + invoke `close_quick_create`；取消 → close；同 kind 再开保留草稿；不同 kind 干净直接切换、有改动先确认；`quick-create-close-requested` 有改动时确认。
- [x] 三个弹框加可选 `onDirtyChange?(dirty: boolean)`。
- [x] `QuickCreateApp` + `quick-create.css`（透明根、`.overlay` 去 padding/遮罩、弹框宽 100vw、`max-height: var(--quick-create-max-h)`、`--shadow-none`、撤销 ≤900px 媒体规则、便签编辑器高度改用变量）。高度上报由 MutationObserver、ResizeObserver、定时器和每次提交共同驱动（隐藏窗口里 ResizeObserver 与动画帧可能不运行），等富文本编辑器挂载后再测量，按 requestId/kind/height 去重。
- [x] `main.tsx` 路由、浏览器 `?surface=quick-create&kind=`；shim 新增 4 个命令。
- [x] 提交 `feature: render quick create dialogs in their own window`。

### Task 10: 主窗口静默刷新
- [x] 测试先行：`useEvents` / `useNotes` / `TaskWorkspaceContext` 静默刷新不进入 loading；App 收到 `nowly-records-changed` 调用对应刷新。
- [x] 实现并提交 `feature: refresh main window after quick create`。

### Task 11: 文档与 e2e
- [x] 用户指南、README 中英更新。
- [x] 重写 `tests/nowly-bar-menu.spec.ts`（分组、磁贴、方向键、两行省略、打开快速创建；无焦点环断言保持）。夹具快照需带 `notificationMode: 'persistent'`，否则 Bar 收成顶边细条；定向 e2e 通过。
- [x] 提交 `docs: document bar quick create` / `test: cover grouped bar menu`。

### Task 12: 全量验证与合并
- [x] worktree 内 `npm test`、`npm run build`、`cargo test`、定向 Playwright。
- [ ] `npm run tauri dev` 实测窗口定位（多显示器 / DPI）、透明、置顶、全局快捷键唤起焦点、Alt+F4、截图隐藏。
- [x] `git checkout main; git merge --no-ff feature/bar-quick-create`，在 main 再跑 `npm test` 与 `cargo test`。不推送远端。

## 已知基线失败（与本功能无关）

- Vitest：`StatusIslandApp` 两个 AI 助手用例；`App` 中「creates notes and opens the all-notes manager」仍查找已移除的「便签标题」字段。
- Cargo：`attachments::tests::garbage_collection_keeps_referenced_files_and_reclaims_the_rest` 仍写入已移除的 `notes.title` 列。
- Cargo：`quick_panel::tests::native_*` 与 `handle_preserves_transparent_chrome…` 会创建真实 WebView2 窗口，全量并行运行时偶发失败；`cargo test --bin nowly quick_panel::tests::native_ -- --test-threads=1` 全部通过。
- Playwright：`nowly-bar-assistant.spec.ts`（AI 入口已隐藏）、`nowly-screenshot-startup.spec.ts` 中的截图编辑器用例与菜单截图超时文案用例、`screen-status-island.spec.ts` 中 4 个用例在 `main` 上同样失败。
