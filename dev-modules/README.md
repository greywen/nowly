# dev-modules/

草稿模块目录。把你正在写的自定义模块 `.js` 文件放这里，运行 `npm run module:preview`，在浏览器里实时预览。

- 每个 `.js` 文件是一个独立模块（顶部要有合法清单头，见 `docs/custom-modules/SKILL.md`）。
- 文件一保存，预览页自动重挂。
- 这里的文件不会被打包进应用，也默认不纳入 git（`example.js` 与本说明除外）。

编写规范见 `docs/custom-modules/`，AI 工具接线见 `docs/custom-modules/install/AGENTS.md`。
