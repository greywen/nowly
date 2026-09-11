# 快捷面板顶部抽屉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将快捷 AI 窗口实现为完整顶部抽屉，并在设置中支持启用和配置快捷键。

**Architecture:** 保留 Tauri 独立 `quick-panel` 窗口，React 侧增加可扩展的 `QuickPanelHost` 和抽屉布局；Rust 侧集中管理全局快捷键与窗口显示。AI 业务逻辑继续复用 `AssistantDock` 与既有 IPC 安全边界。

**Tech Stack:** React、TypeScript、Vitest、Tauri 2、Rust、tauri-plugin-global-shortcut、SQLite 既有设置存储。

---

### Task 1: 快捷键配置模型

**Files:**
- Modify: `src/quick-panel/quick-panel.ts`
- Test: `src/quick-panel/quick-panel.test.ts`
- Modify: `src/data/nowly-repository.ts`
- Modify: `src/data/browser-tauri-shim.ts`

- [ ] 增加默认快捷键、配置校验和抽屉状态函数。
- [ ] 为启用状态、快捷键格式和无效配置增加失败测试。
- [ ] 更新设置模型与浏览器 shim 的持久化字段。
- [ ] 运行 `npm test -- src/quick-panel/quick-panel.test.ts`。

### Task 2: QuickPanelHost 与顶部抽屉

**Files:**
- Create: `src/quick-panel/QuickPanelHost.tsx`
- Modify: `src/quick-panel/QuickPanelApp.tsx`
- Modify: `src/quick-panel/quick-panel.css`
- Test: `src/quick-panel/QuickPanelHost.test.tsx`

- [ ] 先测试面板显示、Esc 关闭、失焦关闭和 panelId 路由。
- [ ] 实现完整聊天抽屉布局，确保内容可滚动且不使用动画。
- [ ] 保留 AssistantDock 草稿和聊天状态。
- [ ] 运行相关 Vitest。

### Task 3: 设置界面

**Files:**
- Modify: `src/settings/SettingsDialog.tsx`
- Create or modify: `src/settings/QuickPanelSettings.tsx`
- Modify: `src/i18n/translations.ts`
- Test: `src/settings/*test.tsx`

- [ ] 增加设置入口、开关、快捷键录入和错误提示测试。
- [ ] 接入既有设置保存接口，保存成功后立即反映配置。
- [ ] 按设计系统完成静态状态与无动画样式。

### Task 4: Rust 快捷键生命周期

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/capabilities/default.json`
- Test: `src-tauri/src/main.rs` 或 `src-tauri/src/settings.rs`

- [ ] 测试快捷键解析、默认值和冲突时保留旧值。
- [ ] 将快捷键注册/注销集中到可重用函数。
- [ ] 从应用设置读取启用状态和快捷键。
- [ ] 快捷键只显示/隐藏 `quick-panel`，不调用主窗口前台逻辑。
- [ ] 运行 `cargo test` 与 `cargo check`。

### Task 5: 集成验证

**Files:**
- Modify: `tests/assistant.spec.ts`
- Create: `tests/quick-panel.spec.ts`

- [ ] 增加快捷窗口组件和抽屉布局的浏览器测试。
- [ ] 运行 `npm test`、`npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check`。
- [ ] 在 Windows 桌面运行 `npm run tauri dev`，验证快捷键、置顶、失焦和语音输入。
