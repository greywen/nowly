# 给 AI 工具的指针（Codex / Cursor / Copilot 等）

你被要求为 **Nowly** 写一个自定义模块。开始前，按顺序读这几份规范，它们就在这个仓库里：

1. `docs/custom-modules/SKILL.md` — 主规范：清单头、安全约束、结构、提交前检查清单。**先读这份。**
2. `docs/custom-modules/style.md` — 可用的 `--nm-*` 令牌与 `nm-*` 语义类。颜色只能用令牌，禁止字面量。
3. `docs/custom-modules/size.md` — 尺寸表与三档断点。
4. `docs/custom-modules/preview.md` — 怎么实时预览你写的模块。

## 工作流

1. **把模块写到仓库根目录的 `dev-modules/` 下**，一个文件一个模块，例如 `dev-modules/<module-id>.js`。这是预览页扫描的目录。
2. **预览**：跑 `npm run module:preview`，浏览器打开 `http://localhost:1420/preview.html`，左栏选中你的草稿即可看到渲染。改文件保存后自动重挂。
3. **校验**：预览页会实时显示 lint 结果；也可命令行单独跑：

   ```bash
   node -e "import('./registry/lint.mjs').then(async ({lintModuleSource})=>{const {readFileSync}=await import('node:fs');const i=lintModuleSource(readFileSync(process.argv[1],'utf8'));console.log(i);process.exit(i.length?1:0)})" dev-modules/你的模块.js
   ```

   输出 `[]` 表示颜色 / 循环 / 远程资源三条硬约束都通过。
4. **截图自查**（可选）：参考 `tests/module-preview.spec.ts`，用 Playwright 加载预览页并对 iframe 截图，核对布局。

## 最容易踩的坑（详见 SKILL.md §0）

- 纯 JS，不能 `import` / npm / React / JSX / TS。
- 联网只能 `host.fetch`，且要声明 `@permissions network` + `@network 域名`。第三方库只能内联，不能从 CDN 拉。
- 颜色只能 `var(--nm-*)` 或套 `nm-*` 类，禁止 `#` / `rgb()` / `hsl()`。
- 不加任何 `transition` / `animation` / 补间。
- 循环必须有明确边界；`while (true)` / `for (;;)` 会被 lint 拒，且死循环会冻结整个应用。

## 起始模板

直接复制 `docs/custom-modules/templates/` 下的一个：

- `minimal.js` — 纯展示
- `stateful.js` — 持久化 + 按钮
- `network.js` — `host.fetch` 联网
