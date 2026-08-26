# 实时预览工作台

有两条预览通道，共用同一套沙箱 iframe（null origin、`allow-scripts`、网络封锁 CSP、注入的 `nm-*` 样式表）、同一份内存 host、同一套尺寸档位与 lint。在哪条通道跑通，装进桌面 App 里都一模一样。

- **通道 B（给 AI，本页主体）**：独立网页 `npm run module:preview`，不依赖 Tauri，可用 Playwright 截图自查。写模块时的主力。
- **通道 A（给用户 / 开发期看真实 App）**：App 内「模块工作台」对话框，读 `dev-modules/*.js`。开发模式（`tauri dev`）读仓库根的 `dev-modules/`（和通道 B 同一目录，写一次两处都看得到）；装机版读 app 数据目录（Windows 是 `%APPDATA%/com.nowly.app/dev-modules/`）。见文末「通道 A」一节。

## 通道 B：独立预览页

预览工作台是一个独立页面，不依赖 Tauri、不启动桌面外壳，渲染你的草稿。

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

## 通道 A：App 内模块工作台

装机版没有仓库、也没有 Vite 编译期的 `dev-modules/` 目录，但你仍想在**真实 App 环境**里看草稿。通道 A 就是为此存在。

它读哪个 `dev-modules/` 目录，取决于当前跑的是开发版还是装机版：

- **开发版（`npm run tauri dev`）**：读**仓库根目录**的 `dev-modules/`——和通道 B 完全同一个目录。这样 AI 把草稿写一次到仓库 `dev-modules/`，浏览器预览页（通道 B）和 App 内工作台（通道 A）都能看到，不用手动拷贝。
- **装机版（`tauri build` 出来的正式包）**：读 app 数据目录下的 `dev-modules/`（Windows 是 `%APPDATA%/com.nowly.app/dev-modules/`；macOS 是 `~/Library/Application Support/com.nowly.app/dev-modules/`；Linux 是 `~/.local/share/com.nowly.app/dev-modules/`）。装机用户没有仓库，这个跨机器稳定的路径就是草稿的落脚点。

**不确定当前该往哪写？打开工作台，草稿为空时它会直接显示当前机器上的绝对路径**——AI 工具照抄即可。开发版里它显示的就是仓库 `dev-modules/`，装机版里显示的是 APPDATA 目录。

步骤：

1. 按上面的规则把草稿 `.js` 写到对应的 `dev-modules/`。
2. 在 App 里进入编辑模式 → 「添加模块」→ 「我的模块」区顶部点「模块工作台」。
3. 左栏列出该目录下的草稿，右侧按所选档位真实比例预览，左下角实时显示 lint。

和通道 B 的差别只有草稿来源：通道 B 靠 Vite 编译期把仓库 `dev-modules/*.js` 内联，通道 A 靠后端命令 `list_dev_modules` 在运行时读磁盘（开发版读仓库、装机版读 APPDATA）。沙箱、host、尺寸、lint 完全一致。

工作台每秒轮询一次该目录，改文件保存后无需重开对话框即自动重挂——和通道 B 的「改完即见」一致。

> 死循环的平台约束在这里同样成立：guest 主线程与主仪表盘**共享渲染线程**，草稿卡死会冻住整个 App。所以务必先在通道 B（独立标签页，冻死只影响那一页）里跑通，再拿到通道 A 看真实效果。
