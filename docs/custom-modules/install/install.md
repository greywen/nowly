# 在各家 AI 工具里装上这份技能

这份技能包就是 `docs/custom-modules/` 目录本身——一组 Markdown 规范 + 模板。不同工具「装」的方式不同，本质都是让工具把这些文件当作上下文读进去。

## Codex

Codex 没有原生 skill 机制。两种用法：

- **仓库内使用**：直接让 Codex 读 `docs/custom-modules/install/AGENTS.md`，它会顺着指针读完其余规范。许多 Codex 配置会自动读取仓库根或子目录的 `AGENTS.md`，可把本文件的内容软链或复制到仓库根的 `AGENTS.md` 里指过来。
- **仓库外使用**：把 `SKILL.md` + `style.md` + `size.md` 三份的内容粘进对话，说明「照这个规范写一个 XX 模块，输出单个 .js 文件」。

## Cursor

把要点写进 `.cursor/rules/`（或旧版 `.cursorrules`），指向 `docs/custom-modules/AGENTS.md`：

```md
写 Nowly 自定义模块时，先读 docs/custom-modules/install/AGENTS.md 及其引用的规范，
把草稿写到 dev-modules/，用 npm run module:preview 预览。
```

## GitHub Copilot

在仓库放 `.github/copilot-instructions.md`，内容同上：指向 `docs/custom-modules/install/AGENTS.md`，并强调「颜色只能用 `var(--nm-*)`、不能 `import`、联网只走 `host.fetch`」这几条硬约束。

## Claude（本仓库已内置）

本仓库的 `CLAUDE.md` 已约束读 `design.md`；模块相关规范由 `docs/custom-modules/SKILL.md` 的 frontmatter（`name` / `description`）作为技能描述被发现。

## 通用最小指令

不管哪家工具，喂给它这一句即可启动：

> 读 `docs/custom-modules/install/AGENTS.md`，照其中规范写一个 Nowly 模块，
> 存到 `dev-modules/<id>.js`，确保 `npm run module:preview` 里 lint 通过。
