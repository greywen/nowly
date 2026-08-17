---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# 编写 Nowly 自定义模块

Nowly 的自定义模块是**一个自描述的 `.js` 文件**。用户可以在 App 里上传本地文件，或从"模块市场"下载安装。安装后，模块会成为 12×8 网格上一个可自由摆放的组件，和内置的日历 / 四象限 / 便签 / 看板一样。

这份规范告诉你如何写出一个**合法、可发布、样式合规**的模块。请完整阅读后再动手。

---

## 0. 硬性约束（最容易踩的坑）

模块运行在一个**隔离的 iframe 沙箱**里（`sandbox="allow-scripts"`，null origin，CSP `default-src 'none'`）。这意味着：

1. **不能 `import`、不能用 npm、不能用 React / JSX / TypeScript。** 必须是一个自包含的**纯 JavaScript 文件**。
2. **不能直接访问网络。** 没有 `fetch`、`XMLHttpRequest`、`WebSocket`。要联网只能用 `host.fetch`（见下文），且需声明权限和域名白名单。
3. **不能访问父页面 DOM、`localStorage`、`cookie`、Tauri。** 你的世界只有传进来的 `host` 和 `root` 两个对象。
4. **不能加载远程脚本、字体、图片。** CSP 会拦截。要显示图标就用文字或内联 SVG。
5. **渲染靠手动操作 DOM。** 你拿到一个 `root` 元素，用 `document.createElement` 往里塞节点。

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

沙箱注入了一套基础样式，但你仍需主动对齐 Nowly 的设计语言。**沙箱看不到父页面的 CSS 变量**，所以要把下面的字面值直接内联到你的样式里。

### 3.1 禁止动效（强制）

**不要用任何 `transition`、`animation`、旋转、缩放、位移、淡入淡出、加载动画。** 所有状态即时切换。这是 Nowly 的铁律。

### 3.2 颜色（直接用这些值）

| 用途 | 色值 |
|---|---|
| 主色（按钮 / 链接 / 选中） | `#4FC9DA` |
| 主色 hover | `#69D1E0` |
| 主色 active | `#30A6B6` |
| 主色浅背景 | `#DDF8FC` |
| 成功 | `#B8D935` |
| 警告 | `#E8C444` |
| 危险 / 删除 | `#F06445` |
| 页面标题文字 | `#211F1C` |
| 正文文字 | `#716D66` |
| 弱说明 / 占位 | `#968E7E` |
| 卡片 / 表面背景 | `#FFFFFF` |
| 浅灰背景 | `#F8F6F2` |
| 边框 | `#EAEAEA` |

### 3.3 其它

- **圆角**：按钮、输入框、卡片统一用 `15.2px`；小标签 `7.6px`；胶囊 `999px`。
- **字体**：`Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif`。
- **字号**：正文 `16px`，次级 `15.2px`，说明 `13.6px`，卡片标题 `18.4–20px`。
- **间距**：以 `4px` 为基准，常用 `8px / 12px / 16px / 24px`。
- **按钮**：高度 `40px`，内边距 `8px 24px`，字重 `500`。
- **焦点环**：`0 0 0 4px rgba(79, 201, 218, 0.25)`。
- **阴影**：普通卡片不加阴影，靠 `1px solid #EAEAEA` 边框建立层级。

---

## 4. 完整起始模板

复制这个骨架开始写。它演示了状态持久化、今天日期、以及合规样式。

```js
/**
 * @nowly-module 1
 * @id           my-counter
 * @name         计数器
 * @version      1.0.0
 * @author       yourname
 * @description  一个带持久化的简单计数器
 * @permissions  state, today
 * @minSize      3x3
 * @defaultSize  4x4
 */
Nowly.defineModule(async ({ host, root }) => {
  let state = (await host.loadState()) || { count: 0 };

  function button(label, onClick) {
    const el = document.createElement('button');
    el.textContent = label;
    el.style.font = 'inherit';
    el.style.height = '40px';
    el.style.padding = '8px 24px';
    el.style.border = '1px solid #4FC9DA';
    el.style.borderRadius = '15.2px';
    el.style.background = '#4FC9DA';
    el.style.color = '#FFFFFF';
    el.style.fontWeight = '500';
    el.style.cursor = 'pointer';
    el.onclick = onClick;
    return el;
  }

  function render() {
    root.innerHTML = '';
    root.style.fontFamily =
      'Inter, "Microsoft YaHei", "PingFang SC", Helvetica, Arial, sans-serif';
    root.style.color = '#211F1C';

    if (host.todayIso) {
      const date = document.createElement('p');
      date.textContent = '今天：' + host.todayIso;
      date.style.margin = '0 0 12px';
      date.style.color = '#968E7E';
      date.style.fontSize = '13.6px';
      root.appendChild(date);
    }

    const value = document.createElement('p');
    value.textContent = '计数：' + state.count;
    value.style.margin = '0 0 16px';
    value.style.fontSize = '20px';
    value.style.fontWeight = '600';
    root.appendChild(value);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.appendChild(button('+1', async () => {
      state = { count: state.count + 1 };
      await host.saveState(state);
      render();
    }));
    row.appendChild(button('重置', async () => {
      state = { count: 0 };
      await host.saveState(state);
      render();
    }));
    root.appendChild(row);
  }

  render();
});
```

### 联网模块示例（片段）

```js
/**
 * @nowly-module 1
 * @id           weather-widget
 * @name         天气
 * @version      1.0.0
 * @permissions  state, network
 * @network      api.open-meteo.com
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  root.textContent = '加载中…';
  try {
    const res = await host.fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m'
    );
    const temp = res.json?.current?.temperature_2m;
    root.textContent = temp != null ? ('当前气温：' + temp + '°C') : '暂无数据';
  } catch (error) {
    root.textContent = '获取失败：' + error.message;
  }
});
```

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
- [ ] 颜色、圆角、字体、间距对齐第 3 节的值。
- [ ] `host.fetch` 和 `host.loadState` 都做了错误处理（`try/catch`），失败时给用户可读提示。
- [ ] 在 `root` 上手动渲染，没有假设父页面存在任何元素。
