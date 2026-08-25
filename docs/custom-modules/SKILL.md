---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# 编写 Nowly 自定义模块

Nowly 的自定义模块是**一个自描述的 `.js` 文件**。用户可以在 App 里上传本地文件，或从"模块市场"下载安装。安装后，模块会成为 12×8 网格上一个可自由摆放的组件，和内置的日历 / 四象限 / 便签 / 看板一样。

这份规范告诉你如何写出一个**合法、可发布、样式合规**的模块。请完整阅读后再动手。

**配套文件：** [style.md](./style.md)（`nm-*` 令牌与语义类）· [size.md](./size.md)（尺寸与断点）· [preview.md](./preview.md)（实时预览工作台）· [install/AGENTS.md](./install/AGENTS.md)（给 AI 工具的入口与工作流）。

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

所有调用被限流为**每秒最多 30 次**，超出会被拒绝。

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

## 3. 视觉样式规范（严格对齐 `design.md`）

沙箱注入了一份从应用 `styles.css` 生成的样式表，`--nm-*` 令牌与 `nm-*` 语义类可直接用。**不要写颜色字面量**，一律用令牌或语义类对齐 Nowly 的设计语言。

### 3.1 禁止动效（强制）

**不要用任何 `transition`、`animation`、旋转、缩放、位移、淡入淡出、加载动画。** 所有状态即时切换。这是 Nowly 的铁律。

### 3.2 颜色：只用令牌

沙箱注入了一份从应用 `styles.css` 生成的样式表。**不要写颜色字面量**——一律用 `var(--nm-*)` 令牌，否则校验器拒绝安装，且未来主题化无法覆盖你的模块。

常用令牌：`--nm-color-primary`、`--nm-text-primary`、`--nm-text-secondary`、`--nm-text-muted`、`--nm-bg-surface`、`--nm-bg-subtle`、`--nm-border-default`。完整清单与 `nm-*` 语义类见 [style.md](./style.md)。

最省力的做法是直接套 `nm-*` 语义类（`.nm-card` / `.nm-title` / `.nm-btn` / `.nm-btn--primary` / `.nm-input` 等），它们已对齐设计规范，无需手写样式。

### 3.3 其它

- **圆角**：按钮、输入框、卡片统一用 `var(--nm-radius-default)`；小标签 `var(--nm-radius-sm)`；胶囊 `var(--nm-radius-pill)`。
- **字体**：`var(--nm-font-sans)`（body 已默认套用，通常无需再设）。
- **字号**：正文 `16px`，次级 `15.2px`，说明 `13.6px`，卡片标题 `18.4–20px`。
- **间距**：以 `4px` 为基准，常用 `8px / 12px / 16px / 24px`。
- **按钮**：高度 `40px`，内边距 `8px 24px`，字重 `500`（`.nm-btn` 已内置）。
- **焦点环**：`var(--nm-shadow-focus)`。
- **阴影**：普通卡片不加阴影，靠 `1px solid var(--nm-border-default)` 边框建立层级。

### 3.4 尺寸与断点

模块视口即卡片尺寸。三档断点与格数换算见 [size.md](./size.md)。

---

## 4. 起始模板

三个可直接复制的模板，都通过校验、样式合规：

- [templates/minimal.js](./templates/minimal.js) — 纯展示
- [templates/stateful.js](./templates/stateful.js) — 持久化 + 按钮
- [templates/network.js](./templates/network.js) — `host.fetch` 联网

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
- [ ] 圆角、字体、间距对齐第 3 节的令牌。
- [ ] `host.fetch` 和 `host.loadState` 都做了错误处理（`try/catch`），失败时给用户可读提示。
- [ ] 在 `root` 上手动渲染，没有假设父页面存在任何元素。
