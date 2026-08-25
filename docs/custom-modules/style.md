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

## 规矩

- 只用 `var(--nm-*)`，不写 `#`、`rgb()`、`hsl()`。
- 不加 `transition` / `animation` / 任何补间。状态即时切换。
- 图标用内联 SVG，不引远程资源。
