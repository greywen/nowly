---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# 编写 Nowly 自定义模块

Nowly 的自定义模块是**一个自描述的 `.js` 文件**。用户可以在 App 里上传本地文件，或从「模块市场」下载安装。安装后，模块会成为 12×8 网格上一个可自由摆放的组件，和内置的日历 / 四象限 / 便签 / 看板一样。

这份主文件只放**硬约束**和**去哪读**：先把 §0 读完，再按 §1 的路由表按需读子文件。子文件自包含，不必回头翻这里。

---

## 0. 硬性约束（最容易踩的坑）

模块运行在一个**隔离的 iframe 沙箱**里（`sandbox="allow-scripts"`，null origin，CSP `default-src 'none'`）。这意味着：

1. **不能 `import`、不能用 npm、不能用 React / JSX / TypeScript。** 必须是一个自包含的**纯 JavaScript 文件**。
2. **不能直接访问网络。** 没有 `fetch`、`XMLHttpRequest`、`WebSocket`。要联网只能用 `host.fetch`（见 [runtime.md](./runtime.md)），且需声明权限和域名白名单。
3. **不能访问父页面 DOM、`localStorage`、`cookie`、Tauri。** 你的世界只有传进来的 `host` 和 `root` 两个对象。
4. **不能加载远程脚本、字体、图片。** CSP 会拦截。要显示图标就用文字或内联 SVG。
5. **渲染靠手动操作 DOM。** 你拿到一个 `root` 元素，用 `document.createElement` 往里塞节点。
6. **颜色只能用 `var(--nm-*)` 令牌，禁止任何 `#` / `rgb()` / `hsl()` 字面量。** 校验器会拒绝含颜色字面量的模块。沙箱已注入一份从应用 `styles.css` 生成的样式表，令牌与 `nm-*` 语义类可直接用，详见 [style.md](./style.md)。
7. **循环必须有明确边界。** `while (true)` / `for (;;)` 会被校验器拒绝，且死循环会冻结整个应用（用户只能去任务管理器杀进程）。
8. **纯图标按钮必须带 `aria-label`。** 只含内联 `<svg>`、没有可读文字的 `<button>`，必须加 `aria-label`（或 `aria-labelledby`、`title`，或 svg 内 `<title>`）说明用途，否则读屏软件读不出。带文字的按钮无需额外标注。**注意校验器只能静态抓到 HTML 字符串形式**（如 `root.innerHTML = '<button><svg>…'`）；用 `document.createElement` / `createElementNS` 命令式构建的按钮它扫不到，也就是说漏了这条不一定报错——请自觉遵守，这是可达性底线，不是靠校验器兜底。
9. **源码体积有上限（256 KiB）。** 单个模块文件超过 256 KiB 会被拒绝。第三方库只能内联、图标用内联 SVG，但要克制——真需要大体积依赖的功能不适合做成沙箱模块。

违反其中任何一条，模块要么安装失败，要么运行时报错。

---

## 1. 子 skill 路由

| 要做什么 | 读这份 | 何时读 |
|---|---|---|
| 写清单头、定权限与尺寸 | [manifest.md](./manifest.md) | **必读** |
| 用 `host` 存状态 / 联网 / 开弹框 / 响应可见性 | [runtime.md](./runtime.md) | **必读** |
| 写任何样式 | [`../../design.md`](../../design.md) → [style.md](./style.md) | **必读**，`design.md` 是数值唯一真相 |
| 交付前自检 | [checklist.md](./checklist.md) | **必读**，收尾门槛 |
| 做下拉 / 日期 / 时间 / 颜色 / 标签页 | [widgets.md](./widgets.md) | 涉及时读 |
| 适配不同卡片尺寸 | [size.md](./size.md) | 涉及断点时读 |
| 跑起来看效果、截图自查 | [preview.md](./preview.md) | 开始写之前读 |
| 装进 App 或发到模块市场 | [publish.md](./publish.md) | 交付时读 |
| 直接抄一个能跑的骨架 | [templates/](./templates/) | 起步时读 |

模板四选一：[minimal.js](./templates/minimal.js)（纯展示）· [stateful.js](./templates/stateful.js)（持久化 + 按钮）· [network.js](./templates/network.js)（`host.fetch` 联网）· [animated.js](./templates/animated.js)（`@motion animated` + 可见性暂停）。

---

## 2. 工作流

1. **选模板**：从 `templates/` 复制一个最接近的。
2. **写草稿**：写到仓库根的 `dev-modules/<module-id>.js`，一个文件一个模块。这是预览页扫描的目录。
3. **实时预览**：跑 `npm run module:preview`，浏览器打开 `http://localhost:1420/preview.html`，左栏选中你的草稿。改文件保存后自动重挂。细节与第二条预览通道见 [preview.md](./preview.md)。
4. **看 lint**：预览页实时显示校验结果，必须是「通过」。也可命令行单独跑：

   ```bash
   node -e "import('./registry/lint.mjs').then(async ({lintModuleSource})=>{const {readFileSync}=await import('node:fs');const i=lintModuleSource(readFileSync(process.argv[1],'utf8'));console.log(i);process.exit(i.length?1:0)})" dev-modules/你的模块.js
   ```

   输出 `[]` 表示颜色 / 循环 / 远程资源三条硬约束都通过。

5. **截图自查**：参考 `tests/module-preview.spec.ts`，用 Playwright 加载预览页并对 iframe 截图，和主应用同类组件并排比对。
6. **过检查清单**：交付前逐条走完 [checklist.md](./checklist.md)。**没过清单不算完成。**

> lint 只机械扫三条约束，扫不到的部分（可达性、`design.md` 数值对齐、错误处理）靠 checklist 和截图自查兜底。别把「lint 通过」当作「做完了」。
