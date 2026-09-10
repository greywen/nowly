# Skill 组织约定（全仓通用）

本仓库的 skill 是**纯 Markdown 约定，没有可执行代码**。宿主（Claude Code / Copilot / Codex / Cursor）在会话开始时扫描约定目录，把每个 skill 的 `description` 注入上下文；模型判断相关时才去读正文。

新增或改造任何 skill，都按本页的结构和规矩来。

---

## 1. 三层结构

```text
.agents/skills/<name>/SKILL.md    ← 宿主指针（通用 agent 约定）
.claude/skills/<name>/SKILL.md    ← 宿主指针（Claude Code 约定，与上一份逐字相同）
        │
        ↓ 指向
docs/<domain>/SKILL.md            ← 主 skill：定位 + 硬约束 + 子 skill 路由 + 工作流
        │
        ↓ 路由到
docs/<domain>/<topic>.md          ← 子 skill：一个主题一个文件，自完备
```

**为什么真身放 `docs/` 而不是 `.claude/`**：同一份内容既是给 AI 的规范，也是给人的开发文档。放 `docs/` 让它进入 [00-index.md](./00-index.md) 的正常索引，也避免规范与文档两份漂移。

**为什么宿主指针要两份**：`.agents/` 与 `.claude/` 是不同宿主各自的发现路径，目前只能各放一份副本。所以指针必须做到**极薄**——薄到复制两份不产生维护负担。

---

## 2. 各层职责

### 宿主指针（`.agents/` / `.claude/`）

只做三件事，**不超过 15 行**：

1. frontmatter：`name` + `description`。`description` 是宿主唯一注入上下文的内容，必须写清「什么时候该用这个 skill」，而不是「这个 skill 是什么」。
2. 一句话说明这是指针，并给出主 skill 的相对路径链接。
3. 一句话工作流，让模型在读主 skill 前就知道产物落在哪。

**不要**在指针里复述硬约束、字段表、代码示例。指针一旦开始承载内容，两份副本就会漂移。

### 主 skill（`docs/<domain>/SKILL.md`）

是**路由器和守门人**，不是百科全书。只放四类内容：

| 内容 | 为什么放在主文件 |
|---|---|
| 定位与适用场景 | 模型要先判断「是不是该用这个 skill」 |
| 硬约束 | 高频、跨全部子主题、违反即失败。这是全仓**唯一**一份，其余任何文件只能链接过来 |
| 子 skill 路由表 | 「你要做 X，去读 Y」。带一句话说明，让模型能按需读而不必全读 |
| 工作流与收尾门槛 | 产物写到哪、怎么验证、结束前必须过哪张检查清单 |

**主 skill 应控制在 100 行以内。**超了就说明有内容该下沉到子 skill。

### 子 skill（`docs/<domain>/<topic>.md`）

一个文件一个主题，**自完备**：读它的人不需要回头翻主文件就能把这件事做完。

- 主文件里对某主题**只留一行路由**，不留摘要。摘要就是重复的开始。
- 子 skill 之间只做单向链接，不互相摘抄。出现「详见 SKILL.md §3.5」这类反向引用，说明切分点选错了。
- 命名用主题词而非编号：`manifest.md` / `runtime.md` / `publish.md`，不要 `part1.md`。

---

## 3. 三条硬规矩

1. **单一事实源。** 任何一条规则只写一处，其他地方只能链接。判断方法：改一条规则时如果要动两个文件，就是违规。唯一例外是**检查清单**——它按定义是硬约束的派生索引，但必须在开头标明出处，且只写「有没有做到」，不解释「为什么」和「怎么做」。
2. **无反向引用。** 子 skill 不许写「详见主文件某节」。子 skill 只依赖主文件的存在，不依赖主文件的内容。
3. **路由表必须完整。** 每个子 skill 都要在主文件的路由表里出现，并标明是「必读」还是「按需」。孤儿文件等于不存在。

---

## 4. 在各家 AI 工具里启用

技能包本体就是 `docs/<domain>/` 目录——一组 Markdown + 模板。不同工具「装」的方式不同，本质都是让工具把这些文件读进上下文。

- **Claude Code**：`.claude/skills/<name>/SKILL.md` 自动发现，无需额外配置。
- **GitHub Copilot**：`.agents/skills/<name>/SKILL.md` 自动发现；也可在 `.github/copilot-instructions.md` 里指向主 skill。
- **Codex**：没有原生 skill 机制，但通常会自动读仓库根与子目录的 `AGENTS.md`。仓库根的 [AGENTS.md](../AGENTS.md) 已经指向各主 skill。
- **Cursor**：把一句指令写进 `.cursor/rules/`，指向主 skill 即可。
- **仓库外使用**：把主 skill 加上它路由表里标「必读」的几份子 skill 粘进对话。

通用最小指令，喂给任何工具都能启动：

> 读 `docs/<domain>/SKILL.md`，照其中规范和它路由到的子文件完成任务。

---

## 5. 现有 skill

| Skill | 主文件 | 用途 |
|---|---|---|
| `nowly-custom-module` | [custom-modules/SKILL.md](./custom-modules/SKILL.md) | 编写、预览、发布 Nowly 自定义模块 |
