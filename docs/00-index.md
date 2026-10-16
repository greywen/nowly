# Nowly 文档索引

## 产品与使用 / Product and usage

- 产品介绍：[中文](../README.zh.md) / [English](../README.md)
- [产品定义与源码事实核对](product-definition.md)
- 用户指南（含既有详细说明、限制与开发警告）：[中文](user-guide.zh.md) / [English](user-guide.en.md)
- 隐私与数据（含 AI、Google/Microsoft/ICS、存储与联网边界）：[中文](privacy-and-data.zh.md) / [English](privacy-and-data.en.md)
- 自定义模块：当前检出无相关文档或运行时；见 [产品边界](product-definition.md)。不将外部技能描述当作已实现功能；若恢复文档，须在此链接并核对其契约。

## 项目入口

- 前端入口：`src/main.tsx`
- 主应用：`src/app/App.tsx`
- Nowly Bar：`src/quick-panel/StatusIslandApp.tsx`
- Tauri 入口：`src-tauri/src/main.rs`
- 统一设计规范：`design.md`
- 贴纸模块：`src/stickers/`；使用说明见 [中文指南](user-guide.zh.md#贴纸画布) / [English guide](user-guide.en.md#sticker-canvas)
- 贴纸浏览器存储：`src/data/browser-sticker-store.ts`（IndexedDB，与笔记附件隔离）

## 当前功能计划

- 提醒音效总计划（历史路径，当前检出缺失）：`docs/superpowers/specs/2026-10-14-reminder-sounds/00-master-plan.md`
- 桌面截图规格：`docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md`
- 桌面截图验证清单：`docs/superpowers/specs/2026-09-25-nowly-screenshot-validation.md`
- 桌面截图总计划：`docs/superpowers/specs/2026-09-25-nowly-screenshot/00-master-plan.md`

## 常用命令

- 前端测试：`npm test -- --run <test-file>`
- 前端构建：`npm run build`
- Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml`
- Rust 单文件格式化：`rustfmt --edition 2021 <file>`
- 端到端测试：`npm run e2e -- <spec-file>`
- 重新生成音效：`node scripts/generate-sounds.mjs`
- 音频质量与资产一致性：`node --test scripts/generate-sounds.test.mjs`

Rust 改动只格式化本次触及的叶子文件，避免 `cargo fmt` 改写无关模块。