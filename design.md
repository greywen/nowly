# Nowly 统一设计规范

## 0. 强制执行规则

1. **以后设计、开发或修改任何页面前，必须先完整阅读本文件。**
2. 所有新页面、弹窗、组件和状态都必须复用本文件的颜色、字体、间距、圆角、阴影和边框规则，不得创建视觉上相近但数值不同的样式。
3. 本规范优先于项目中早期文档、旧原型和旧设计 Token。旧代码中的 `#009EF7`、`#181C32`、`#7E8299` 等旧版蓝色体系不得用于新页面；涉及页面重构时应替换为本规范。
4. 本项目完全参考目标网页当前默认浅色风格，不擅自混入 Material Design、Ant Design、Apple、玻璃拟态、霓虹渐变或其他视觉语言。
5. **本项目禁用所有动效。** 不得使用 `transition`、`animation`、自动滚动、视差、缩放、旋转、位移、淡入淡出、骨架闪烁或加载旋转。所有状态即时切换。
6. hover、active、focus、disabled 等静态状态必须保留，但只允许即时改变颜色、背景、边框或阴影。
7. 若产品需求与本规范冲突，应先更新并确认本文件，再开始页面实现，禁止在单个页面中私自例外。

---

## 1. 设计基调

整体视觉关键词：**明亮、温暖、柔和、简洁、圆润、低对比边界、清晰层级**。

- 使用暖白和米灰，而不是冷蓝灰背景。
- 主操作色使用明亮青绿色，避免使用传统高饱和蓝色。
- 大面积区域保持安静，颜色主要用于操作、状态和少量强调。
- 卡片以边框建立层级，默认不依赖阴影。
- 标题使用深暖黑色，说明文字使用暖灰色。
- 控件和卡片采用统一的大圆角，不混用锐利直角。

---

## 2. 配色规范

### 2.1 品牌与功能色

| Token | 色值 | 用途 |
|---|---:|---|
| `color-primary` | `#4FC9DA` | 主按钮、当前导航、链接、选中状态、关键数据 |
| `color-primary-active` | `#30A6B6` | 主色控件按下/激活、链接激活 |
| `color-primary-hover` | `#69D1E0` | 主按钮 hover 背景 |
| `color-primary-light` | `#DDF8FC` | 主色浅背景、标签、选中项弱强调 |
| `color-primary-subtle` | `#DCF4F8` | 大面积主色提示背景 |
| `color-primary-border-subtle` | `#B9E9F0` | 主色浅色块边框 |
| `color-primary-inverse` | `#FFFFFF` | 青绿色背景上的反白文字与图标 |
| `color-success` | `#B8D935` | 成功、完成、正常状态 |
| `color-success-active` | `#9FBE22` | 成功状态激活 |
| `color-success-light` | `#F4FBDB` | 成功状态浅背景 |
| `color-info` | `#4F55DA` | 信息提示、辅助数据系列 |
| `color-info-active` | `#383EBC` | 信息状态激活 |
| `color-info-light` | `#EFF0FF` | 信息状态浅背景 |
| `color-warning` | `#E8C444` | 警告、待处理、需要注意 |
| `color-warning-active` | `#CFAB2A` | 警告状态激活 |
| `color-warning-light` | `#FDF4D6` | 警告状态浅背景 |
| `color-danger` | `#F06445` | 错误、删除、失败、高风险操作 |
| `color-danger-active` | `#DB5437` | 危险状态激活 |
| `color-danger-light` | `#FFF0ED` | 危险状态浅背景 |
| `color-dark` | `#1E2129` | 特殊深色按钮或高对比区域 |

功能色必须同时配合图标或文字表达含义，不得只靠颜色传递状态。

### 2.2 背景与表面色

| Token | 色值 | 用途 |
|---|---:|---|
| `bg-page` | `#FFFFFF` | 页面基础背景、Header 背景 |
| `bg-surface` | `#FFFFFF` | 卡片、弹窗、下拉菜单、表格表面 |
| `bg-subtle` | `#F8F6F2` | 页面分区、输入框 solid 背景、hover 背景 |
| `bg-secondary` | `#F6F1E9` | 次级模块、分组背景、滚动条 |
| `bg-neutral` | `#F9F9F9` | 中性按钮、弱强调区域 |
| `bg-overlay` | `rgba(0, 0, 0, 0.20)` | 抽屉/弹窗遮罩 |
| `bg-hover` | `#F8F6F2` | 导航、菜单及中性组件 hover |
| `bg-input-focus` | `#F6F1E9` | Solid 输入框聚焦背景 |

不得用纯冷灰 `#F5F8FA` 代替暖灰背景，也不得给普通页面增加未经定义的渐变背景。

### 2.3 文字与图标色

| Token | 色值 | 用途 |
|---|---:|---|
| `text-primary` | `#211F1C` | 页面标题、卡片标题、正文重点 |
| `text-strong` | `#403D38` | 控件文字、正文、强辅助信息 |
| `text-secondary` | `#716D66` | 普通正文、导航默认文字 |
| `text-tertiary` | `#8E887A` | 次级说明、非关键图标 |
| `text-muted` | `#968E7E` | 占位符、时间、元信息、弱说明 |
| `text-disabled` | `#B5B0A1` | 禁用文字、不可用图标 |
| `text-inverse` | `#FFFFFF` | 深色或功能色背景上的文字 |
| `text-link` | `#4FC9DA` | 链接 |
| `text-link-active` | `#30A6B6` | 链接 hover/active |

正文默认使用 `text-secondary` 或 `text-strong`；不得使用低于可读对比度的浅色承载关键信息。

### 2.4 灰阶

| 等级 | 色值 |
|---|---:|
| Gray 100 | `#F8F6F2` |
| Gray 200 | `#F6F1E9` |
| Gray 300 | `#DAD3C3` |
| Gray 400 | `#B5B0A1` |
| Gray 500 | `#968E7E` |
| Gray 600 | `#8E887A` |
| Gray 700 | `#716D66` |
| Gray 800 | `#403D38` |
| Gray 900 | `#211F1C` |

### 2.5 边框与焦点色

| Token | 色值 | 用途 |
|---|---:|---|
| `border-default` | `#EAEAEA` | 卡片、输入框、分隔线、导航边界 |
| `border-subtle` | `#F6F1E9` | 极弱分隔线 |
| `border-emphasis` | `#DAD3C3` | 需要更明显边界的中性控件 |
| `focus-ring` | `rgba(79, 201, 218, 0.25)` | 键盘焦点环 |

---

## 3. 字体规范

### 3.1 字体家族

```css
font-family: Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif;
```

- 英文和数字首选 `Inter`。
- Windows 中文首选 `Microsoft YaHei`，macOS 中文首选 `PingFang SC`。
- 若项目允许加载 Web Font，Inter 字重只加载 `300、400、500、600、700`。
- 禁止在同一页面混用衬线体、手写体或装饰字体。

### 3.2 字重

| Token | 字重 | 用途 |
|---|---:|---|
| `font-light` | `300` | 仅用于超大数字或装饰性轻文字 |
| `font-regular` | `400` | 正文、说明文本 |
| `font-medium` | `500` | 按钮、输入框、导航、标签 |
| `font-semibold` | `600` | 卡片标题、重点文本、当前导航 |
| `font-bold` | `700` | 页面标题、关键数据；控制使用频率 |

### 3.3 字号、字重与行高

目标网页使用 `1rem = 16px`，正文基准行高为 `1.5`。新页面按以下语义层级使用：

| 层级 | 字号 | 字重 | 行高 | 用途 |
|---|---:|---:|---:|---|
| Display | `28px` (`1.75rem`) | `700` | `1.25`（35px） | 仪表盘关键数字、少量大标题 |
| H1 / 页面标题 | `24px` (`1.5rem`) | `700` | `1.3`（31.2px） | 页面主标题 |
| H2 / 大模块标题 | `21.6px` (`1.35rem`) | `700` | `1.35`（29.2px） | 一级模块标题 |
| H3 / 卡片主标题 | `20px` (`1.25rem`) | `600–700` | `1.4`（28px） | 卡片或弹窗标题 |
| H4 / 小节标题 | `18.4px` (`1.15rem`) | `600` | `1.4`（25.8px） | 卡片内分组标题 |
| Body Large | `17.2px` (`1.075rem`) | `400–600` | `1.5`（25.8px） | 强调正文、主要列表项 |
| Body / 正文 | `16px` (`1rem`) | `400` | `1.5`（24px） | 默认正文、表单输入 |
| Body Small | `15.2px` (`0.95rem`) | `400–600` | `1.5`（22.8px） | 按钮、表格、次级正文 |
| Caption | `13.6px` (`0.85rem`) | `400–600` | `1.5`（20.4px） | 时间、标签、辅助说明 |

规则：

- 页面中只能按语义使用以上层级，不得随意使用 14px、18px、22px 等相近值替代。
- 标题默认 `text-primary`；正文默认 `text-secondary`；说明文字默认 `text-muted`。
- 标题不强制全大写，不增加额外字符间距。
- 单行按钮和输入框保持 `line-height: 1.5`。
- 中文长正文每行建议控制在 35–45 个汉字，避免横向阅读距离过长。

---

## 4. 间距规范

### 4.1 基础间距刻度

使用 `4px` 为基础网格：

| Token | 数值 | 典型用途 |
|---|---:|---|
| `space-0` | `0` | 无间距 |
| `space-1` | `4px` | 图标内部微间距、紧凑元素 |
| `space-2` | `8px` | 图标与文字、紧凑列表项 |
| `space-3` | `12px` | 小控件、标签组、紧凑内边距 |
| `space-4` | `16px` | 标准元素间距、小卡片内边距 |
| `space-5` | `20px` | 表单字段之间 |
| `space-6` | `24px` | 模块内分组、按钮水平内边距 |
| `space-7` | `28px` | 卡片 Header 高密度留白 |
| `space-8` | `32px` | 标准卡片垂直内边距 |
| `space-9` | `36px` | 标准卡片水平内边距 |
| `space-10` | `40px` | 大模块间距 |
| `space-12` | `48px` | 页面主要分区间距 |
| `space-16` | `64px` | 大屏页面外部留白 |

### 4.2 页面与模块间距

- 页面内容区桌面端水平内边距：`32–40px`，优先使用 `36px`。
- 页面内容区移动端水平内边距：`16px`。
- 页面标题与首个内容模块：`24px`。
- 同级卡片之间：`24px`；紧凑仪表盘可使用 `20px`，不得低于 `16px`。
- 大分区之间：`32–40px`。
- 表单字段纵向间距：`20px`。
- 标签与输入框间距：`8px`。
- 标题与说明文字间距：`4–8px`。
- 图标与文本间距：`8–12px`。
- 并排按钮间距：`8px`；主次操作组建议 `8–12px`。
- 列表项标准垂直内边距：`12–16px`。

### 4.3 卡片间距

目标网页卡片的标准结构：

- Card Header 最小高度：`70px`。
- Card Header 水平内边距：`36px`。
- Card Body：`32px 36px`。
- 紧凑卡片可使用：`24px`。
- Card Footer：建议 `20–24px 36px`，并与 Body 对齐。
- 卡片内部一级分组之间：`24–32px`。

同一页面的同级卡片必须使用相同内边距，不得出现 20px、24px、30px、32px 的无规则混用。

---

## 5. 圆角规范

目标网页基础圆角为 `0.95rem = 15.2px`，必须保留该精确值。

| Token | 数值 | 用途 |
|---|---:|---|
| `radius-sm` | `7.6px` (`0.475rem`) | 小标签、紧凑徽标、局部小元素 |
| `radius-md` | `10px` (`0.625rem`) | 小型图标容器、特殊紧凑控件 |
| `radius-default` | `15.2px` (`0.95rem`) | 按钮、输入框、卡片、导航项 |
| `radius-lg` | `16px` (`1rem`) | 大型图片、特殊大容器 |
| `radius-xl` | `32px` (`2rem`) | 极少数大面积装饰容器 |
| `radius-pill` | `999px` | 胶囊标签、状态徽标、头像 |

规则：

- 普通按钮、输入框、卡片默认统一使用 `15.2px`。
- 不得在同一组件族中混用 8px、12px、16px 圆角。
- 圆形图标按钮使用 `50%`，胶囊按钮使用 `999px`。
- 卡片内嵌图片应匹配卡片内圆角，避免图片直角突出。

---

## 6. 阴影规范

Good 当前页面普通卡片默认不使用阴影，主要依靠 `1px` 边框建立层级。

| Token | 数值 | 用途 |
|---|---|---|
| `shadow-none` | `none` | 普通卡片、按钮、输入框 |
| `shadow-xs` | `0 1.6px 12px 4px rgba(0, 0, 0, 0.05)` | 轻浮起的小控件 |
| `shadow-sm` | `0 1.6px 16px 4px rgba(0, 0, 0, 0.05)` | 悬浮工具条、小浮层 |
| `shadow-md` | `0 8px 24px 8px rgba(0, 0, 0, 0.075)` | 抽屉、较高层级面板 |
| `shadow-lg` | `0 16px 32px 16px rgba(0, 0, 0, 0.10)` | 模态框等最高层级 |
| `shadow-dropdown` | `0 0 50px 0 rgba(82, 63, 105, 0.15)` | 下拉菜单、Popover |
| `shadow-tooltip` | `0 0 30px rgba(0, 0, 0, 0.15)` | Tooltip |
| `shadow-focus` | `0 0 0 4px rgba(79, 201, 218, 0.25)` | 键盘焦点 |

规则：

- 普通卡片禁止加 `shadow-md` 或 `shadow-lg`。
- 同一组件只能使用一个预定义阴影，不得叠加自定义多层阴影。
- 阴影不是 hover 动效；普通卡片 hover 时也不得突然增加阴影。

---

## 7. 边框规范

- 默认边框：`1px solid #EAEAEA`。
- 弱分隔线：`1px solid #F6F1E9`。
- 卡片内部 Header 分隔可使用：`1px dashed #EAEAEA`；若 Card Header 与 Body 视觉连续，则不显示分隔线。
- 虚线边框只用于上传区、空状态、可添加区域或目标网页中同类语义，不用于普通信息卡片。
- 激活/选中边框：`1px solid #4FC9DA`。
- 错误边框：`1px solid #F06445`。
- 成功边框：`1px solid #B8D935`。
- 禁止使用 2px 以上粗边框作为普通装饰。

---

## 8. 组件样式

### 8.1 按钮

#### 默认尺寸

- 操作型文字按钮固定高度：`40px`，并使用 `box-sizing: border-box`。
- 标准内边距：`8px 24px`；紧凑布局可将水平内边距降为 `16px`，高度保持 `40px`。
- 日期格、事件块、任务标题、链接型按钮和其他内容型可点击元素不适用此固定高度。
- 字号：`16px`。
- 字重：`500`。
- 行高：`1.5`。
- 圆角：`15.2px`。
- 边框：`1px solid transparent`。
- 阴影：`none`。

#### 小按钮

- 高度：`40px`。
- 内边距：`8px 16px`。
- 字号：`15.2px`。
- 字重：`500–700`，页面内保持统一。
- 圆角：`15.2px`。

#### 主按钮

- 默认：背景 `#4FC9DA`，边框 `#4FC9DA`，文字 `#FFFFFF`。
- hover：背景 `#69D1E0`，边框 `#61CEDE`，文字保持白色。
- active：背景 `#30A6B6`，边框 `#30A6B6`。
- focus-visible：增加 `0 0 0 4px rgba(79, 201, 218, 0.25)`。
- disabled：保留主色但透明度 `0.65`，禁止交互。

#### 次按钮

- 背景：`#F8F6F2` 或 `#F9F9F9`。
- 文字：`#403D38`。
- hover/active：背景 `#F6F1E9`，文字可变为 `#4FC9DA`。
- 默认不加阴影。

#### 描边按钮

- 背景：`transparent` 或 `#FFFFFF`。
- 边框：`1px solid #EAEAEA`。
- 文字：`#716D66`。
- hover/active：背景 `#F8F6F2`，边框 `#DAD3C3`，文字 `#4FC9DA`。

#### 危险按钮

- 背景与边框：`#F06445`。
- 文字：`#FFFFFF`。
- active：`#DB5437`。
- 只用于删除、移除和不可逆操作，不用作普通强调。

#### 图标按钮

- 操作型图标按钮统一尺寸：`40×40px`，所有响应式布局保持不变。
- 正方形按钮不使用文本按钮的水平内边距。
- 圆角默认 `15.2px`；头像/悬浮圆形操作才使用 `50%`。
- 图标默认 `#716D66`，active 使用 `#4FC9DA`。
- 所有图标按钮必须有可访问名称。

### 8.2 卡片

- 背景：`#FFFFFF`。
- 边框：`1px solid #EAEAEA`。
- 圆角：`15.2px`。
- 默认阴影：`none`。
- Header 最小高度：`70px`。
- Header 水平内边距：`36px`。
- Body 内边距：`32px 36px`。
- 卡片标题：`18.4–20px`、`600–700`、`#211F1C`。
- 卡片说明：`13.6–15.2px`、`400–600`、`#968E7E`。
- Card Header 与 Body 默认可无分隔线；信息密集型卡片使用 `1px dashed #EAEAEA`。
- 禁止给普通卡片加渐变描边、玻璃模糊、彩色外发光或厚重阴影。
- 同一行卡片尽量等高，标题和操作区对齐。

### 8.3 顶部导航栏（Header）

- 默认高度：`70px`。
- 背景：`#FFFFFF`。
- 下边界：`1px solid #EAEAEA`；若布局通过留白已清晰分层，可不使用阴影。
- 阴影：默认 `none`，固定并覆盖内容时最多使用 `shadow-xs`。
- 内容水平内边距：桌面端 `32–36px`，移动端 `16px`。
- 页面标题：`21.6px`、`700`、`#211F1C`。
- 标题说明：`13.6px`、`600`、`#968E7E`。
- 导航操作之间间距：`8–16px`。
- 顶部栏不得使用大面积主色背景；主色只用于关键按钮、选中项或图标状态。

### 8.4 侧边导航栏（Sidebar）

- 目标网页桌面标准宽度：`300px`；紧凑布局可使用 `250px`，同一产品中不可随页面随机变化。
- 背景：`#FFFFFF` 或与页面分区一致的 `#F8F6F2`；本项目默认优先 `#FFFFFF`。
- 右边界：`1px solid #EAEAEA`。
- 导航项圆角：`15.2px`。
- 导航项左右内边距：`16px`；上下内边距：`10–12px`。
- 导航项间距：`4–8px`。
- 默认文字：`#716D66`，图标：`#8E887A`。
- hover：背景 `#F8F6F2`，文字和图标 `#4FC9DA`。
- active：背景 `#F8F6F2` 或 `#DDF8FC`，文字和图标 `#4FC9DA`，字重 `600`。
- 禁止通过滑动条、位移动画或缩放反馈当前项。

### 8.5 输入框与表单控件

- 字号：`16px`；紧凑表单可用 `15.2px`。
- 字重：`400–500`。
- 文字：`#716D66`。
- 占位符：`#968E7E`。
- 背景：`#FFFFFF`；Solid 变体使用 `#F8F6F2`。
- 边框：`1px solid #EAEAEA`。
- 圆角：`15.2px`。
- 标准高度建议：`44–48px`。
- 左右内边距：`16px`。
- focus：边框 `#4FC9DA`，焦点环 `0 0 0 4px rgba(79, 201, 218, 0.25)`；Solid 变体背景改为 `#F6F1E9`。
- error：边框 `#F06445`，错误说明使用 `#F06445` 与 `13.6px`。
- disabled：背景 `#F8F6F2`，文字 `#B5B0A1`，透明度 `0.65`。

### 8.6 Checkbox 与 Radio

所有 Checkbox 和 Radio 必须采用 Good Custom Solid 样式，禁止使用浏览器默认外观或其他组件库视觉。

标准结构：

```html
<label class="form-check form-check-custom form-check-solid">
  <input class="form-check-input" type="checkbox">
  <span class="form-check-label">选项文字</span>
</label>
```

- 默认尺寸：`28×28px`（`1.75rem`），且 `flex-shrink: 0`。
- 使用 `appearance: none` 清除浏览器默认外观。
- 控件与标签间距：`12px`。
- 标签：`15.2px / 500 / 1.5`，颜色 `#716D66`。
- 未选中背景：`#DAD3C3`，无边框、无阴影；该增强中性灰确保控件在所有浅色模块背景上均清晰可见。
- 选中背景：`#4FC9DA`。
- Checkbox 圆角：`0.45em`，28px 下约为 `7.2px`；选中时显示 Good 白色对勾。
- Radio 圆角：`50%`；选中时显示 Good 白色实心圆点。
- `focus-visible`：`0 0 0 4px rgba(79, 201, 218, 0.25)`；普通鼠标 focus 不显示额外阴影。
- disabled：`pointer-events: none`、透明度 `0.5`，标签同步使用禁用文字色。
- Fieldset 选项组必须保留 `<fieldset>` 与 `<legend>`；Radio 组必须共享唯一 `name`。
- 必须保留原生 `<input>`，不得使用 `div`、图标或 JavaScript 模拟控件。
- checked、focus、disabled 等状态即时切换，不得添加 transition 或 animation。

### 8.7 日期选择器

弹窗中的单日期字段采用 Good Date Range Picker 的 `singleDatePicker` 视觉语言，但必须以离线原生实现交付，不依赖 jQuery、Moment.js、CDN 或浏览器原生 `type="date"` 面板。

- 触发控件使用 Good Solid 输入外观：`48px` 高、`#F8F6F2` 背景、透明边框、`15.2px` 圆角和 `16px` 水平内边距。
- 触发控件文字：`16px / 400 / 1.5`、`#716D66`；右侧使用 `18px` 线性日历图标。
- 日期面板宽度：`320px`，白色背景、无边框、`15.2px` 圆角。
- 日期面板阴影：`0 0 50px 0 rgba(82, 63, 105, 0.15)`。
- 日期面板采用周一开始的 6×7 网格，始终显示 42 个日期。
- 日期按钮最小 `36×36px`，`13.6px / 500`，圆角 `15.2px`。
- Hover：`#F8F6F2` 背景与 `#4FC9DA` 文字。
- 已选日期：`#4FC9DA` 背景与白色文字。
- 今天但未选中：`#F6F1E9` 背景与 `#716D66` 文字。
- 非当前月日期：透明背景与 `#968E7E` 文字。
- 面板支持前后月份、今天、清除、点击外部和 Esc 关闭。
- 键盘支持方向键移动日期、PageUp/PageDown 切月、Enter/Space 选择。
- 触发控件使用 `aria-haspopup="dialog"` 和 `aria-expanded`；面板使用 `role="dialog"`，网格提供列标题、完整日期名称、`aria-selected` 和 `aria-current="date"`。
- 面板打开、关闭和月份变化必须即时完成，禁止任何 transition 或 animation。

### 8.8 时间选择器

时间字段采用 Good Flatpickr `enableTime + noCalendar` 的视觉语言，但必须离线原生实现，不依赖 Flatpickr、jQuery、Moment.js、CDN 或浏览器原生 `type="time"` 面板。

- 触发控件：`48px` 高、`#F8F6F2` 背景、透明边框、`15.2px` 圆角、`16px` 水平内边距。
- 时间文字：`16px / 400 / 1.5`、`#716D66`；右侧使用 `18px` 时钟图标。
- 采用 24 小时制；小时 `00–23`，分钟 `00–55`，分钟步长 `5`。
- 开始时间和结束时间共用一个 `280px` 白色面板。
- 面板无边框、圆角 `15.2px`，阴影 `0 0 50px 0 rgba(82, 63, 105, 0.15)`。
- 小时和分钟各使用独立步进器；当前值使用 `28px / 700`，置于至少 `64×56px` 的浅色容器中。
- 增减按钮为 `35×35px`；小时独立循环，分钟按 5 分钟独立循环。
- 提供 `09:00`、`09:30`、`12:00`、`14:00`、`15:00`、`18:00` 六个快捷时间。
- Footer 提供“清除”和“现在”；演示原型中的“现在”固定为 `09:40`，避免环境时间导致展示不稳定。
- 日期面板与时间面板互斥；点击外部、Esc 或关闭父弹窗时关闭，并正确归还焦点。
- 小时和分钟使用 `role="spinbutton"` 及正确的 `aria-valuemin`、`aria-valuemax`、`aria-valuenow`。
- 键盘支持 ArrowUp/Down、PageUp/PageDown、Home、End 和 Enter。
- 面板不得覆盖业务弹窗 Header 或超出业务弹窗左右边界。
- 所有状态即时切换，禁止 transition、animation 或数字翻转效果。

### 8.9 标签与状态徽标

- 字号：`13.6–15.2px`。
- 字重：`500–600`。
- 内边距：`4–8px 8–12px`。
- 圆角：小标签使用 `7.6px`，胶囊标签使用 `999px`。
- 功能色标签优先采用“浅背景 + 深色文字/图标”，避免大面积高饱和实色。
- 主色标签：背景 `#DDF8FC`，文字 `#30A6B6`。
- 成功标签：背景 `#F4FBDB`，文字 `#9FBE22`。
- 信息标签：背景 `#EFF0FF`，文字 `#383EBC`。
- 警告标签：背景 `#FDF4D6`，文字使用足够对比度的深暖色。
- 危险标签：背景 `#FFF0ED`，文字 `#DB5437`。

### 8.10 下拉菜单与浮层

- 背景：`#FFFFFF`。
- 边框：`1px solid #EAEAEA`，可在阴影足够清晰时省略。
- 圆角：`15.2px`。
- 阴影：`0 0 50px 0 rgba(82, 63, 105, 0.15)`。
- 内边距：`12–16px`。
- 菜单项圆角：`7.6–15.2px`，同一菜单内统一。
- 菜单项 hover：背景 `#F8F6F2`，文字 `#4FC9DA`。
- 不使用展开、缩放或淡入动效，显示与隐藏必须即时完成。

### 8.11 模态框

- 表面：`#FFFFFF`。
- 圆角：`15.2px`。
- 边框：`1px solid #EAEAEA`。
- 阴影：`shadow-lg`。
- 遮罩：`rgba(0, 0, 0, 0.20)`。
- Header、Body、Footer 水平内边距统一为 `32–36px`。
- Header 和 Footer 使用边框分隔时采用 `#EAEAEA`。
- 打开和关闭不得使用淡入、缩放、位移等动效。

### 8.12 Tab 标签页

全局唯一的 Tab 形态为**下划线标签页**（对应目标网页 `All Campaigns / Pending / Completed`）。禁止再出现胶囊 Tab、分段控件底色 Tab、卡片式 Tab 或药丸实色 Tab 作为分区切换。

标签条：

- 布局：横向排列，标签之间间距 `32px`。
- 底部基线：`2px solid #EAEAEA`，贯穿整个标签条宽度。
- 标签条自身无背景色、无圆角、无内边距底色块。

标签项：

- 背景：`transparent`（任何状态下都不加背景块）。
- 内边距：`0 0 12px`。
- 字号：`15.2px`，字重 `600`，行高 `1.5`。
- 下边框：`2px solid transparent`，并以 `margin-bottom: -2px` 压住标签条基线。
- 默认文字：`#716D66`。
- hover：文字 `#4FC9DA`，下边框仍为 transparent。
- 选中：文字 `#4FC9DA`，下边框 `2px solid #4FC9DA`。
- disabled：文字 `#B5B0A1`，不响应交互。
- focus-visible：`0 0 0 4px rgba(79, 201, 218, 0.25)`。
- 计数后缀（如 `(47)`）：字重 `500`，默认 `#968E7E`，选中时继承主色。

该 `2px` 下划线是 §7 中唯一允许的粗边框例外，仅用于 Tab 标签条基线与选中态；选中线与基线必须同为 `2px`，禁止一粗一细。

规则：

- 标签条与其下方内容之间留 `24px` 间距。
- 标签必须使用 `role="tablist"` / `role="tab"` / `role="tabpanel"`，并支持左右方向键切换。
- 切换即时完成，禁止滑动指示条、淡入或高度过渡。
- 应用设置和各模块设置必须使用同一套 Tab 实现，不得各自复刻近似样式。

---

## 9. 静态交互状态

每个可交互组件必须具备以下状态，且状态改变即时生效：

1. **Default**：遵循组件基础样式。
2. **Hover**：只改变背景、文字、图标、边框或阴影；不得改变尺寸和位置。
3. **Active/Selected**：使用 `#4FC9DA`、`#30A6B6` 或浅主色背景表达当前状态。
4. **Focus-visible**：使用 `4px` 半透明青绿色焦点环，不能只依靠颜色极弱的边框。
5. **Disabled**：透明度 `0.65`，移除交互能力，不能仅改变鼠标指针。
6. **Error**：使用危险色边框、图标及文字说明。
7. **Loading**：若必须显示加载状态，只允许静态文案或静态占位，不使用旋转、脉冲、闪烁或骨架动画。

---

## 10. 禁止动效

全局实现必须包含等效于以下规则的静态约束：

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

禁止项包括但不限于：

- CSS `animation`、`transition`。
- JS 驱动的补间动画。
- 页面切换淡入淡出。
- 卡片 hover 上浮或缩放。
- 按钮点击缩放。
- 菜单展开/收起过渡。
- 模态框渐显、缩放、位移。
- Loading Spinner、进度条循环动画、Skeleton shimmer。
- 自动轮播、视差滚动、平滑滚动。
- 图标旋转或路径描边动画。

允许即时更新 hover、active、focus、selected、expanded、checked 等静态视觉状态。

---

## 11. 图标与图形

- 使用统一的 KeenIcons 风格或项目既有的 Lucide 线性图标。
- 同一页面只能使用一种图标体系。
- 默认图标尺寸：`16px`、`18px`、`20px`、`24px`。
- 默认线性图标粗细保持一致；不得混用实心、卡通、Emoji 和不同笔画风格。
- 图标默认使用 `#8E887A` 或 `#716D66`，强调图标使用功能色。
- 图标不得代替所有文字；不熟悉的操作必须提供文本或 Tooltip。

---

## 12. 响应式与一致性

- 桌面端优先复刻目标网页的信息密度和留白。
- 移动端缩减的是页面外边距和列数，不得随意缩小正文至 14px 以下。
- 移动端页面边距为 `16px`，卡片间距为 `16px`，卡片内边距可降为 `20–24px`。
- Header 移动端高度仍以 `70px` 为基准。
- 多列卡片在空间不足时改为单列，不强行压缩组件。
- 同一语义的组件在所有页面必须有相同颜色、字号、圆角、边框和状态规则。

---

## 13. 推荐设计 Token

实现时应建立统一 Token，不在组件中散落硬编码值：

```css
:root {
  --color-primary: #4fc9da;
  --color-primary-active: #30a6b6;
  --color-primary-hover: #69d1e0;
  --color-primary-light: #ddf8fc;

  --color-success: #b8d935;
  --color-info: #4f55da;
  --color-warning: #e8c444;
  --color-danger: #f06445;

  --bg-page: #ffffff;
  --bg-surface: #ffffff;
  --bg-subtle: #f8f6f2;
  --bg-secondary: #f6f1e9;

  --text-primary: #211f1c;
  --text-strong: #403d38;
  --text-secondary: #716d66;
  --text-tertiary: #8e887a;
  --text-muted: #968e7e;
  --text-disabled: #b5b0a1;

  --border-default: #eaeaea;
  --focus-ring: rgba(79, 201, 218, 0.25);

  --radius-sm: 0.475rem;
  --radius-default: 0.95rem;
  --radius-lg: 1rem;
  --radius-pill: 999px;

  --shadow-xs: 0 0.1rem 0.75rem 0.25rem rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 0.1rem 1rem 0.25rem rgba(0, 0, 0, 0.05);
  --shadow-md: 0 0.5rem 1.5rem 0.5rem rgba(0, 0, 0, 0.075);
  --shadow-lg: 0 1rem 2rem 1rem rgba(0, 0, 0, 0.1);
  --shadow-dropdown: 0 0 50px 0 rgba(82, 63, 105, 0.15);

  --font-sans: Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif;
}
```

---
