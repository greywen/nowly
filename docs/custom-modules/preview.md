# 实时预览工作台（通道 B）

写模块时，你需要**立刻看到它长什么样**。预览工作台是一个独立页面，不依赖 Tauri、不启动桌面外壳，用和 App 完全相同的沙箱 iframe（null origin、`allow-scripts`、网络封锁 CSP、注入的 `nm-*` 样式表）渲染你的草稿。在这里跑通的模块，装进桌面 App 里一模一样。

## 用法

1. 把你的模块 `.js` 写到仓库根目录的 `dev-modules/` 下，例如 `dev-modules/my-module.js`。
2. 跑：

   ```bash
   npm run module:preview
   ```

   浏览器会自动打开 `http://localhost:1420/preview.html`。

3. 左栏列出 `dev-modules/` 里的所有草稿，点一个即预览。改文件保存后页面自动重挂——**改完即见**。

## 页面能做什么

- **尺寸档位**：`3×2 / 4×3 / 6×4 / 12×8` 四档，按 1280×720 默认窗口的真实格像素换算（单格约 89×63、gap 16）。模块 iframe 视口即它在网格上的真实尺寸，所以这是最忠实的检查。
- **校验结果**：实时跑 `registry/lint.mjs` 的三条硬约束（颜色字面量、无界循环、远程资源），命中就在下方列出行号。发布前必须是「通过」。
- **清单头错误**：清单头缺失或非法时，左栏标「清单错误」，右侧显示原因。

## host 能力

预览用一个**内存版 host**，契约和真实 host 完全一致：

- `loadState` / `saveState`：存在内存里，页面刷新即清空（草稿本就是一次性的）。
- `todayIso`：声明 `today` 权限才下发。
- `fetch`：声明 `network` 才有。**预览页直接走浏览器原生 `fetch`**（没有 Rust SSRF 代理），但仍按你声明的 `@network` 白名单校验，行为与生产尽量一致。

## AI 自查（截图）

预览页是纯网页，可用 Playwright 直接截图核对渲染，无需人工盯屏。参考 `tests/module-preview.spec.ts`：加载 `/preview.html`、选中草稿、断言 iframe 内文本、截图。这是让 AI 自己撞到「模块卡死 / 布局崩」并修好的主力手段。

```bash
npx playwright test module-preview --project=1366x768
```

## 已知边界

- **死循环仍会冻结页面**。预览页和 App 一样受浏览器平台约束：guest 主线程死循环会冻住整个标签页。这正是要在预览里先跑一遍的原因——在这里撞到，总比装进桌面 App 冻死好。lint 会拦最常见的 `while (true)` / `for (;;)` 字面量。
- 预览页是**开发工具**，不进生产打包（`vite build` 只打 `index.html`）。
