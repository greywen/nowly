# Nowly 统一设计规范

本文件是 Nowly 视觉与交互的唯一权威来源。所有数值均为**确定值**，不存在「可选区间」或「参考某个外部产品」的表述；实现时直接取用。

---

## 0. 强制规则

1. 设计、实现或修改任何页面、弹窗、组件、状态前，必须先完整阅读本文件。
2. 颜色、字号、字重、间距、圆角、阴影、边框只能取本文件定义的值。禁止新增「看起来差不多但数值不同」的样式。
3. 本文件优先于任何旧文档、旧原型与旧 Token。旧蓝色体系 `#009EF7`、`#181C32`、`#7E8299` 禁止用于任何界面。
4. 视觉语言只有一套：**暖白底 + 青绿主色 + 大圆角 + 边框分层**。禁止混入 Material、Ant Design、Apple、玻璃拟态、霓虹渐变等其他体系。
5. **全局禁用补间动画**（详见 §12）。hover / active / focus / selected / disabled 等状态必须保留，但只能即时改变颜色、背景、边框、阴影。
6. 需求与本文件冲突时，先修改本文件并确认，再实现页面。禁止在单个页面私自例外。
7. 所有 CSS 值通过 §14 的 Token 引用，组件内不得硬编码色值、圆角、阴影。
8. **样式一律手写 CSS，不使用 Tailwind 或任何工具类 / CSS-in-JS 框架。** 禁止工具类写法（`flex`、`p-4`、`text-sm`、`sr-only` 等）、`@apply`、`@tailwind` 指令。类名使用语义化 BEM 风格（`.block__element--modifier`），视觉隐藏使用 `.visually-hidden`。

---

## 1. 设计基调

关键词：**明亮、温暖、柔和、圆润、低对比边界、层级清晰**。

- 背景用暖白与米灰，不用冷灰蓝。
- 主色是明亮青绿 `#4FC9DA`，只用于操作、选中、关键数据；大面积区域保持安静。
- 层级靠 `1px` 边框和背景明度差建立，普通卡片不用阴影。
- 标题用深暖黑，说明文字用暖灰。
- 所有控件与容器共用 `15.2px` 大圆角，不混用直角或小圆角。

---

## 2. 配色

### 2.1 主色与功能色

| Token | 色值 | 用途 |
|---|---|---|
| `--color-primary` | `#4FC9DA` | 主按钮、选中态、链接、关键数据、进度环 |
| `--color-primary-hover` | `#69D1E0` | 主按钮 hover 背景与边框 |
| `--color-primary-active` | `#30A6B6` | 主色按下、浅色块上的主色文字/图标 |
| `--color-primary-light` | `#DDF8FC` | 主色浅背景：选中项、标签、图标底 |
| `--color-primary-border-subtle` | `#B9E9F0` | 主色浅色块的边框 |
| `--color-success` | `#B8D935` | 成功、完成 |
| `--color-success-active` | `#9FBE22` | 浅绿底上的文字/图标 |
| `--color-success-light` | `#F4FBDB` | 成功浅背景 |
| `--color-info` | `#4F55DA` | 信息提示、辅助数据系列 |
| `--color-info-active` | `#383EBC` | 浅蓝底上的文字/图标 |
| `--color-info-light` | `#EFF0FF` | 信息浅背景 |
| `--color-warning` | `#E8C444` | 警告、暂停、待处理 |
| `--color-warning-active` | `#CFAB2A` | 浅黄底上的文字/图标 |
| `--color-warning-light` | `#FDF4D6` | 警告浅背景 |
| `--color-danger` | `#F06445` | 错误、删除、冲突 |
| `--color-danger-active` | `#DB5437` | 浅红底上的文字/图标、错误文案 |
| `--color-danger-light` | `#FFF0ED` | 危险浅背景 |

功能色必须同时配合文字或图标表达含义，颜色不得是状态的唯一载体。

### 2.2 背景与表面

| Token | 色值 | 用途 |
|---|---|---|
| `--bg-page` | `#FFFFFF` | 应用底层、模块之间的留白 |
| `--bg-surface` | `#FFFFFF` | 弹窗、下拉、浮层、卡片内部表面、任务行 |
| `--bg-module` | `rgba(248, 246, 242, 0.3)` | 模块容器（`.card`）主体 |
| `--bg-subtle` | `#F8F6F2` | 顶栏、输入框、次按钮、看板泳道、控件静止底 |
| `--bg-secondary` | `#F6F1E9` | 控件 hover 底、滚动条滑块、今天标记、进度轨道 |
| `--bg-neutral` | `#F9F9F9` | 中性弱强调块（超量事件提示、代码 diff 底） |
| `--bg-overlay` | `rgba(0, 0, 0, 0.20)` | 弹窗遮罩 |

三层背景的固定关系：**应用白底 → 模块 30% 暖灰 → 模块内白色表面**。
控件底色固定为 `--bg-subtle`，hover 固定升到 `--bg-secondary`，不再引入第三档。

### 2.3 文字与图标色

| Token | 色值 | 用途 |
|---|---|---|
| `--text-primary` | `#211F1C` | 页面/卡片标题、选中 Tab、大号数字 |
| `--text-strong` | `#403D38` | 按钮文字、强调正文、顶栏时间 |
| `--text-secondary` | `#716D66` | 默认正文、表单文字、标签文字 |
| `--text-tertiary` | `#8E887A` | 装饰性图标（拖拽手柄）、空态说明 |
| `--text-muted` | `#968E7E` | 占位符、时间、元信息、未选中 Tab |
| `--text-disabled` | `#B5B0A1` | 禁用文字与图标 |
| `--text-inverse` | `#FFFFFF` | 主色/功能色/深色背景上的文字 |
| `--text-link` | `#4FC9DA` | 正文内链接 |
| `--text-link-active` | `#30A6B6` | 链接 hover / active |

默认正文用 `--text-secondary`；关键信息不得使用 `--text-muted` 及更浅的色值承载。

### 2.4 边框与焦点

| Token | 色值 | 用途 |
|---|---|---|
| `--border-default` | `#EAEAEA` | 卡片、输入、分隔线、顶栏下边界 |
| `--border-subtle` | `#F6F1E9` | 极弱分隔（同组信息之间、状态岛内分隔线） |
| `--border-emphasis` | `#DAD3C3` | 需要更明显边界的中性控件、Checkbox 未选中底 |
| `--focus-ring` | `rgba(79, 201, 218, 0.25)` | 焦点环颜色 |

---

## 3. 字体

### 3.1 字体家族

```css
--font-sans: Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
```

- 正文全部使用 `--font-sans`；`--font-mono` 只用于色值输入、代码块、diff。
- Inter 只加载 `300 / 400 / 500 / 600 / 700` 五个字重。
- 禁止衬线体、手写体、装饰字体。

### 3.2 字号层级

根字号固定 `html { font-size: 13px }`，即 **`1rem = 13px`**。字号一律写 `rem`，禁止写绝对 `px`。

| 层级 | 字号 | 换算 | 默认字重 | 允许字重 | 行高 | 用途 |
|---|---|---|---|---|---|---|
| Display | `1.75rem` | 22.75px | `700` | `300` / `700` | `1.25` | 时间选择器数字、专注计时读数 |
| H1 | `1.5rem` | 19.5px | `600` | `600` | `1.2` | 页面级主标题 |
| H2 | `1.35rem` | 17.55px | `600` | `600` | `1.2` | 一级分区标题 |
| H3 | `1.25rem` | 16.25px | `600` | `600` | `1.2` | 模块标题、弹窗标题 |
| H4 | `1.15rem` | 14.95px | `600` | `600` | `1.2` | 模块内分组标题 |
| Body Large | `1.075rem` | 13.975px | `600` | `500` / `600` | `1.5` | 顶栏日期与时间、重点列表项 |
| Body | `1rem` | 13px | `400` | `400` / `500` | `1.5` | 默认正文、按钮、输入框 |
| Body Small | `0.95rem` | 12.35px | `500` | `400` / `500` / `600` | `1.5` | 表单标签、小按钮、Tab、菜单项、Tooltip |
| Caption | `0.85rem` | 11.05px | `500` | `500` / `600` | `1.5` | 时间、元信息、说明、日期格数字 |
| Micro | `0.8rem` | 10.4px | `600` | `500` / `600` | `1.3` | 日历事件条、分组小标题、底部提示 |

规则：

- 只能使用上表 10 个字号。`0.875rem`、`0.9rem`、`1.05rem` 等相近值以及 `15.2px`、`16px` 等绝对值均为违规。
- 标题（H1–H4）统一 `600` + 行高 `1.2`，不使用 `700`。
- 纯数字读数（计时、时间步进器）使用 Display 行高 `1.25`，并加 `font-variant-numeric: tabular-nums`。
- 仅当元素需要随容器尺寸缩放时可用 `clamp()`（专注计时读数、日历模块标题），且上下端点必须落在上表范围内。
- 中文长正文每行控制在 35–45 字。
- 标题不全大写、不加字间距；唯一例外是专注模式的状态标签（`letter-spacing: 0.04em` + 大写）。

---

## 4. 间距与留白

### 4.1 间距刻度

以 `4px` 为基础网格，布局间距只允许下列值：

| Token | 值 | 典型用途 |
|---|---|---|
| `--space-1` | `4px` | 标题与说明之间、徽标内部 |
| `--space-2` | `8px` | 图标与文字、并排按钮、标签与输入框 |
| `--space-3` | `12px` | Checkbox 与标签、紧凑列表间距、模块正文顶部内边距 |
| `--space-4` | `16px` | 象限内边距、Tab 面板间距、小窗内边距 |
| `--space-5` | `20px` | 表单字段之间、模块正文顶部内边距（宽松档） |
| `--space-6` | `24px` | 模块间距、模块正文水平内边距、按钮水平内边距 |
| `--space-7` | `28px` | 便签板列间距 |
| `--space-8` | `32px` | 弹窗正文内边距、Tab 之间、分区间距 |
| `--space-9` | `36px` | 工作区水平内边距、对话框水平内边距 |
| `--space-10` | `40px` | 大分区间距 |
| `--space-12` | `48px` | 超大留白 |

`2px`、`6px`、`10px`、`14px` 只允许作为**控件内部的光学微调**（图标内缩、胶囊内边距、状态岛内偏移），不得用于元素之间或模块之间的布局间距。

### 4.2 固定间距规则

| 场景 | 值 |
|---|---|
| 工作区内边距（标准档） | `24px 36px 36px` |
| 模块之间（网格 gap） | `24px` |
| 右侧栏两模块之间 | `24px` |
| 模块头内边距 | `8px 20px`，最小高度 `56px` |
| 模块正文内边距 | `12px 24px 24px`（紧接网格/列表）或 `20px 24px 24px`（紧接卡片组） |
| 弹窗 Header / Footer | 最小高度 `70px`，水平内边距 `32px`（Modal）/ `36px`（Dialog） |
| 弹窗正文 | `32px`（Modal）/ `32px 36px`（Dialog） |
| 弹窗正文相邻块之间 | `20px` |
| 表单字段之间 | `20px` |
| 标签 → 输入框 | `8px` |
| 标题 → 说明文字 | `4px` |
| 图标 → 文字 | `8px` |
| Checkbox / Radio → 标签 | `12px` |
| 并排按钮之间 | `8px` |
| 列表项内边距 | `8px`（紧凑行）/ `12px`（标准行） |
| 浮层与触发控件之间 | `8px` |

同一页面的同级容器必须使用完全相同的内边距。

### 4.3 密度档位

界面密度通过根元素 `data-density` 切换，只有三档，切换即时生效：

| 目标 | `compact` | `balanced`（默认） | `comfortable` |
|---|---|---|---|
| 工作区内边距 | `12px` | `24px 36px 36px` | `32px 44px 44px` |
| 模块 gap / 右侧栏 gap | `12px` | `24px` | `32px` |
| 模块头 | `44px` / `4px 12px` | `56px` / `8px 20px` | `64px` / `12px 28px` |
| 日历正文 | `6px 12px 12px` | `12px 24px 24px` | `20px 32px 32px` |
| 面板正文 | `8px 12px 12px` | `20px 24px 24px` | `28px 32px 32px` |
| 象限 gap / 内边距 | `6px` / `8px` | `12px` / `16px` | `20px` / `20px` |
| 便签列表 gap | `6px` | `12px` | `16px` |
| 任务行内边距 | `4px 6px` | `8px` | `12px` |
| 弹窗正文内边距 / 块间距 | `24px` / `16px` | `32px` / `20px` | `40px` / `28px` |

密度只改间距，**不改字号、圆角、颜色、边框**。

---

## 5. 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | `7.6px`（`0.475rem`） | 菜单项、日历事件条、小徽标、图标底、紧凑任务行 |
| `--radius-md` | `10px` | 特殊紧凑容器 |
| `--radius-default` | `15.2px`（`0.95rem`） | 按钮、输入框、模块、弹窗、浮层、Checkbox 外形基准 |
| `--radius-pill` | `999px` | 胶囊标签、状态徽标、滚动条滑块 |

规则：

- 按钮、输入、模块、弹窗、下拉一律 `15.2px`。
- 圆形元素（头像、日期格、单选点、色卡）用 `50%`。
- 折叠态状态轨道的胶囊圆角由高度决定：`height / 2`（`40px` 高 → `20px`）。
- 禁止 `8px`、`12px`、`16px`、`20px` 等未定义圆角，也禁止同一组件族混用多个圆角。
- Checkbox 方框使用 `--radius-sm`（`7.6px`）。
- 卡片内嵌图片需匹配容器内圆角，不允许直角溢出。

---

## 6. 阴影

模块与按钮默认无阴影，层级由边框承担。阴影只用于脱离文档流的浮层。

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-none` | `none` | 模块、按钮、输入框、状态轨道 |
| `--shadow-xs` | `0 1.6px 12px 4px rgba(0, 0, 0, 0.05)` | 吸底操作条 |
| `--shadow-sm` | `0 1.6px 16px 4px rgba(0, 0, 0, 0.05)` | 内嵌输入条、小浮起控件 |
| `--shadow-md` | `0 8px 24px 8px rgba(0, 0, 0, 0.075)` | 抽屉、嵌入式助手面板 |
| `--shadow-lg` | `0 16px 32px 16px rgba(0, 0, 0, 0.10)` | 模态框、对话框 |
| `--shadow-dropdown` | `0 0 50px 0 rgba(82, 63, 105, 0.15)` | 下拉、日期/时间面板、状态岛详情 |
| `--shadow-tooltip` | `0 0 30px rgba(0, 0, 0, 0.15)` | Tooltip |
| `--shadow-focus` | `0 0 0 4px rgba(79, 201, 218, 0.25)` | 键盘焦点环 |

规则：

- 一个元素只能使用一个预定义阴影，不得叠加自定义多层阴影。
- 阴影不是 hover 反馈，hover 不得增减阴影。
- 铺满透明原生窗口的浮层（状态轨道、状态详情、快捷面板）一律 `--shadow-none`：外阴影会被窗口边缘裁切成灰斑，层级改由 `1px` 边框承担。

---

## 7. 边框

| 场景 | 值 |
|---|---|
| 默认边框 | `1px solid var(--border-default)` |
| 弱分隔 | `1px solid var(--border-subtle)` |
| 中性控件强边界 | `1px solid var(--border-emphasis)` |
| 模块头与正文分隔 | `1px dashed var(--border-default)` |
| 选中 / 展开 | `1px solid var(--color-primary)` |
| 错误 | `1px solid var(--color-danger)` |
| 成功 | `1px solid var(--color-success)` |
| 占位边框（按钮、输入框静止态） | `1px solid transparent`，保证状态切换不跳位 |

规则：

- 虚线边框只用于三类语义：模块头分隔、可拖动的顶部浮层家族（状态轨道及其详情面板）、上传/空态/可添加区域。普通卡片、弹窗、下拉、模块容器禁止虚线。
- 唯一允许的粗边框是 Tab 选中下划线 `3px`（§10.10）。其余位置禁止 `≥2px` 装饰边框。
- 需要内描边焦点时使用 `inset 0 0 0 2px var(--color-primary)`（仅限被窗口裁切的顶部浮层，外环会被裁掉）。

---

## 8. 整体布局

### 8.1 应用骨架

```
app-shell（100vw × 100vh，grid-template-rows: 70px minmax(0, 1fr)）
├─ wallpaper-layer   绝对定位，z-index 0，覆盖整屏，pointer-events: none
├─ topbar            70px，z-index 2
└─ workspace         z-index 1，padding 24px 36px 36px
   └─ module-grid    12 列 × 8 行，gap 24px
```

- 主窗口不滚动（`overflow: hidden`），滚动只发生在模块正文内部。
- 专注模式隐藏顶栏，此时 `app-shell` 只有一行。
- 应用没有侧边导航栏；导航与全局操作全部集中在顶栏与顶部状态轨道。

### 8.2 模块网格

- 固定 `repeat(12, minmax(0, 1fr))` × `repeat(8, minmax(0, 1fr))`，gap `24px`。
- 模块按列跨度与行跨度占位，宽高由网格决定，模块自身不设固定像素尺寸。
- 每个模块都必须能在最小占位下正常显示，因此模块内部一律 `min-width: 0; min-height: 0`。
- 右侧栏为两行结构：`minmax(0, 1.15fr) minmax(0, 0.85fr)`，gap `24px`。
- 模块内部随宽度变化的显隐使用**容器查询**（`@container module`），不使用视口媒体查询。

### 8.3 顶部状态轨道

- 居中于屏幕顶边，由独立原生窗口承载。
- 折叠态固定 `288 × 40px`：左侧 `240px` 为提醒/状态操作，其右 `48px` 为唯一 Logo 入口。Logo 点击打开功能菜单，不直接打开 AI；无额外应用图标和添加槽位。
- 外壳负责边框（`1px solid var(--border-default)`）、圆角（`20px`）、裁切与背景；各操作区自身透明、无边框、无独立圆框。
- Logo 左边缘有 `1px` 分隔线，颜色 `var(--border-subtle)`，高 `22px`，上下各留 `9px`。
- **所有展开面板统一宽 `432px`**，与折叠态形成 `3:2` 比例。提醒/功能菜单高 `288px`，AI 高 `440px`，截图历史高 `560px`，圆角均为 `15.2px`。
- 宿主恒宽 `432px`，只随来源改变高度。折叠外壳居中，透明留白各 `72px`；展开面板左右边缘与宿主重合。透明留白不能拦截桌面点击。
- 提醒头部图标与文字保持相同屏幕坐标：展开头部保留折叠起点 `72px` 偏移，详情正文使用完整展开宽度。内容不跟随形变横移。
- 功能菜单单列，默认顺序为截图、截图历史、AI 助手，三项默认可见。设置允许逐项显示/隐藏和上移/下移排序，全部隐藏时显示设置引导空态；隐藏不影响快捷键。
- 提醒、菜单、AI、历史互斥，非提醒面板开合不确认提醒、不改变已读/汇总状态。各面板关闭键同规格，关闭后回到折叠态，不新增返回菜单按钮。

### 8.4 响应式断点

只有两个断点，且只调整间距与显隐，不改字号与圆角：

| 断点 | 变更 |
|---|---|
| `max-width: 1500px` 或 `max-height: 850px` | 顶栏水平内边距 `16px`；工作区内边距 `16px`；模块 gap `16px`；模块头 `48px / 8px 20px`；模块正文 `12px 16px 16px`；象限 gap `8px`、内边距 `12px`；按钮水平内边距 `16px`、字号 `0.95rem`；状态胶囊只留首个徽标 |
| `max-width: 980px` | 顶栏 gap `12px`，隐藏顶栏日期文案；状态胶囊只保留告警徽标 |

窄窗下允许减少列数与外边距，禁止压缩正文字号或改变组件圆角。

---

## 9. 滚动条

- 宽高固定 `8px`，轨道透明，几何尺寸常驻（避免出现/消失导致布局跳动）。
- 滑块默认完全透明；所在区域 `:hover` 或 `:focus-within` 时显示 `var(--bg-secondary)`。
- 滑块圆角 `--radius-pill`，带 `2px` 透明边框 + `background-clip: padding-box`。
- Firefox 使用 `scrollbar-width: thin` + `scrollbar-color`，Chromium/WebView2 使用 `::-webkit-scrollbar-*`。

---

## 10. 组件规范

### 10.1 按钮

所有按钮共用基础：高度 `40px`、`box-sizing: border-box`、内边距 `8px 24px`、圆角 `15.2px`、边框 `1px solid transparent`、字号 `1rem`、字重 `500`、行高 `1.5`、图标与文字间距 `8px`、阴影 `none`、`white-space: nowrap`。

| 变体 | 默认 | hover | active |
|---|---|---|---|
| 次按钮（默认） | 文字 `--text-strong`，底 `--bg-subtle` | 文字 `--color-primary`，底 `--bg-secondary` | 底 `--bg-secondary` |
| 主按钮 | 文字 `#FFFFFF`，底/边框 `--color-primary` | 底/边框 `--color-primary-hover` | 底/边框 `--color-primary-active` |
| 危险按钮 | 文字 `#FFFFFF`，底/边框 `--color-danger` | 底/边框 `--color-danger-active` | 底/边框 `--color-danger-active` |
| 描边按钮 | 文字 `--text-secondary`，底 `--bg-surface`，边框 `--border-default` | 文字 `--color-primary`，底 `--bg-subtle`，边框 `--border-emphasis` | 同 hover |
| 幽灵按钮（面板内操作） | 文字 `--text-secondary`，底 `transparent` | 文字 `--color-primary-active`，底 `--bg-subtle` | 同 hover |

- 窄窗（`max-width: 1500px`）下水平内边距降为 `16px`，字号降为 `0.95rem`，高度保持 `40px`。
- 浮层内的小按钮：最小高度 `36px`，内边距 `4px 12px`，字号 `0.85rem`（快捷值）或 `0.95rem`（页脚操作）。
- `disabled`：`opacity: 0.65`，`cursor: default`，移除交互。
- `focus-visible`：`--shadow-focus`。
- 危险按钮只用于删除与不可逆操作。
- 日期格、事件条、任务标题、链接等**内容型可点击元素**不套用 `40px` 固定高度。

#### 图标按钮

- 标准档固定 `40 × 40px`，内边距 `0`，圆角 `15.2px`，图标 `18px`。用于模块头操作、弹窗与页面内浮层的图标操作。
- **紧凑档固定 `28 × 28px`，内边距 `0`，圆角 `7.6px`，图标 `16px`。** 用于顶部状态轨道家族：折叠态关闭键、状态面板与 AI 面板右上角关闭键、AI 输入区的发送 / 语音 / 停止键。
- 紧凑档不是「装不下才退让」的例外，而是该家族的默认档：顶部轨道整体只有 `40px` 高，面板内的信息行图标是 `16px`，标准档的 `40 × 40` 方框在这里会明显压过内容。
- **方框与图标必须同档变化。** 禁止 `40 × 40` 方框配 `16px` 图标，也禁止使用 `28 × 28` 方框配 `18px`、`20px` 或 `24px` 图标；同一家族内的图标按钮同档。
- 选中态：文字 `--color-primary`，底 `--color-primary-light`。
- 圆形仅用于头像与色卡（`50%`）。
- 必须提供 `aria-label` 或 `title`。

### 10.2 模块卡片

- 背景 `--bg-module`，边框 `1px solid --border-default`，圆角 `15.2px`，阴影 `none`，`overflow: hidden`。
- 模块头：最小高度 `56px`，内边距 `8px 20px`，两端对齐，gap `16px`，下边框 `1px dashed --border-default`。
- 模块头标题：`1.25rem / 600 / 1.2`，`--text-primary`；副标题：`0.85rem / 500`，`--text-muted`，上间距 `4px`。
- 模块头无标题时操作右对齐。
- 模块正文：见 §4.2；滚动发生在正文内部。
- 禁止渐变描边、玻璃模糊、彩色外发光、厚重阴影。

### 10.3 顶栏

- 高度 `70px`，背景 `--bg-subtle`，下边框 `1px solid --border-default`，阴影 `none`。
- 内边距 `0 24px`（窄窗 `16px`），`grid-template-columns: minmax(0, 1fr) auto`，gap `24px`。
- 左侧日期：主行 `1.075rem / 600`，`--text-primary`；副行 `0.85rem / 500`，`--text-muted`。
- 右侧时间：`1.075rem / 600`，`--text-strong`；操作按钮之间 `8px`。
- 顶栏不使用主色大面积背景；主色只出现在关键按钮与选中图标上。

### 10.4 输入框与表单

- 高度：单行 `48px`；多行最小 `96px` 且 `resize: none`。
- 内边距 `11px 16px`（单行等效垂直居中），字号 `1rem`，字重 `400`，文字 `--text-secondary`，占位符 `--text-muted`。
- 背景 `--bg-subtle`，边框 `1px solid transparent`，圆角 `15.2px`，`outline: 0`。
- hover：背景 `--bg-secondary`。
- focus / 展开：**边框 `--color-primary`，不叠加 `--shadow-focus`，不加任何外环。** 文本框、多行文本框、富文本编辑器与下拉选择（§10.5）、日期 / 时间选择器触发控件（§10.7 / §10.8）共用这一条规则：激活时只有边框换色，几何尺寸与阴影完全不变。
- 文本类控件用 `:focus`（而非只用 `:focus-visible`）：鼠标点进输入框与键盘 Tab 进输入框是同一个激活态，表现必须一致。
- 富文本编辑器把工具栏与编辑区包在同一个表面里，`:focus-within` 时整体换边框色，不得让工具栏与编辑区各画一次边框或各亮一次焦点。
- error：边框 `--color-danger`；错误文案 `0.85rem / 500`，`--color-danger-active`。
- disabled：文字 `--text-disabled`，`opacity: 0.65`，`pointer-events: none`。
- 字段结构：`label`（`0.95rem / 500`，`--text-secondary`）→ `8px` → 控件；字段之间 `20px`。
- 错误提示块：内边距 `12px 16px`，圆角 `15.2px`，底 `--color-danger-light`，文字 `0.85rem / 500`。

### 10.5 下拉选择

- 触发控件：`48px` 高，内边距 `0 16px`，两端对齐，右侧 `18px` 箭头图标（`--text-muted`），其余同输入框。
- 浮层：`position: fixed`（脱离弹窗裁切），`z-index: 110`，最大高度 `min(320px, 100vh - 32px)`，内边距 `12px`，边框 `1px solid --border-default`，圆角 `15.2px`，底 `--bg-surface`，阴影 `--shadow-dropdown`，距触发控件 `8px`。
- 搜索框：高 `44px`，下间距 `8px`，内边距 `0 14px`，字号 `0.95rem`，底 `--bg-subtle`。
- 选项：最小高度 `44px`，内边距 `8px 12px`，圆角 `7.6px`，字号 `0.95rem / 500`。
  - hover / 键盘高亮：文字 `--color-primary-active`，底 `--bg-subtle`。
  - 已选：文字 `--color-primary-active`，底 `--color-primary-light`。
- 列表区最大高度 `240px`，独立滚动。
- 空态：内边距 `16px 12px`，字号 `0.95rem`，`--text-muted`，居中。
- 显示与隐藏即时完成，禁止展开、缩放、淡入。

### 10.6 Checkbox 与 Radio

必须保留原生 `<input>`，用 `appearance: none` 重绘，禁止用 `div`、图标或 JS 模拟。

```html
<label class="form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="checkbox">
  <span class="form-check-label">选项文字</span>
</label>
```

- 控件尺寸 `28 × 28px`，`flex: none`，无边框、无阴影。
- 与标签间距 `12px`；标签 `0.95rem / 500`，`--text-secondary`。
- 未选中底色 `--border-emphasis`（`#DAD3C3`）——该中性灰保证控件在任何浅色模块背景上都清晰可见。
- 选中底色 `--color-primary`。
- Checkbox 圆角 `--radius-sm`（`7.6px`），选中显示 `16 × 16px` 白色对勾（`stroke-width: 3`）。
- Radio 圆角 `50%`，选中显示 `10 × 10px` 白色实心圆点（居中，与 Checkbox 同用背景图绘制）。
- `focus-visible`：`--shadow-focus`；鼠标点击不显示焦点环。
- disabled：`pointer-events: none`，`opacity: 0.5`，标签用 `--text-disabled`。
- 选项组必须使用 `<fieldset>` + `<legend>`；Radio 组共享唯一 `name`。
- legend 样式：`0.95rem / 500`，`--text-secondary`，下间距 `8px`。

### 10.7 日期选择器

原生离线实现，不依赖 jQuery、Moment.js、Flatpickr、CDN 或浏览器原生 `type="date"` 面板。

- 触发控件同 §10.5，右侧 `18px` 日历图标。
- 面板：宽 `320px`，最大宽 `calc(100vw - 32px)`，内边距 `16px`，**无边框**，圆角 `15.2px`，底 `--bg-surface`，阴影 `--shadow-dropdown`，`z-index: 70`，距触发控件 `8px`。
- 头部：高 `40px`，`grid-template-columns: 40px 1fr 40px`，月份标题 `0.95rem / 600`，`--text-primary`，居中；翻月按钮 `40 × 40px`，图标 `18px`。
- 星期行：每格 `40 × 36px`，`0.85rem / 600`，`--text-muted`；周一开始。
- 日期格：`40 × 40px`，圆角 `50%`，`0.85rem / 500`，始终渲染 6 × 7 = 42 格。

| 状态 | 文字 | 背景 |
|---|---|---|
| 默认 | `--text-secondary` | `transparent` |
| hover | `--color-primary` | `--bg-subtle` |
| 非本月 | `--text-muted` | `transparent` |
| 今天未选中 | `--text-secondary` | `--bg-secondary` |
| 已选 | `#FFFFFF` | `--color-primary` |

- 页脚：上间距 `12px`，上内边距 `12px`，上边框 `1px solid --border-default`，两端对齐「清除 / 今天」。
- 交互：支持翻月、今天、清除、点击外部关闭、`Esc` 关闭；方向键移动、`PageUp`/`PageDown` 切月、`Enter`/`Space` 选择。
- 无障碍：触发控件 `aria-haspopup="dialog"` + `aria-expanded`；面板 `role="dialog"`；网格提供列标题、完整日期名、`aria-selected`、`aria-current="date"`。

### 10.8 时间选择器

原生离线实现，24 小时制，小时 `00–23`，分钟 `00–55`，步长 `5`。

- 触发控件同 §10.5，右侧 `18px` 时钟图标。
- 面板：宽 `280px`，内边距 `16px`，无边框，圆角 `15.2px`，阴影 `--shadow-dropdown`，`z-index: 70`。
- 步进器区：`grid-template-columns: 1fr auto 1fr`，gap `8px`。
- 单位标签：`0.85rem / 600`，`--text-muted`。
- 数值格：最小 `64 × 56px`，圆角 `15.2px`，底 `--bg-subtle`，`1.75rem / 700 / 1.25`，`--text-primary`。
- 分隔符 `:`：`1.75rem / 700`，上间距 `28px`。
- 增减按钮：`35 × 35px`，圆角 `15.2px`，透明底，图标 `18px`；hover 文字 `--color-primary-active`、底 `--bg-subtle`。小时与分钟各自独立循环。
- 快捷值：`09:00 / 09:30 / 12:00 / 14:00 / 15:00 / 18:00`，三列网格，gap `8px`，上间距 `16px`；按钮最小高 `36px`，内边距 `4px 8px`，`0.85rem / 500`，底 `--bg-subtle`。
- 页脚：上间距 `12px`，上内边距 `12px`，上边框 `1px solid --border-default`，两端对齐「清除 / 现在」，字号 `0.95rem`，透明底。「现在」取真实当前时间（时钟可注入，便于测试）。
- 起止时间共用一个面板；日期面板与时间面板互斥。
- 面板不得覆盖父弹窗 Header，也不得超出父弹窗左右边界；在起止时间行内改为右对齐弹出。
- 无障碍：数值使用 `role="spinbutton"` 与 `aria-valuemin` / `aria-valuemax` / `aria-valuenow`；支持 `ArrowUp`/`ArrowDown`、`PageUp`/`PageDown`、`Home`、`End`、`Enter`。
- 数字变化即时切换，禁止翻转、滚动、淡入效果。

### 10.9 标签、徽标与胶囊

| 类型 | 规格 |
|---|---|
| 状态徽标 | 内边距 `3px 8px`，圆角 `--radius-pill`，`0.85rem / 600`，浅背景 + 对应 `-active` 文字色 |
| 小标签 | 内边距 `4px 8px`，圆角 `--radius-sm`，`0.85rem / 600` |
| 可选胶囊（Chip） | 内边距 `6px 14px`，圆角 `--radius-pill`，边框 `1px solid --border-default`，底 `--bg-surface`，文字 `--text-secondary`，`0.95rem / 500` |

- 功能色标签一律「浅背景 + `-active` 文字」，禁止大面积高饱和实色：
  主色 `--color-primary-light` / `--color-primary-active`；成功 `--color-success-light` / `--color-success-active`；信息 `--color-info-light` / `--color-info-active`；警告 `--color-warning-light` / `--color-warning-active`；危险 `--color-danger-light` / `--color-danger-active`；中性 `--bg-secondary` / `--text-muted`。
- Chip 状态：hover 边框与文字转 `--color-primary`；`aria-pressed="true"` 时边框 `--color-primary`、底 `--color-primary-light`、文字 `--color-primary-active`；disabled `opacity: 0.5`。
- 颜色不得是唯一信息载体，徽标必须同时有文字或可访问名称。

### 10.10 Tab 标签页

全局唯一 Tab 形态是**下划线标签页**。禁止胶囊 Tab、分段控件、卡片 Tab、实色药丸 Tab。

标签条：横向排列，标签间距 `32px`，**自身不画底部基线**，无背景、无圆角、无内边距底块。

标签项：

- 背景任何状态下都是 `transparent`，圆角 `0`，内边距 `0 0 12px`。
- 字号 `0.95rem`，字重 `600`，行高 `1.5`。
- 下边框始终 `3px solid`，未选中为 `transparent`（占位，保证切换不跳高）。
- 默认文字 `--text-muted`；hover 文字 `--text-primary`（下边框仍透明）；选中文字 `--text-primary` + 下边框 `--color-primary`；disabled 文字 `--text-disabled`。
- `focus-visible`：`--shadow-focus`。
- 计数后缀（如 `(47)`）与标签同色同字重，左间距 `4px`。

规则：

- 标签条与内容之间 `24px`；面板内部块间距 `16px`。
- 必须使用 `role="tablist"` / `role="tab"` / `role="tabpanel"`，支持左右方向键切换。
- 切换即时完成，禁止滑动指示条、淡入、高度过渡。
- 应用设置与各模块设置共用同一套 Tab 实现，不得各自复刻。

### 10.11 模态框与对话框

两者共用表面规则：底 `--bg-surface`，边框 `1px solid --border-default`，圆角 `15.2px`，阴影 `--shadow-lg`，`overflow: hidden`。

| 项 | Modal | Dialog |
|---|---|---|
| Header / Footer 最小高度 | `70px` | `70px` |
| Header / Footer 水平内边距 | `32px` | `36px` |
| Body 内边距 | `32px` | `32px 36px` |
| Body 相邻块间距 | `20px` | `20px` |

- 遮罩：`--bg-overlay`，内边距 `32px`，`display: grid; place-items: center`。
- 结构：`grid-template-rows: auto minmax(0, 1fr) auto`，只有 Body 滚动。
- Header 标题 `1.25rem / 600 / 1.4`，`--text-primary`；Header 与 Footer 用 `1px solid --border-default` 分隔；Footer 操作右对齐，间距 `8px`。
- 宽度档位（均带 `calc(100vw - 32px)` 上限）：确认框 `480px`，标准 `560px`，日期详情 `600px`，任务/事件编辑 `680px`。
- 最大高度 `calc(100vh - 64px)`。
- 打开与关闭即时完成，禁止淡入、缩放、位移。
- 必须支持 `Esc` 关闭、焦点陷阱、关闭后焦点归还触发元素。

### 10.12 Tooltip

- 位置：触发元素下方 `10px`，默认水平居中，靠边时右对齐。
- 内边距 `4px 12px`，边框 `1px solid --border-default`，圆角 `--radius-sm`，底 `--bg-surface`，阴影 `--shadow-tooltip`。
- 文字 `0.95rem / 500 / 1.5`，`--text-strong`，`white-space: nowrap`，`pointer-events: none`。
- 即时显示与隐藏，无延迟动画。Tooltip 不得承载唯一的关键信息。

### 10.13 看板泳道

- 泳道：`flex: 1 1 0`，最小宽 `0`，边框 `1px solid --border-default`，圆角 `15.2px`，底 `--bg-subtle`，泳道之间 `16px`。
- 泳道头：最小高度 `48px`，内边距 `8px 12px`，下边框 `1px solid --border-default`，上圆角继承 `15.2px`，颜色取分类色（底浅、文字深）。
- 拖拽目标态：边框 `--color-primary`，底 `--color-primary-light`。
- 拖拽手柄光标 `grab` / `grabbing`；拖拽中的卡片 `opacity: 0.5`。

---

## 11. 交互状态

每个可交互元素必须定义以下状态，且全部即时生效：

| 状态 | 规则 |
|---|---|
| Default | 遵循组件基础样式 |
| Hover | 只改颜色、背景、边框、图标色；禁止改变尺寸与位置 |
| Active / Selected | 用 `--color-primary`、`--color-primary-active` 或 `--color-primary-light` 表达 |
| Focus-visible | `--shadow-focus`（`4px` 主色半透明环）；被原生窗口裁切的浮层改用 `inset 0 0 0 2px --color-primary`；**文本框 / 多行文本框 / 富文本 / 下拉与日期时间触发控件例外，只换边框色，见 §10.4** |
| Disabled | `opacity: 0.65`（Checkbox / Chip 用 `0.5`），`pointer-events: none` 或移除交互；不得只改光标 |
| Error | 危险色边框 + 文字说明，必要时加浅危险底提示块 |
| Loading | 只允许静态文案或静态占位，禁止旋转、脉冲、闪烁、骨架微光 |

`outline: 0` 必须与一个可见焦点样式成对出现；只清除 outline 而不给替代焦点表现属于违规。

---

## 12. 动效边界

原则不是禁止一切运动，而是**禁止补间与装饰性运动**。

| 允许 | 禁止 |
|---|---|
| 内容随时间的离散变化（时钟走字、计时环每秒重绘） | 状态 A→B 的补间（淡入、滑动、缩放） |
| 直接响应输入的运动（拖拽跟手） | 装饰性、表现性的持续运动 |
| 即时状态切换（hover / active / focus / selected / expanded / checked） | 循环动画（spinner、进度循环、骨架微光、轮播、视差、平滑滚动） |

全局静态约束必须存在，把规则变成物理事实：

```css
*,
*::before,
*::after {
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
```

该 CSS 拦不住 `requestAnimationFrame` 逐帧改属性；**JS 补间同样在禁止之列**。计时环每秒重绘、模块拖拽跟手属于「离散变化 / 输入驱动」，合规。

禁止项包括但不限于：CSS `animation` / `transition`、JS 补间、页面切换淡入、卡片 hover 上浮或缩放、按钮点击缩放、菜单展开过渡、模态框渐显、Loading Spinner、进度条循环、骨架微光、自动轮播、视差、平滑滚动、图标旋转或路径描边。

### 12.1 例外一：快捷面板原生窗口进出场

- 仅允许沿屏幕 **Y 轴**在顶部边缘与屏幕外之间移动原生窗口，用于表达其固定空间来源。
- 顶部状态轨道与面板同步反向滑入/滑出。
- 不得扩展到 WebView 内容、普通弹窗或任何控件。

### 12.2 例外二：状态轨道拖动

- 长按状态区沿屏幕 **X 轴**跟手移动原生窗口。
- 无补间：松手即停在指针处，并被工作区左右边界钳制。
- 这是输入驱动的运动，不是进出场动画。

### 12.3 例外三：顶部轨道 Fluid Morph

状态操作 → 提醒面板、Logo → 功能菜单是独立入口。菜单可切换到 AI/历史，各来源互斥，只共用形变参数。配置变更即时更新菜单，不播放图标增减动画。

| 参数 | 值 |
|---|---|
| 展开时长 | `280ms` |
| 收起时长 | `220ms` |
| 缓动 | `cubic-bezier(.22, 1, .36, 1)` |
| 面内内容淡入 | `140ms`，延迟 `90ms` |
| 面内内容淡出 | `110ms`，无延迟 |
| 相邻入口交叉淡变 | 淡入 `140ms` / 淡出 `110ms`，均无延迟 |
| 原生窗口收起等待 | `260ms`（等 `220ms` 形变结束后再裁小） |

固定几何：

| 形态 | 尺寸 | 圆角 |
|---|---|---|
| 折叠态外壳 | `288 × 40px` | `20px` |
| 提醒 / 功能菜单 | `432 × 288px` | `15.2px` |
| AI 面板 | `432 × 440px` | `15.2px` |
| 截图历史 | `432 × 560px` | `15.2px` |
| 原生窗口 | 宽 `432px`，高 `40 / 288 / 440 / 560px` | — |

全部展开面板使用同一宽度常量，不随菜单配置变化。

约束：

- 只允许补间 `width`、`height`、`border-radius`、`opacity`。禁止位移、缩放、旋转、圆角跳变、阴影变化。
- 面内内容按展开后的最终坐标排版，形变时只能被「露出」，**禁止随尺寸重排或位移**；图标与标题在两种尺寸下必须落在同一像素。
- 只随展开状态切换的元素（徽标、两个位置的关闭键、Nowly 圆点）一律用 `opacity` 交叉淡变，禁止移动同一元素。
- 原生尺寸变化无补间：展开先放大窗口，收起播完再裁小。只改高度，不横向缩窗或重新居中；宿主恒宽。
- Windows 宿主在显隐及尺寸变化后仍须保持无标题栏、无系统边框；必须在原生样式更新生效前过滤标题栏样式，不能依赖事后清理来消除关闭时的背景闪帧。
- 透明 Bar 表面由 WebView2 绘制；原生背景擦除不得覆盖该表面。Windows 的 GDI 擦背景不支持 alpha，不能把 `#00000000` 当作透明色交给 GDI 填充。
- Bar 不绘制原生非客户区；焦点变化仍须传递给窗口运行时，但不得触发系统标题栏重绘，避免收起动画中出现带窗口标题的残影。
- 全部面板外壳居中形变，从 `288px` 展开为 `432px`，不补间 left/位移。提醒头部固定在折叠起点，正文按最终尺寸排版。
- 菜单切换 AI/历史时宽度不变，仅改变外壳高度和内容透明度。
- 状态胶囊保持最终屏幕位置，只做透明度交接，不跟随任何轨道边缘横移。
- AI 收起时返回的状态胶囊置于收缩外壳**上方**，作为完整表面淡入，不得被实色外壳再次遮挡或逐段揭露。
- AI 打开、关闭或切换期间不触发状态面板动画、不呈现状态详情，也不改变状态提醒的已读/汇总状态。
- 关闭的面板必须不可见且不可交互，不能仅依赖透明窗口裁切隐藏内容。
- Windows 可见区域及外部点击按当前形态计算：折叠左右各 `72px` 透明留白，展开无水平留白。展开前恢复区域，收起动画完成后裁回。
- Logo 展开菜单并聚焦第一项，全隐藏时聚焦关闭键；点击 AI 项才展开 AI 并聚焦输入区。
- 所有面板右上角关闭按钮必须完全同规格，取 §10.1 图标按钮紧凑档：`28 × 28px`、圆角 `7.6px`、图标 `16px`、同图标、同颜色与同 hover / active / focus-visible 表现。
- 关闭键与 AI 输入区的发送 / 语音 / 停止键同属紧凑档：方框 `28 × 28px`、图标 `16px`，与状态面板信息行的 `16px` 图标同重量。顶部轨道内禁止出现 `40 × 40` 图标按钮。
- 移动状态轨道的说明以普通文本常驻状态面板底部，不用 tooltip、浮层或「知道了」按钮。
- `prefers-reduced-motion: reduce` 下取消全部补间，尺寸、圆角、内容全部即时切换。

### 12.4 例外四：自定义模块内容区

自定义模块内容区的动效**有条件放开**，必须同时满足：清单头声明 `@motion animated`、不可见时暂停、专注模式暂停、遵守全局静默开关。放开范围仅限模块内容区，不含模块外壳与应用控件。

以上四项例外均不得扩展到 WebView 内的普通弹窗、下拉菜单、模块容器或主窗口控件。

---

## 13. 图标

### 13.1 来源与适配层

- 全应用图标统一来自 **Solar 图标集**（480 Design，CC BY 4.0），`24 × 24` 网格。
- 唯一入口是 `src/components/icons.tsx`。字形数据由 `npm run icons`（`scripts/generate-icons.mjs`）从 `@iconify-json/solar` 生成到 `src/components/icon-data.ts`，该文件不得手改。
- 业务组件只能从适配层导入；禁止直接引入图标库、新增内联 SVG、使用 Emoji 或远程资源。仅品牌标识（如 GitHub）例外。
- CC BY 4.0 署名固定在「关于」弹窗。这些图标**不是** KeenIcons，文案与代码中不得如此声称。
- 更换图标集只需改生成脚本来源并重新生成 `icon-data.ts`，业务组件无需改动。

### 13.2 风格

| 风格 | Solar 变体 | 说明 |
|---|---|---|
| `duotone` | `-bold-duotone` | 默认 |
| `solid` | `-bold` | 实心 |
| `outline` | `-linear` | 线性 |

用户在「设置 → 界面 → 图标风格」切换，持久化在 `AppSettings.iconStyle`，由 `IconStyleProvider` 全局下发。同一时刻全应用只用一种风格，禁止混用。

### 13.3 尺寸与颜色

- 常规尺寸只有三档：`16px`（徽标、密集行、紧凑按钮）、`18px`（标准按钮与菜单项）、`20px`（不可点击的说明性图标）。
- 方框与图标按 §10.1 配套：`40 × 40px` 配 `18px`，`28 × 28px` 配 `16px`。顶部轨道家族关闭键与工具键均为紧凑档。
- `20px` 只用于不承担点击的说明性图标。
- 图标**不自带颜色**，一律继承控件的 `currentColor`：

| 场景 | 取值 |
|---|---|
| 默认按钮 | `--text-strong` |
| hover / 选中 | `--color-primary` |
| 浅主色块内 | `--color-primary-active` |
| 主按钮 | `#FFFFFF` |
| 低权重装饰（拖拽手柄、下拉箭头） | `--text-tertiary` / `--text-muted` |

- 禁止为某个区域单独覆盖图标 `color` 或 `stroke-width`；需要更轻的图标时改控件文字色。
- 图标不得代替全部文字；不直观的操作必须提供文本或 Tooltip。
- 纯图标按钮按 §10.1 使用标准档或紧凑档，必须有 `aria-label` 或 `title`。

---

## 14. 截图内容与编辑控件

截图原始像素与标注几何属于用户输出内容，不是 Nowly 应用控件。以下规则仅适用于截图覆盖层和最终图片，不能扩展到其他页面或组件：

- 截图原始像素和矩形裁切边界保持直角；PNG 不应用 `--radius-default`，也不裁掉四角。
- 绘制内容的笔宽、字号与马赛克块尺寸以输出物理像素计，不受应用 UI 的边框宽度和字号限制。
- 选区控制点是 `8px × 8px` 的实心方形几何标记，使用 `24px × 24px` 透明命中区域；不套用按钮圆角。
- 放大镜像素网格使用最近邻显示，不使用模糊、插值或装饰动效。
- 标注色板固定使用主色、成功色、信息色、警告色、危险色、`--text-primary`、`--text-inverse` 与纯黑八色，不新增主题色 Token。
- 工具栏、弹层、表单、按钮和提示文案仍遵守本文件既有 Token、Solar 图标、手写语义化 CSS 与动效边界。

截图专用几何常量：非选区遮罩使用 `--bg-overlay`；选区边框为 `1px solid var(--color-primary)`；放大镜宽 `192px`、内边距 `12px`；放大网格默认显示 `21 × 21` 个来源像素并以 `8` 倍最近邻放大；编辑工具栏使用标准档 `40 × 40px` 图标按钮和 `18px` 图标。以上数值只定义截图数据呈现与几何编辑，不构成新的全局组件规格。

---

### 14.1 截图入口、菜单与历史窗口

- Logo 打开功能菜单，截图项直接启动；启动期间禁用重复执行，失败在菜单显示错误并允许重试。截图/历史快捷键保持独立。
- 不创建独立截图菜单原生窗口。菜单复用 Bar 宿主，固定 `432 × 288px`，头部高 `40px`，正文内边距 `16px`。
- 菜单采用默认表面、边框、圆角和 `--shadow-none`，单列项按 §10.5，名称与实际快捷键两端对齐。快捷键读取失败明确提示并可重试，AI 不显示虚构快捷键。
- 历史复用 Bar 宿主，从顶边展开为 `432 × 560px`；宿主恒宽 `432px`，只改变高度。提醒、菜单、AI、历史互斥；非提醒面板不改变提醒已读或汇总状态。历史菜单项与快捷键均打开此面板。
- 历史面板沿用 §12.3 Fluid Morph：展开 `280ms`、收起 `220ms`，相同缓动与内容淡入淡出参数；只补间宽高、圆角和透明度，内容按最终尺寸排版，原生收起等待 `260ms`。减少动态效果时全部即时切换。该例外仅覆盖 Bar 历史面板外壳，列表与确认交互仍即时完成。
- 历史面板表面使用默认圆角、默认边框和 `--shadow-none`；头部高 `40px`，标题为 H3，关闭键取紧凑档；打开文件夹操作位于正文顶部。正文内边距 `16px`，卡片为单列，只有历史列表内部滚动。删除确认在面板内部呈现，支持取消、焦点归还与错误重试；Esc 优先取消确认，否则收起面板，点击外部收起。
- 历史卡片使用白色表面、默认边框和默认圆角，卡片间距 `24px`，内部间距 `12px`；缩略图等比完整显示，不裁切用户图片内容。
- 菜单、历史列表、确认框和反馈均即时切换，遵守全局动效禁令；缩略图加载使用静态占位。仅历史面板外壳开合采用上述 Fluid Morph 例外。

---

## 15. Token 清单

以下是唯一允许的 Token 集合，实现时全部定义在 `:root`：

```css
:root {
  /* 主色与功能色 */
  --color-primary: #4fc9da;
  --color-primary-hover: #69d1e0;
  --color-primary-active: #30a6b6;
  --color-primary-light: #ddf8fc;
  --color-primary-border-subtle: #b9e9f0;
  --color-success: #b8d935;
  --color-success-active: #9fbe22;
  --color-success-light: #f4fbdb;
  --color-info: #4f55da;
  --color-info-active: #383ebc;
  --color-info-light: #eff0ff;
  --color-warning: #e8c444;
  --color-warning-active: #cfab2a;
  --color-warning-light: #fdf4d6;
  --color-danger: #f06445;
  --color-danger-active: #db5437;
  --color-danger-light: #fff0ed;

  /* 背景与表面 */
  --bg-page: #ffffff;
  --bg-surface: #ffffff;
  --bg-module: rgba(248, 246, 242, 0.3);
  --bg-subtle: #f8f6f2;
  --bg-secondary: #f6f1e9;
  --bg-neutral: #f9f9f9;
  --bg-overlay: rgba(0, 0, 0, 0.2);

  /* 文字 */
  --text-primary: #211f1c;
  --text-strong: #403d38;
  --text-secondary: #716d66;
  --text-tertiary: #8e887a;
  --text-muted: #968e7e;
  --text-disabled: #b5b0a1;
  --text-inverse: #ffffff;
  --text-link: #4fc9da;
  --text-link-active: #30a6b6;

  /* 边框与焦点 */
  --border-default: #eaeaea;
  --border-subtle: #f6f1e9;
  --border-emphasis: #dad3c3;
  --focus-ring: rgba(79, 201, 218, 0.25);

  /* 圆角 */
  --radius-sm: 7.6px;
  --radius-md: 10px;
  --radius-default: 15.2px;
  --radius-pill: 999px;

  /* 阴影 */
  --shadow-xs: 0 1.6px 12px 4px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1.6px 16px 4px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 8px 24px 8px rgba(0, 0, 0, 0.075);
  --shadow-lg: 0 16px 32px 16px rgba(0, 0, 0, 0.1);
  --shadow-dropdown: 0 0 50px 0 rgba(82, 63, 105, 0.15);
  --shadow-tooltip: 0 0 30px rgba(0, 0, 0, 0.15);
  --shadow-focus: 0 0 0 4px rgba(79, 201, 218, 0.25);

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;
  --space-9: 36px;
  --space-10: 40px;
  --space-12: 48px;

  /* 字体 */
  --font-sans: Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}
```

本清单之外的颜色、圆角、阴影、间距均视为违规。新增 Token 必须先修改本文件。
