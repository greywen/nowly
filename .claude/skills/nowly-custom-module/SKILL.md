---
name: nowly-custom-module
description: "Use this when creating, customizing, or publishing a Nowly custom module. Defines the module file format, the runtime contract (state, today, network fetch), the strict visual style, and the publish/download flow so any AI tool can produce a valid, installable module in one shot."
---

# Nowly 自定义模块

这是一个**指针 skill**。规范真身在仓库里，请直接读它并完整遵循：

→ [`docs/custom-modules/SKILL.md`](../../../docs/custom-modules/SKILL.md)

先读它的 §0 硬约束，再按 §1 的路由表取子 skill（清单头 / 运行契约 / 样式 / 部件 / 尺寸 / 预览 / 发布 / 检查清单）。

一句话工作流：把模块写到仓库根的 `dev-modules/<id>.js`，跑 `npm run module:preview` 实时预览，确保预览页里 lint 通过，交付前走完 `checklist.md`。
