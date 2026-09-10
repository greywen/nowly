# 可选部件（键盘可达）

沙箱注入了一组原生 JS 部件，挂在 `Nowly` 命名空间上。它们已内置完整键盘导航、`role` / `aria-*` 语义与焦点管理，**比自己用 `<div>` 拼要可达得多**。除非有特殊需求，涉及下拉、日期、时间、颜色、分页时优先用它们。

每个工厂返回一个可直接 `root.appendChild(...)` 的元素，并带 `nowlyGetValue()` / `nowlySetValue(v)` 两个受控辅助方法。

| 工厂 | 用途 | 关键键位 |
|---|---|---|
| `Nowly.Select(opts)` | 单选下拉 | `Enter`/`Space`/`↓` 展开，`↑↓` 移动，`Enter` 选中，`Esc` 关闭 |
| `Nowly.Tabs(opts)` | 标签页 | `←→` 切换并激活，`Home`/`End` 跳首尾 |
| `Nowly.DatePicker(opts)` | 日期选择 | `Enter` 打开网格，`←→↑↓` 移动，`PageUp`/`PageDown` 翻月，`Enter` 选中 |
| `Nowly.TimePicker(opts)` | 时间选择 | 同 Select，按 `step` 分钟枚举时间 |
| `Nowly.ColorPicker(opts)` | 颜色色板 | 单选组，`←→↑↓` 移动并选中 |

## 参数

公共参数：`label`（可选，渲染为字段标签）、`value`（初始值）、`onChange(value)`（变更回调）。

专有参数：

- `Select`：`options`（`[{value,label}]`）。
- `TimePicker`：`step` 分钟数代替 `options`，默认 30。
- `Tabs`：`tabs`（`[{id,label,panel}]`，`panel` 可为字符串或 DOM 节点）。
- `DatePicker`：`value` 用 ISO `YYYY-MM-DD`，回调也回传同格式。
- `ColorPicker`：`swatches`（可选，`['#...']` 数组）。默认调色板已内置在部件内部，**你无需自己写颜色字面量**，也不会触发校验器。

```js
const sel = Nowly.Select({
  label: '优先级',
  options: [
    { value: 'low', label: '低' },
    { value: 'high', label: '高' }
  ],
  value: 'low',
  onChange(v) { host.saveState({ priority: v }); }
});
root.appendChild(sel);
```

部件相关的 CSS 类（`.nm-field-label` / `.nm-select*` / `.nm-tabs*` / `.nm-datepicker*` / `.nm-colorpicker*`）已随样式表注入，无需手写。

## 不用部件时的底线

用部件是**可选便利**，不是强制。但若自己实现下拉 / 日期这类交互，务必保证键盘可达（`Tab` 可聚焦、方向键可操作、`Esc` 可关闭）与 `aria-*` 语义，否则达不到 Nowly 的可达性基线。
