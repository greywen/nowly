---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# 编写 Nowly 自定义模块

Nowly 的自定义模块是**一个自描述的 `.js` 文件**。用户可以在 App 里上传本地文件，或从"模块市场"下载安装。安装后，模块会成为 12×8 网格上一个可自由摆放的组件，和内置的日历 / 四象限 / 便签 / 看板一样。

这份规范告诉你如何写出一个**合法、可发布、样式合规**的模块。请完整阅读后再动手。

**配套文件：** [`../../design.md`](../../design.md)（**设计系统的唯一真相**，颜色/字体/间距/圆角/阴影/组件的确切数值都在这里，写任何样式前必读）· [style.md](./style.md)（`nm-*` 令牌与语义类）· [size.md](./size.md)（尺寸与断点）· [preview.md](./preview.md)（实时预览工作台）· [install/AGENTS.md](./install/AGENTS.md)（给 AI 工具的入口与工作流）。

---

## 0. 硬性约束（最容易踩的坑）

模块运行在一个**隔离的 iframe 沙箱**里（`sandbox="allow-scripts"`，null origin，CSP `default-src 'none'`）。这意味着：

1. **不能 `import`、不能用 npm、不能用 React / JSX / TypeScript。** 必须是一个自包含的**纯 JavaScript 文件**。
2. **不能直接访问网络。** 没有 `fetch`、`XMLHttpRequest`、`WebSocket`。要联网只能用 `host.fetch`（见下文），且需声明权限和域名白名单。
3. **不能访问父页面 DOM、`localStorage`、`cookie`、Tauri。** 你的世界只有传进来的 `host` 和 `root` 两个对象。
4. **不能加载远程脚本、字体、图片。** CSP 会拦截。要显示图标就用文字或内联 SVG。
5. **渲染靠手动操作 DOM。** 你拿到一个 `root` 元素，用 `document.createElement` 往里塞节点。
6. **颜色只能用 `var(--nm-*)` 令牌，禁止任何 `#` / `rgb()` / `hsl()` 字面量。** 校验器会拒绝含颜色字面量的模块。沙箱已注入一份从应用 `styles.css` 生成的样式表，令牌与 `nm-*` 语义类可直接用，详见 [style.md](./style.md)。
7. **循环必须有明确边界。** `while (true)` / `for (;;)` 会被校验器拒绝，且死循环会冻结整个应用（用户只能去任务管理器杀进程）。
8. **纯图标按钮必须带 `aria-label`。** 只含内联 `<svg>`、没有可读文字的 `<button>`，必须加 `aria-label`（或 `aria-labelledby`、`title`，或 svg 内 `<title>`）说明用途，否则读屏软件读不出。带文字的按钮无需额外标注。**注意校验器只能静态抓到 HTML 字符串形式**（如 `root.innerHTML = '<button><svg>…'`）；用 `document.createElement` / `createElementNS` 命令式构建的按钮它扫不到，也就是说漏了这条不一定报错——请自觉遵守，这是可达性底线，不是靠校验器兜底。
9. **源码体积有上限（256 KiB）。** 单个模块文件超过 256 KiB 会被拒绝。第三方库只能内联、图标用内联 SVG，但要克制——真需要大体积依赖的功能不适合做成沙箱模块。

违反其中任何一条，模块要么安装失败，要么运行时报错。

---

## 1. 模块文件结构

一个模块文件由两部分组成：**清单头**（顶部块注释）+ **模块代码**（`Nowly.defineModule` 调用）。

```js
/**
 * @nowly-module 1
 * @id           weather-widget
 * @name         天气
 * @version      1.0.0
 * @author       yourname
 * @description  显示当前城市的实时天气
 * @permissions  state, today, network
 * @network      api.open-meteo.com
 * @minSize      3x3
 * @defaultSize  4x4
 */
Nowly.defineModule(async ({ host, root }) => {
  // 你的代码
});
```

### 清单头字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `@nowly-module` | 是 | 清单版本号，当前恒为 `1` |
| `@id` | 是 | 稳定标识，只能是小写字母、数字、连字符（`[a-z0-9-]`）。用于去重和升级 |
| `@name` | 是 | 显示名称 |
| `@version` | 是 | 语义化版本号，如 `1.0.0`，用于市场的更新检测 |
| `@author` | 否 | 作者名 |
| `@description` | 否 | 一句话描述 |
| `@permissions` | 否 | `state` / `today` / `network`，逗号分隔。不声明就没有对应能力 |
| `@network` | 声明 network 时**必填** | 允许访问的域名，逗号分隔。`host.fetch` 只放行这些域名 |
| `@minSize` | 否 | 最小尺寸 `宽x高`（格数），默认 `2x2` |
| `@defaultSize` | 否 | 初始尺寸 `宽x高`（格数），默认 `4x4`。宽 2–12，高 2–8 |
| `@motion` | 否 | `static`（默认）或 `animated`。声明 `animated` 表示内容区有持续动效，安装时会告知用户，且**必须**响应可见性暂停（见 §2、§10 修订） |

清单头必须是文件**最顶部**的第一个 `/** ... */` 块注释（前面只能有空白）。

---

## 2. 运行契约：`host` 能做什么

`Nowly.defineModule(async ({ host, root }) => { ... })`

`host` 是模块与 App 之间**唯一**的桥梁。它的能力由清单头声明的 `@permissions` 决定：

| 成员 | 需要权限 | 说明 |
|---|---|---|
| `host.moduleId` | 无 | 模块的稳定 id（也是状态存储的键） |
| `host.todayIso` | `today` | 今天的本地日期，格式 `YYYY-MM-DD`。未授权时为 `undefined` |
| `host.loadState()` | `state` | 返回上次保存的状态（已 JSON 解析），没有则返回 `null` |
| `host.saveState(value)` | `state` | 保存状态，`value` 必须可 JSON 序列化。覆盖上一次的值 |
| `host.fetch(url, options?)` | `network` | 代理网络请求，仅放行 `@network` 白名单内的域名 |
| `host.isVisible()` | 无 | 返回当前是否可见（在视野内且窗口前台）。同步读当前状态 |
| `host.onVisibilityChange(fn)` | 无 | 注册可见性回调，`fn(visible)` 在状态变化时触发，注册时也立即触发一次当前值。返回一个取消注册的函数 |
| `host.surface` | 无 | 当前面：`'main'`（卡片）或 `'dialog'`（弹框）。同一份源码在两个面各跑一份 |
| `host.openDialog(title?)` | 无 | 请求宿主打开弹框面。可传标题，显示在弹框标题栏。已打开时重复请求被忽略 |
| `host.closeDialog()` | 无 | 请求宿主关闭弹框面。任一面都可调用 |
| `host.onStateChanged(fn)` | `state` | 注册状态变更回调。另一个面 `saveState` 成功后触发 `fn()`，用于重新 `loadState` 刷新。返回取消注册的函数 |

所有调用被限流为**每秒最多 30 次**，超出会被拒绝。

### 弹框面（突破卡片边界）

`2x2` 卡片约 195×143px，放不下设置面板。模块可以调用 `host.openDialog()` 请求宿主打开一个**弹框面**：宿主渲染一个 Dialog 外壳（含关闭按钮、Esc 关闭、焦点管理），里面加载**同一份模块源码**的第二个实例。两个面靠 `host.surface` 区分自己是 `'main'` 还是 `'dialog'`，据此渲染不同内容。

两个面共享同一 `moduleId`，因此读写**同一行状态**。一个面 `saveState` 后，宿主会向另一个面广播状态变更——收到的那一面用 `host.onStateChanged` 重新 `loadState` 刷新，否则弹框改完设置主面仍显示旧值。

**弹框高度随内容自适应，别写死高度。** 宿主会测量弹框面内容的自然高度并把 Dialog 撑到刚好包住内容（超过视口上限时封顶并让弹框内部滚动）。因此弹框面不要在 `root` / `body` / `html` 上写死 `height`，也不要为了「撑满」而套 `height:100%` 的外层——那会把内容拉伸、量出的高度失真。让内容按自身高度自然堆叠即可（纵向字段间距 20px，操作按钮靠右）。内容变化（展开下拉、增删字段）时宿主会重新测量并调整。

```js
Nowly.defineModule(async ({ host, root }) => {
  async function render() {
    const state = (await host.loadState()) || { count: 0 };
    root.textContent = '';
    if (host.surface === 'dialog') {
      // 弹框面：完整设置面板
      const btn = document.createElement('button');
      btn.className = 'nm-btn';
      btn.textContent = '加一';
      btn.addEventListener('click', async () => {
        await host.saveState({ count: state.count + 1 });
        await render();
      });
      root.appendChild(btn);
    } else {
      // 主面：紧凑展示 + 打开设置的入口
      const value = document.createElement('p');
      value.textContent = '计数：' + state.count;
      const open = document.createElement('button');
      open.className = 'nm-btn';
      open.textContent = '设置';
      open.addEventListener('click', () => host.openDialog('模块设置'));
      root.appendChild(value);
      root.appendChild(open);
    }
  }
  // 另一个面保存后刷新本面，避免显示过期状态。
  host.onStateChanged(() => { void render(); });
  await render();
});
```

### 可见性与 `@motion animated`（耗电治理，强制）

Nowly 是常驻桌面应用，模块的渲染跑在与应用**共享的渲染线程**上。一个滚出视野还在跑 `requestAnimationFrame` 的模块会持续唤醒 GPU / 风扇。因此：

- 只有声明 `@motion animated` 的模块才允许在内容区做持续动效（逐帧 rAF）。默认 `static` 模块不得有任何补间/循环动画。
- 声明 `animated` 的模块**必须**用 `host.onVisibilityChange` 在不可见时暂停动画循环、可见时恢复。校验器会拒绝「声明了 animated 却没有 `onVisibilityChange`」的模块。
- 「不可见」包含三种情形，宿主统一下发：模块滚出视野、应用窗口最小化/切后台、进入专注模式。

```js
let raf = 0;
function frame() { /* 逐帧绘制 */ raf = requestAnimationFrame(frame); }
host.onVisibilityChange(function (visible) {
  if (visible) { if (!raf) raf = requestAnimationFrame(frame); }
  else { cancelAnimationFrame(raf); raf = 0; }
});
```

注意：时钟走字、倒计时每秒重绘这类**离散**更新（`setInterval` 每秒一次）不算持续动效，属 `static`，无需声明 `animated`。

### `host.fetch` 详解

```js
const res = await host.fetch('https://api.open-meteo.com/v1/forecast?...', {
  method: 'GET',              // 'GET'（默认）或 'POST'
  headers: [['Accept', 'application/json']],  // 可选，[[name, value], ...]
  body: JSON.stringify({...}) // 可选，仅 POST 用
});

// 返回：
// res.ok      → boolean，HTTP 状态是否 2xx
// res.status  → number，HTTP 状态码
// res.headers → [[name, value], ...]
// res.text    → string，响应体文本
// res.json    → 已解析的 JSON（解析失败为 null）
```

约束（由 App 后端强制，无法绕过）：

- 只允许 **https**。
- 目标域名必须在 `@network` 白名单内。
- 只支持 **GET / POST**。
- 禁止重定向、禁止内网 / 环回地址。
- 响应体上限约 1MB，请求 8 秒超时。
- `Cookie`、`Authorization`、`Origin` 等敏感头会被后端丢弃。

---

## 3. 视觉样式规范（唯一真相是 `design.md`）

**模块的视觉必须和 Nowly 主应用长得一模一样。判定标准只有一个：仓库根的 [`design.md`](../../design.md)。** 动手写样式前先读它——颜色、字体、字号、字重、行高、间距、圆角、边框、阴影、每类组件的确切尺寸与状态，全在那里，且都是**精确数值**，不是「差不多」。

沙箱注入了一份从 `styles.css` 生成的样式表：`--nm-*` 令牌（等于 `design.md` §2 的色板、§5 圆角、§6 阴影）+ 一组 `nm-*` 语义类（常见组件的现成实现）。它们是**便利，不是天花板**——不要因为「只有这几个类」就把组件做窄或做走样。`design.md` 里有、`nm-*` 里没有的组件（图标按钮、卡片头、chip、Checkbox/Radio、下划线 Tab、日期/时间选择器、状态徽标、下拉浮层……），一律**用 `--nm-*` 令牌照着 `design.md` 的数值手写**，禁止凭感觉取近似值。

两条铁律先记住，其余照 `design.md`：

- **禁止一切动效。** 不用任何 `transition`、`animation`、旋转、缩放、位移、淡入淡出、加载动画（`design.md` §5/§10）。所有状态即时切换。沙箱已全局 `animation:none / transition:none`，但 JS 逐帧改属性同样在禁止之列（`@motion animated` 除外，见 §2）。
- **禁止颜色字面量。** 不写 `#` / `rgb()` / `hsl()`，一律 `var(--nm-*)` 令牌，否则校验器拒绝安装且无法主题化。

### 3.1 落数值的速查（全部出自 `design.md`，细节以它为准）

拿不准某个组件时翻 `design.md` 对应小节；下面是最常踩偏的几组硬数字：

- **字号（§3.3，只能用这些语义档，禁止 14/18/22 等相近值）**：Display `28/700`、H1 `24/700`、H2 `21.6/700`、H3 卡片标题 `20/600–700`、H4 `18.4/600`、Body Large `17.2`、正文 `16/400`、Body Small `15.2`、Caption `13.6`。行高统一 `1.5`（标题略紧，见表）。标题用 `--nm-text-primary`，正文 `--nm-text-secondary`，说明 `--nm-text-muted`。
- **间距（§4，4px 基准）**：只用 `4 / 8 / 12 / 16 / 20 / 24 / 32…` 这套刻度。图标与文字 `8px`，同级卡片间距 `≥16px`，表单字段纵向 `20px`，标题与说明 `4–8px`。禁止 `10px`、`14px`、`30px` 这种离刻度值。
- **圆角（§5）**：按钮/输入框/卡片 `var(--nm-radius-default)`（15.2px）；小标签 `var(--nm-radius-sm)`（7.6px）；胶囊/圆点 `var(--nm-radius-pill)`。同族组件不混用圆角。
- **边框（§7）**：默认 `1px solid var(--nm-border-default)`；选中 `1px solid var(--nm-color-primary)`；错误 `--nm-color-danger`。除 Tab 选中下划线（3px）外，禁止 2px 以上粗边框作装饰。
- **阴影（§6）**：普通卡片**不加阴影**，靠 1px 边框建立层级；hover 也不得突然加阴影。下拉/浮层用 `var(--nm-shadow-dropdown)`，焦点环用 `var(--nm-shadow-focus)`（`0 0 0 4px` 半透明青绿）。
- **交互状态（§8、§9）**：每个可交互元素都要有 default / hover / active / focus-visible / disabled，且**只即时改颜色·背景·边框·阴影**，不改尺寸和位置。disabled 透明度 `0.65`。focus-visible 必须是 4px 青绿焦点环，不能只靠弱边框。

### 3.2 现成的 `nm-*` 语义类（够用就直接套）

常见组件已按 `design.md` 实现，能套就套，省得手写还不会走样：`.nm-card` / `.nm-title` / `.nm-text` / `.nm-muted` / `.nm-btn`（+`.nm-btn--primary` / `.nm-btn--danger`）/ `.nm-btn-icon`（40×40 图标按钮）/ `.nm-input` / `.nm-tag` / `.nm-list` / `.nm-empty` / `.nm-msg`（+`.nm-msg--danger`）。完整清单见 [style.md](./style.md)。

### 3.3 超出现成类时：照 `design.md` 手写

没有对应 `nm-*` 类的组件（如卡片头、chip、Checkbox/Radio、下划线 Tab、状态徽标、下拉菜单），**翻 `design.md` §8 对应小节，用 `--nm-*` 令牌把它的确切数值写出来**。例：`design.md` §8.1 的图标按钮是 `40×40`、无水平内边距、图标 `18px`、默认 `--nm-text-secondary`、active `--nm-color-primary`；§8.12 的 Tab 是下划线态、选中 `3px` 主色下划线且文字保持深色（不是胶囊、不是实色底）。

> 判断做得对不对：把模块截图和主应用同类组件并排看，颜色·字号·圆角·间距·状态是否完全一致。有任何一处「相近但数值不同」，就是没对齐——回 `design.md` 抠数字。

### 3.4 尺寸与断点

模块视口即卡片尺寸。三档断点与格数换算见 [size.md](./size.md)。

### 3.5 可选部件（键盘可达，建议优先用）

沙箱注入了一组原生 JS 部件，挂在 `Nowly` 上。它们已内置完整键盘导航、`role`/`aria-*` 语义与焦点管理，**比自己用 `<div>` 拼要可达得多**。除非有特殊需求，涉及下拉、日期、时间、颜色、分页时优先用它们。

每个工厂返回一个可直接 `root.appendChild(...)` 的元素，并带 `nowlyGetValue()` / `nowlySetValue(v)` 两个受控辅助方法。

| 工厂 | 用途 | 关键键位 |
|---|---|---|
| `Nowly.Select(opts)` | 单选下拉 | `Enter`/`Space`/`↓` 展开，`↑↓` 移动，`Enter` 选中，`Esc` 关闭 |
| `Nowly.Tabs(opts)` | 标签页 | `←→` 切换并激活，`Home`/`End` 跳首尾 |
| `Nowly.DatePicker(opts)` | 日期选择 | `Enter` 打开网格，`←→↑↓` 移动，`PageUp`/`PageDown` 翻月，`Enter` 选中 |
| `Nowly.TimePicker(opts)` | 时间选择 | 同 Select，按 `step` 分钟枚举时间 |
| `Nowly.ColorPicker(opts)` | 颜色色板 | 单选组，`←→↑↓` 移动并选中 |

公共参数：`label`（可选，渲染为字段标签）、`value`（初始值）、`onChange(value)`（变更回调）。各部件的专有参数：

- `Select` / `TimePicker`：`options`（`[{value,label}]`，TimePicker 用 `step` 分钟数代替，默认 30）。
- `Tabs`：`tabs`（`[{id,label,panel}]`，`panel` 可为字符串或 DOM 节点）。
- `DatePicker`：`value` 用 ISO `YYYY-MM-DD`，回调也回传同格式。
- `ColorPicker`：`swatches`（可选，`['#...']` 数组；默认调色板已内置，**你无需自己写颜色字面量**——默认色板在部件内部，不会触发校验器）。

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

用部件是**可选便利**，不是强制。但若自己实现下拉/日期这类交互，务必保证键盘可达（`Tab` 可聚焦、方向键可操作、`Esc` 可关闭）与 `aria-*` 语义，否则达不到 Nowly 的可达性基线。

---

## 4. 起始模板

三个可直接复制的模板，都通过校验、样式合规：

- [templates/minimal.js](./templates/minimal.js) — 纯展示
- [templates/stateful.js](./templates/stateful.js) — 持久化 + 按钮
- [templates/network.js](./templates/network.js) — `host.fetch` 联网
- [templates/animated.js](./templates/animated.js) — `@motion animated` + 可见性暂停

最小模板：套 `nm-*` 类，不手写颜色，不设字体（body 已默认）。

```js
/**
 * @nowly-module 1
 * @id           my-module
 * @name         我的模块
 * @version      1.0.0
 * @author       yourname
 * @description  一句话描述
 * @permissions  today
 * @minSize      2x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';

  const title = document.createElement('p');
  title.className = 'nm-title';
  title.textContent = '你好，Nowly';

  const today = document.createElement('p');
  today.className = 'nm-muted';
  today.style.margin = '8px 0 0';
  today.textContent = host.todayIso ? '今天：' + host.todayIso : '';

  card.appendChild(title);
  card.appendChild(today);
  root.appendChild(card);
});
```

持久化与联网的完整写法见上面链接的 `stateful.js` 与 `network.js`。

---

## 5. 安装与发布

### 本地安装

1. 进入编辑模式 → 点"添加模块" → "我的模块" → "上传模块"。
2. 选择你的 `.js` 文件。App 会解析清单头。
3. 如果声明了 `network`，会弹出**风险确认弹窗**，列出可访问的域名，用户确认后才安装。

### 发布到模块市场

模块市场是**去中心化**的：一个公开的 `registry.json` 索引 + 各模块自行托管的 `.js` 文件。

发布流程：

1. 把你的 `.js` 文件托管到任意 https 可访问的地方（GitHub Raw、CDN 等）。
2. 向 registry 仓库提交一条索引记录（PR）：

```json
{
  "id": "weather-widget",
  "name": "天气",
  "version": "1.0.0",
  "author": "yourname",
  "description": "显示当前城市的实时天气",
  "permissions": ["state", "network"],
  "network": ["api.open-meteo.com"],
  "sourceUrl": "https://raw.githubusercontent.com/you/repo/main/weather-widget.js"
}
```

3. PR 合并后，其他用户就能在 App 的"模块市场"里搜索、下载、安装你的模块。

用户从市场安装时，App 会下载 `sourceUrl`、解析清单头、（带 network 时）弹风险确认，再落库。

---

## 6. 提交前检查清单

发布前逐条自检：

- [ ] 文件顶部有合法清单头，`@nowly-module 1` / `@id` / `@name` / `@version` 齐全。
- [ ] `@id` 只含小写字母、数字、连字符。
- [ ] 是纯 JS：没有 `import` / `require` / JSX / TypeScript 语法。
- [ ] 没有直接用 `fetch` / `XMLHttpRequest` / `WebSocket`；联网只走 `host.fetch`。
- [ ] 用到的每个 `host` 能力都在 `@permissions` 里声明了。
- [ ] 用了 `host.fetch` 就声明了 `network` 权限并在 `@network` 列出所有域名。
- [ ] 没有加载远程脚本 / 字体 / 图片。
- [ ] 没有任何 `transition` / `animation` / 动效。
- [ ] 没有颜色字面量（`#` / `rgb()` / `hsl()`）；颜色一律 `var(--nm-*)` 或套 `nm-*` 类。
- [ ] 没有无界循环（`while (true)` / `for (;;)`）；所有循环有明确边界。
- [ ] 纯图标按钮（只含 `<svg>`、无可读文字）都带了 `aria-label`（或 `aria-labelledby` / `title` / svg 内 `<title>`）。命令式构建（`createElement`）时校验器扫不到，靠自觉。
- [ ] 模块源码未超过 256 KiB（第三方库内联也要克制体积）。
- [ ] 若声明了 `@motion animated`，已用 `host.onVisibilityChange` 在不可见时暂停动画；默认 `static` 模块无任何持续动效。
- [ ] 视觉严格对齐 `design.md`：圆角、字号、字重、行高、间距、边框、阴影都落在其规定的档位上，没有 `14px`/`18px`/`10px 14px` 这类拍脑袋的近似值。
- [ ] 超出便捷类的组件（图标按钮、卡片头、chip、下划线 Tab、复选框/单选、状态徽标、下拉浮层等）按 `design.md` 对应小节的确切数值用 `--nm-*` 令牌手写，没有自造近似样式。
- [ ] 每个可交互元素都实现了 `design.md` §9 要求的静态状态（default / hover / active / focus-visible / disabled，必要时 error），且只即时改颜色/背景/边框/阴影。
- [ ] `host.fetch` 和 `host.loadState` 都做了错误处理（`try/catch`），失败时给用户可读提示。
- [ ] 在 `root` 上手动渲染，没有假设父页面存在任何元素。
