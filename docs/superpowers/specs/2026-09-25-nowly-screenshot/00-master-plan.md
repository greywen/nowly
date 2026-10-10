# Nowly 桌面截图实施总计划

> 按任务清单逐项执行；每项行为先写失败测试，再写最小实现并运行同一测试。未经真实执行不得把验证状态改为 PASS。

**目标：** 在 Windows 上交付从 Nowly Bar 启动、可框选与标注、可复制或保存、支持可靠部分结果的垂直滚动长截图功能。

**架构：** Rust 维护唯一 `CaptureSession`、原始像素、窗口和敏感 I/O；React 截图窗口只维护交互视图并通过带会话 ID/版本的命令操作文档。普通截图、渲染输出和长图拼接分别拥有独立模块，避免把桌面权限、UI 状态和图像算法混在一起。

**技术栈：** Tauri 2、Rust、Windows API、React、TypeScript、Vitest、Playwright；图像抓取、PNG 与剪贴板依赖由 V00 探针锁定。

## 功能块

| 阶段 | 子计划 | 状态 | 验证门槛 |
|---|---|---|---|
| 设计与技术基线 | [01-foundation.md](01-foundation.md) | 已完成（待 V01–V03 真实验收） | D02、V00–V03、V09 |
| 普通截图与标注 | [02-editor.md](02-editor.md) | 进行中（选区几何与标注文档完成） | V04–V05、V10–V11 |
| 复制与保存 | [03-output.md](03-output.md) | 未开始 | V06、V11 |
| 滚动截图与发布验收 | [04-scroll-and-release.md](04-scroll-and-release.md) | 未开始 | V07–V08、V12 |

## 当前进度

- 2026-09-30 用户已批准微信式普通截图交互修订（含悬停识别窗口与单击选窗）。本轮实施按 `../2026-09-30-screenshot-interaction-amendment.md` 和 `../../plans/2026-09-30-screenshot-interaction.md` 执行，启动修复与交互回归单独记录，不代替 V01–V12 发布验收。
- 已确认完整交互、D02 和容量边界。
- 已将截图数据与编辑几何例外同步至 `design.md` §14。
- 已实现唯一会话状态机、输出容量预检、抓屏适配器合同和 Bar 临时抑制。
- 已实现选区裁切、跨屏拼接、空隙填白与取色（`screen_capture/composite.rs`，12 项测试）；副屏不做统一 DPI 重采样，空隙不提供可复制色值。
- Bar 抑制已覆盖设置切换、详情打开、并发恢复及 WebView 收起通知的原子边界。
- 已锁定 image 0.25.10、arboard 3.6.1；已删除 xcap，抓屏改为自有 GDI 后端（`screen_capture/gdi.rs`），V00 已 PASS。
- GDI 后端强制 per-monitor DPI 感知：进程未感知时返回 `NotDpiAware` 而拒绝捕获，不返回被系统拉伸的虚拟化像素。
- 已实现覆盖窗口与启动编排（`screen_capture/window.rs`、`session.rs`）：唯一任务栏会话窗口加每屏跳过任务栏的辅助覆盖窗口，抑制→合成确认→捕获→创建→显示的顺序和全部回滚路径各有测试。
- `start_screen_capture` 已接线并在 Windows 上可用；`cancel_screen_capture`、Esc 和 `Destroyed` 事件三条退出路径都会恢复 Bar。
- 底图已送达覆盖层：每屏一张 PNG 经 `nowly-frame` 本地 scheme，按需编码并缓存，URL 带会话 ID，`serve_frame` 同时校验请求方 webview label。
- 01-foundation 全部开发步骤已完成；02-editor 已打通主链路：框选 → 工具条 → 绘制标注（含文字）→ undo/redo → 键盘调度，放大镜可取色。
- 03-output 的 Rust 侧复制路径已可调用（合成→渲染→编码→剪贴板），真实剪贴板已用读回探针验证。尚缺：保存对话框与安全提交、前端光栅化与命令注册。
- 04-scroll-and-release 未开始；V01–V12 仍为 NOT_RUN，其中多项需真实 Windows 人工验收。
- 已确认：合成归 Rust。马赛克只有一份实现（`screen_capture/mosaic.rs`），WebView 只显示 Rust 给的结果，避开预览与输出两份算法不一致的风险。

## 风险阻塞

- Windows 抓屏后端对混合 DPI、HDR、捕获排除和受保护内容的实际能力必须由原生探针确认。单屏单 DPI 已通过；混合 DPI、负坐标、旋转、HDR 仍未验证。
- 滚动拼接不能以图像相似度猜接缝；低置信和无新增内容必须暂停并保留已确认前缀。
- 真实桌面、剪贴板、系统保存对话框、IME 和跨应用输入无法只靠浏览器测试证明。

## 验证结果

- 设计准入：已通过文档一致性检查。
- V00：PASS。自有 GDI 后端连续 20 轮捕获 20/20 成功；release 下 3.1MP 约 30–60ms。探针另暴露并修正了 DPI 虚拟化导致的假成功（报 1493×933，实际 2240×1400）。
- V01–V12：保持 `NOT_RUN`，按子计划执行后回填验证清单。
