# Nowly 文档索引

## 项目入口

- 前端入口：`src/main.tsx`
- 主应用：`src/app/App.tsx`
- Nowly Bar：`src/quick-panel/StatusIslandApp.tsx`
- Tauri 入口：`src-tauri/src/main.rs`
- 统一设计规范：`design.md`

## 当前功能计划

- 桌面截图规格：`docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md`
- 桌面截图验证清单：`docs/superpowers/specs/2026-09-25-nowly-screenshot-validation.md`
- 桌面截图总计划：`docs/superpowers/specs/2026-09-25-nowly-screenshot/00-master-plan.md`

## 常用命令

- 前端测试：`npm test -- --run <test-file>`
- 前端构建：`npm run build`
- Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml`
- Rust 单文件格式化：`rustfmt --edition 2021 <file>`
- 端到端测试：`npm run e2e -- <spec-file>`

Rust 改动只格式化本次触及的叶子文件，避免 `cargo fmt` 改写无关模块。