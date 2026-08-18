# Nowly

Nowly 是一款面向 Windows 10/11 的本地优先（local-first）效率面板。它将月历、
艾森豪威尔任务矩阵、看板、便签和专注计时器整合到同一块桌面区域，既可以作为
普通窗口运行，也可以直接嵌入桌面壁纸。所有数据都保存在本机的 SQLite 数据库中。

[English](./README.md) | 简体中文

## 功能特性

- **月历** —— 创建带时间、颜色的日程，并支持按天查看详情。
- **艾森豪威尔矩阵** —— 按「紧急 / 重要」四象限整理任务，聚焦真正要做的事。
- **看板** —— 可自定义泳道、卡片和字段，进行轻量级项目跟踪。
- **便签** —— 快速记录，并提供独立的管理器整理条目。
- **专注计时器** —— 倒计时专注会话，支持全屏模式与会话统计。
- **壁纸模式** —— 将 Nowly 嵌入桌面图标之后，支持任务栏感知定位，也可作为
  普通窗口运行。
- **灵活布局** —— 在 12×8 网格上自由摆放每个模块，可开关模块并自由调整大小。
- **自定义模块** —— 从本地文件或内置「模块市场」安装沙箱化的 `.js` 扩展，
  每个模块运行在隔离的 iframe 中。
- **个性化** —— 高斯模糊、全局取色器、日历格式、密度控制以及开机自启。
- **多语言** —— 支持英文与简体中文，启动时跟随系统语言。

## 使用说明

- 点击右上角按钮，将 Nowly 设为壁纸。
- 双击壁纸或点击托盘图标，返回前台窗口模式。
- 打开 **设置**，可控制壁纸关闭行为、开机自启、日历格式、密度以及模块可见性。
- 当启用壁纸偏好时，关闭前台窗口会恢复壁纸；否则窗口会隐藏到托盘。
- 托盘菜单中的 **退出 Nowly** 是唯一会终止进程的操作。

## 技术栈

- **前端** —— React + TypeScript，基于 Vite 构建，使用 Tailwind CSS 样式。
- **桌面外壳** —— Tauri 2，后端使用 Rust。
- **存储** —— 通过 `rusqlite`（bundled）使用本地 SQLite。
- **测试** —— Vitest 负责单元/组件测试，Playwright 负责端到端测试，
  `cargo test` 负责 Rust 层测试。

## 开发

环境要求：Node.js、Rust 工具链，以及 Windows 下的 Tauri 依赖。

```bash
npm install                                        # 安装依赖
npm run dev                                         # Vite 开发服务器（127.0.0.1:1420）
npm test                                            # Vitest 单元/组件测试
npm run build                                       # tsc + vite build
npx playwright test                                 # 端到端测试
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 测试
npm run tauri build                                 # 构建 Windows 可执行文件
```

## 项目结构

```text
src/                 React 前端
  app/               应用外壳、布局网格、启动钩子
  calendar/          月历与日程
  matrix/            艾森豪威尔任务矩阵
  kanban/            看板
  notes/             便签
  focus/             专注计时器与统计
  widgets/           扩展/自定义模块系统与沙箱
  components/        共享 UI（Dialog、Select、DatePicker 等）
  data/              仓储接口与 Tauri 实现
  i18n/              多语言（en/zh）
src-tauri/           Rust 后端（Tauri 命令、SQLite、壁纸、托盘）
registry/            自定义模块注册表与示例
docs/                设计规格、实施计划与发布验证
```

## 自定义模块

自定义模块是自描述的 `.js` 文件，运行在隔离的 iframe 沙箱中
（`allow-scripts`、null origin、严格 CSP）。它们不能 import 包、不能访问父页面
DOM，也不能直接联网 —— 宿主仅暴露一个小型 `host` API（`state`、`today`，以及
带权限控制的 `host.fetch`）和一个用于渲染的 `root` 元素。安装后，模块会成为
12×8 网格上可自由摆放的组件，与内置模块并列。完整的模块格式与运行时契约见
`docs/custom-modules/SKILL.md`。

## 发布

发布流程由 `Release` GitHub Actions 工作流
（`.github/workflows/release.yml`）完全自动化。每次合并到 `main` 都会构建
Windows 可执行文件，并发布附带安装包的 GitHub Release。

版本号由 `package.json` 中的 `version` 字段驱动：

- 首次运行会原样发布该版本（`0.1.0`）。
- 之后每次合并都会自动递增补丁号，以保证每个版本唯一，并在
  `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和
  `src-tauri/tauri.conf.json` 中同步重写版本号，再以带 `[skip ci]` 的提交
  写回 `main`。
- 若要发布新的次版本/主版本，请手动修改 `package.json` 后合并。

发布说明由 LLM 生成：它读取自上次发布以来的提交，并汇总为结构化、面向用户的
更新日志。配置以下仓库密钥即可启用（若缺少 `LLM_API_KEY`，则回退到按提交分组
的更新日志）：

- `LLM_API_KEY` —— 兼容 OpenAI 的 API Key（生成 LLM 说明所必需）。
- `LLM_BASE_URL` —— 可选，默认为 `https://api.openai.com/v1`。
- `LLM_MODEL` —— 可选，默认为 `gpt-4o-mini`。

## 故障排查

如果壁纸嵌入或资源管理器（Explorer）恢复失败，请从托盘图标打开 Nowly，
再重新尝试设置壁纸。用户数据以 `nowly.sqlite` 的形式保存在 Tauri 应用数据
目录中；在进行手动恢复操作前，请先备份该文件。

Windows 验证矩阵与已知限制见 `docs/release/windows-verification.md`。
