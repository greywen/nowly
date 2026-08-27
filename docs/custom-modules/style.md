# nm-* 样式参考

沙箱注入了一份从 `styles.css` 生成的样式表。**你看不到父页面的 CSS**，但可以直接用下面的 `--nm-*` 令牌和 `nm-*` 语义类。**禁止写颜色字面量**（校验器会拒），一律用令牌。

## 令牌（节选，全部以 `--nm-` 为前缀）

| 用途 | 令牌 |
|---|---|
| 主色 / hover / active / 浅底 | `--nm-color-primary` / `--nm-color-primary-hover` / `--nm-color-primary-active` / `--nm-color-primary-light` |
| 成功 / 警告 / 危险 | `--nm-color-success` / `--nm-color-warning` / `--nm-color-danger` |
| 标题 / 正文 / 弱说明 | `--nm-text-primary` / `--nm-text-secondary` / `--nm-text-muted` |
| 表面 / 浅底 / 边框 | `--nm-bg-surface` / `--nm-bg-subtle` / `--nm-border-default` |
| 圆角 小 / 默认 / 胶囊 | `--nm-radius-sm` / `--nm-radius-default` / `--nm-radius-pill` |
| 焦点环 | `--nm-shadow-focus` |
| 字体 | `--nm-font-sans` |

## 语义类

- `.nm-card` 卡片容器（边框 + 圆角 + 表面底色）
- `.nm-title` / `.nm-text` / `.nm-muted` 文本层级
- `.nm-btn`（默认）/ `.nm-btn--primary` / `.nm-btn--danger`
- `.nm-input` 输入框
- `.nm-tag` 胶囊标签
- `.nm-list` 无样式列表
- `.nm-empty` 空状态
- `.nm-msg` / `.nm-msg--danger` 消息条

## 可选部件（原生 JS，随样式表注入）

`Nowly` 命名空间除 `defineModule` 外，还提供五个键盘可达的部件工厂，样式已内置。用它们可避免自己实现「能点但键盘不可达」的控件。详细用法见 SKILL.md §3.5。

- `Nowly.Select({ label, options, value, onChange })` 下拉选择（`role=combobox` + `listbox`）
- `Nowly.Tabs({ tabs, value, onChange })` 标签页（`role=tablist`，方向键滚动选择）
- `Nowly.DatePicker({ label, value, onChange })` 日期选择（`role=grid` 月历，方向键导航）
- `Nowly.TimePicker({ label, value, step, onChange })` 时间选择（按 `step` 分钟列出）
- `Nowly.ColorPicker({ label, value, swatches, onChange })` 颜色选择（`role=radiogroup` 色板）

每个部件返回一个 DOM 元素，`append` 到你的容器即可，并带 `nowlyGetValue()` / `nowlySetValue(v)` 便于受控使用。部件相关类：`.nm-field-label` / `.nm-select*` / `.nm-tabs*` / `.nm-datepicker*` / `.nm-colorpicker*`，无需手写。

## 规矩

- 只用 `var(--nm-*)`，不写 `#`、`rgb()`、`hsl()`。
- 不加 `transition` / `animation` / 任何补间。状态即时切换。
- 图标用内联 SVG，不引远程资源。
