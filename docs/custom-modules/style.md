# 视觉样式

**模块的视觉必须和 Nowly 主应用长得一模一样。判定标准只有一个：仓库根的 [`design.md`](../../design.md)。** 动手写样式前先读它——颜色、字体、字号、字重、行高、间距、圆角、边框、阴影、每类组件的确切尺寸与状态，全在那里，且都是**精确数值**，不是「差不多」。

沙箱注入了一份从应用 `styles.css` 生成的样式表。**你看不到父页面的 CSS**，但可以直接用下面的 `--nm-*` 令牌（等于 `design.md` §2 色板、§5 圆角、§6 阴影）和 `nm-*` 语义类。

令牌和语义类是**便利，不是天花板**——不要因为「只有这几个类」就把组件做窄或做走样。

---

## 1. 落数值的速查

全部出自 `design.md`，细节以它为准。下面是最常踩偏的几组硬数字：

- **字号（§3.3，只能用这些语义档，禁止 14/18/22 等相近值）**：Display `28/700`、H1 `24/700`、H2 `21.6/700`、H3 卡片标题 `20/600–700`、H4 `18.4/600`、Body Large `17.2`、正文 `16/400`、Body Small `15.2`、Caption `13.6`。行高统一 `1.5`（标题略紧，见表）。标题用 `--nm-text-primary`，正文 `--nm-text-secondary`，说明 `--nm-text-muted`。
- **间距（§4，4px 基准）**：只用 `4 / 8 / 12 / 16 / 20 / 24 / 32…` 这套刻度。图标与文字 `8px`，同级卡片间距 `≥16px`，表单字段纵向 `20px`，标题与说明 `4–8px`。禁止 `10px`、`14px`、`30px` 这种离刻度值。
- **圆角（§5）**：按钮 / 输入框 / 卡片 `var(--nm-radius-default)`（15.2px）；小标签 `var(--nm-radius-sm)`（7.6px）；胶囊 / 圆点 `var(--nm-radius-pill)`。同族组件不混用圆角。
- **边框（§7）**：默认 `1px solid var(--nm-border-default)`；选中 `1px solid var(--nm-color-primary)`；错误 `--nm-color-danger`。除 Tab 选中下划线（3px）外，禁止 2px 以上粗边框作装饰。
- **阴影（§6）**：普通卡片**不加阴影**，靠 1px 边框建立层级；hover 也不得突然加阴影。下拉 / 浮层用 `var(--nm-shadow-dropdown)`，焦点环用 `var(--nm-shadow-focus)`（`0 0 0 4px` 半透明青绿）。
- **交互状态（§8、§9）**：每个可交互元素都要有 default / hover / active / focus-visible / disabled，且**只即时改颜色 · 背景 · 边框 · 阴影**，不改尺寸和位置。disabled 透明度 `0.65`。focus-visible 必须是 4px 青绿焦点环，不能只靠弱边框。

---

## 2. 令牌（节选，全部以 `--nm-` 为前缀）

| 用途 | 令牌 |
|---|---|
| 主色 / hover / active / 浅底 | `--nm-color-primary` / `--nm-color-primary-hover` / `--nm-color-primary-active` / `--nm-color-primary-light` |
| 成功 / 警告 / 危险 | `--nm-color-success` / `--nm-color-warning` / `--nm-color-danger` |
| 标题 / 正文 / 弱说明 | `--nm-text-primary` / `--nm-text-secondary` / `--nm-text-muted` |
| 表面 / 浅底 / 边框 | `--nm-bg-surface` / `--nm-bg-subtle` / `--nm-border-default` |
| 圆角 小 / 默认 / 胶囊 | `--nm-radius-sm` / `--nm-radius-default` / `--nm-radius-pill` |
| 焦点环 | `--nm-shadow-focus` |
| 字体 | `--nm-font-sans` |

---

## 3. 现成的语义类

常见组件已按 `design.md` 实现，能套就套，省得手写还走样。

- `.nm-card` 卡片容器（边框 + 圆角 + 表面底色）
- `.nm-title` / `.nm-text` / `.nm-muted` 文本层级
- `.nm-btn`（默认）/ `.nm-btn--primary` / `.nm-btn--danger` / `.nm-btn-icon`（40×40 图标按钮）
- `.nm-input` 输入框
- `.nm-tag` 胶囊标签
- `.nm-list` 无样式列表
- `.nm-empty` 空状态
- `.nm-msg` / `.nm-msg--danger` 消息条

部件相关的类（`.nm-field-label` / `.nm-select*` / `.nm-tabs*` / `.nm-datepicker*` / `.nm-colorpicker*`）也已注入，由 [widgets.md](./widgets.md) 的工厂自动套上，无需手写。

---

## 4. 超出现成类时：照 `design.md` 手写

没有对应 `nm-*` 类的组件（卡片头、chip、Checkbox / Radio、下划线 Tab、状态徽标、下拉浮层、日期 / 时间选择器……），**翻 `design.md` §8 对应小节，用 `--nm-*` 令牌把它的确切数值写出来**，禁止凭感觉取近似值。

例：`design.md` §8.1 的图标按钮是 `40×40`、无水平内边距、图标 `18px`、默认 `--nm-text-secondary`、active `--nm-color-primary`；§8.12 的 Tab 是下划线态、选中 `3px` 主色下划线且文字保持深色（不是胶囊、不是实色底）。

下拉、日期、时间、颜色这几类交互控件已有键盘可达的现成部件，见 [widgets.md](./widgets.md)，优先用它们而不是手写。

> 判断做得对不对：把模块截图和主应用同类组件并排看，颜色 · 字号 · 圆角 · 间距 · 状态是否完全一致。有任何一处「相近但数值不同」，就是没对齐——回 `design.md` 抠数字。

---

## 5. 两条铁律

- **禁止颜色字面量。** 不写 `#` / `rgb()` / `hsl()`，一律 `var(--nm-*)` 令牌，否则校验器拒绝安装且无法主题化。
- **禁止一切动效。** 不用任何 `transition`、`animation`、旋转、缩放、位移、淡入淡出、加载动画（`design.md` §5/§10）。所有状态即时切换。沙箱已全局 `animation:none / transition:none`，但 JS 逐帧改属性同样在禁止之列（`@motion animated` 例外，见 [runtime.md](./runtime.md)）。

另：图标用内联 SVG，不引远程资源。
