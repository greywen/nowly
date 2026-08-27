# AGENTS.md

## 写 Nowly 自定义模块

如果你被要求为 Nowly 创建、修改或发布一个**自定义模块**，先读技能包主入口，它会顺着指针带你读完其余规范：

→ [`docs/custom-modules/install/AGENTS.md`](./docs/custom-modules/install/AGENTS.md)

一句话工作流：把模块写到仓库根的 `dev-modules/<id>.js`，跑 `npm run module:preview` 实时预览，确保预览页里 lint 通过。

硬约束（详见 `docs/custom-modules/SKILL.md` §0）：纯 JS，不能 `import`/npm/React/JSX/TS；联网只走 `host.fetch`（需声明 `@permissions network` + `@network 域名`），第三方库只能内联；颜色只能 `var(--nm-*)` 或 `nm-*` 类，禁止字面量；不加任何 `transition`/`animation`；循环必须有明确边界；纯图标按钮必须带 `aria-label`；源码不超过 256 KiB。

## 其它改动

本仓库的整体工程约定见 `CLAUDE.md`（设计系统读 `design.md`、提交信息格式等）。
