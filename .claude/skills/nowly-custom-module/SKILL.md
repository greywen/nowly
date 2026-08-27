---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# Nowly 自定义模块

这是一个**指针 skill**。规范真身在仓库里,请直接读它并完整遵循:

→ [`docs/custom-modules/SKILL.md`](../../../docs/custom-modules/SKILL.md)

它会顺着指针带你读完其余规范(`style.md` / `size.md` / `preview.md` / `templates/`)。

一句话工作流:把模块写到仓库根的 `dev-modules/<id>.js`,跑 `npm run module:preview` 实时预览,确保预览页里 lint 通过。

硬约束(详见 `docs/custom-modules/SKILL.md` §0):纯 JS,不能 `import`/npm/React/JSX/TS;联网只走 `host.fetch`(需声明 `@permissions network` + `@network 域名`),第三方库只能内联;颜色只能 `var(--nm-*)` 或 `nm-*` 类,禁止字面量;不加任何 `transition`/`animation`;循环必须有明确边界;纯图标按钮必须带 `aria-label`;源码不超过 256 KiB。
