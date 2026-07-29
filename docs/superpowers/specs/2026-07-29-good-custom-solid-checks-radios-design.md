# Good Custom Solid Checkbox 与 Radio 设计规格

日期：2026-07-29

## 1. 目标

将 `docs/prototypes/nowly-final-uiux.html` 中所有 Checkbox 和 Radio 统一替换为 Good 官方 Checks and Radios 文档中的 Custom Solid 风格，并将该规则补充到根目录 `design.md`，作为以后所有页面和组件的强制表单控件规范。

参考页面：

`https://preview.keenthemes.com/html/good/docs/?page=base/forms/checks-radios`

## 2. 应用范围

本次覆盖原型中的全部 Checkbox 和 Radio：

- 四象限任务完成 Checkbox。
- 日程编辑中的全天事件 Checkbox。
- 任务编辑中的任务完成 Checkbox。
- 任务编辑中的所属象限 Radio。
- 便签编辑中的便签颜色 Radio。
- 便签编辑中的置顶便签 Checkbox。
- 设置中的显示周末 Checkbox。
- 设置中的模块显示 Checkbox。
- 设置中的登录 Windows 后自动启动 Checkbox。

不得保留浏览器默认 Checkbox 或 Radio 外观。

## 3. HTML 结构

所有带可见标签的 Checkbox 和 Radio 使用 Good 官方结构：

```html
<label class="form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="checkbox">
  <span class="form-check-label">选项文字</span>
</label>
```

Radio 使用相同结构，只将输入类型改为 `radio`：

```html
<label class="form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="radio" name="group-name">
  <span class="form-check-label">选项文字</span>
</label>
```

任务列表中已有独立文案结构时，`.form-check` 可只包裹输入控件，但输入必须使用 `.form-check-input`，且原有可访问名称必须保留。

## 4. 默认外观

### 4.1 共通规则

- 默认尺寸：`28×28px`，对应 Good 官方 `1.75rem`。
- 使用 `appearance: none` 清除浏览器原生外观。
- 控件不缩小：`flex-shrink: 0`。
- 控件与标签间距：`12px`。
- 未选中背景：`#F6F1E9`。
- 未选中边框：`0`。
- 控件本身默认无阴影。
- 标签文字：`15.2px / 500 / 1.5`，颜色 `#716D66`。
- 四象限任务中的任务文案继续使用现有任务层级，但控件本身仍为 `28×28px`。

### 4.2 Checkbox

- 圆角：`0.45em`，在 28px 尺寸下约为 `7.2px`。
- 选中背景：`#4FC9DA`。
- 选中标记：Good 官方白色对勾图形。
- 对勾居中显示，背景图尺寸为控件的 `60% 60%`。

### 4.3 Radio

- 圆角：`50%`。
- 选中背景：`#4FC9DA`。
- 选中标记：Good 官方白色实心圆点。
- 圆点居中显示。

## 5. 状态规则

### 5.1 Hover

- Hover 不改变尺寸、位置或缩放。
- 未选中控件背景可保持 `#F6F1E9`，标签文字改为 `#403D38`。
- 已选中控件保持主色背景。

### 5.2 Checked

- 背景与状态色为 `#4FC9DA`。
- Checkbox 显示白色对勾。
- Radio 显示白色圆点。
- 选择卡片可继续通过 `:has(input:checked)` 使用 `#DDF8FC` 背景和主色边框，但原生控件必须同时显示选中状态。

### 5.3 Focus-visible

Good 原始样式的普通 focus 无阴影，但本项目必须遵循 `design.md` 的键盘无障碍要求：

- 仅 `focus-visible` 显示 `0 0 0 4px rgba(79, 201, 218, 0.25)`。
- 普通鼠标点击 focus 不额外显示焦点环。
- 不使用焦点动画。

### 5.4 Disabled

- `pointer-events: none`。
- 透明度：`0.5`。
- 标签同步降低视觉权重。
- 禁用状态不得响应 hover。

### 5.5 Indeterminate

如以后使用不确定状态：

- 背景：`#4FC9DA`。
- 显示白色横线。
- 当前原型不新增不确定状态示例。

## 6. 动效限制

Good 原始表单控件中的任何 transition 均不引入本项目。

必须继续遵循全局规则：

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

Checkbox 和 Radio 的 checked、focus、disabled 状态即时切换。

## 7. 无障碍

- 保留原生 `<input type="checkbox">` 和 `<input type="radio">`，不使用 `div` 模拟控件。
- 每个控件必须通过包裹式 `<label>`、`for/id` 或 `aria-label` 获得可访问名称。
- Radio 组必须共享唯一 `name`。
- Fieldset 类型的选项组继续使用 `<fieldset>` 和 `<legend>`。
- 键盘 Space 可切换 Checkbox；方向键和 Space 可操作 Radio。
- 状态不能仅通过选择卡片背景表达，控件自身必须显示对勾或圆点。

## 8. 设计规范更新

在根目录 `design.md` 的组件样式章节中新增“Checkbox 与 Radio”小节，记录：

- 强制使用 Good Custom Solid 结构。
- 28px 默认尺寸。
- Checkbox `0.45em` 圆角。
- Radio `50%` 圆角。
- 未选中 `#F6F1E9`。
- 选中 `#4FC9DA` 与白色标记。
- 12px 标签间距。
- focus-visible 和 disabled 规则。
- 禁止浏览器默认外观与状态动效。

同时在新页面验收清单中加入 Checkbox/Radio 检查项。

## 9. 测试与验收

Playwright 增加以下自动化合同：

1. 原型内每个 Checkbox 和 Radio 都包含 `.form-check-input`。
2. 带可见标签的控件使用 `.form-check.form-check-custom.form-check-solid`。
3. 默认 Checkbox 计算尺寸为 `28×28px`。
4. 未选中控件背景为 `#F6F1E9`，且无边框。
5. Checkbox 圆角约为 `7.2px`。
6. Radio 圆角为 `50%` 视觉圆形。
7. Checkbox 选中后背景为 `#4FC9DA`，具有白色对勾背景图。
8. Radio 选中后背景为 `#4FC9DA`，具有白色圆点背景图。
9. disabled 透明度为 `0.5`。
10. 所有现有 Checkbox/Radio 的可访问名称和交互测试继续通过。
11. 全局无动效测试继续通过。
12. `1366×768` 到更大视口的无页面溢出测试继续通过。

## 10. 非目标

- 不引入 Bootstrap 或 Good 的完整 CSS/JavaScript Bundle。
- 不引入网络依赖。
- 不添加 Switch 组件。
- 不添加新的表单字段或业务逻辑。
- 不改变现有选项文案、Radio 分组语义或任务完成行为。
