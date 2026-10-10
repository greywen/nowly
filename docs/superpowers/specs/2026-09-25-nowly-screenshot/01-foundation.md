# 截图基础与会话实施计划

**功能目标：** 建立可测试的唯一会话状态机、Windows 捕获后端、Bar 抑制恢复和专用覆盖窗口，使普通桌面底图能安全进入 AIMING。

**涉及文件：**

- 修改 `src-tauri/src/screen_capture.rs`：会话状态、命令和单元测试。
- 新建 `src-tauri/src/screen_capture/backend.rs`：Windows 显示器枚举、物理像素捕获和 sRGB 帧。
- 新建 `src-tauri/src/screen_capture/gdi.rs`：自有 GDI 抓屏后端、DPI 感知守卫和 BGRA→RGBA 转换。
- 新建 `src-tauri/src/screen_capture/composite.rs`：虚拟桌面包围矩形、选区裁切、跨屏拼接、空隙填白和取色。
- 新建 `src-tauri/src/screen_capture/window.rs`：覆盖窗口标签、物理几何规划和任务栏归属。
- 新建 `src-tauri/src/screen_capture/frames.rs`：冻结帧存储、按需 PNG 编码和帧 URL 路径解析。
- 新建 `src-tauri/src/screen_capture/session.rs`：启动编排、回滚、拆除与生产侧 `CaptureEffects`。
- 新建 `src-tauri/capabilities/screenshot.json`：截图窗口的最小权限。
- 新建 `src/screenshot/window-route.ts`、`ScreenshotApp.tsx`、`useCancelOnEscape.ts`、`useCaptureFrame.ts`：窗口路由、两个截图表面、Esc 取消和底图加载。
- 修改 `src-tauri/src/quick_panel.rs`：截图专用临时抑制权。
- 修改 `src-tauri/src/main.rs`：托管会话、命令注册和窗口兜底清理。
- 修改 `src-tauri/Cargo.toml`、`src-tauri/capabilities/*.json`：锁定通过 V00 的最小依赖和权限。
- 修改 `src/main.tsx`：按 `screenshot-*` label 路由截图应用。

## 开发步骤

- [x] 为 `CaptureState` 写状态转移测试：`IDLE -> STARTING -> AIMING`，重复启动返回 `CAPTURE_BUSY`，旧版本异步结果被拒绝。
- [x] 运行 `cargo test --manifest-path src-tauri/Cargo.toml screen_capture::tests`，确认测试因缺少会话实现失败。
- [x] 实现不依赖 Tauri 窗口的纯状态机，使同一测试通过。
- [x] 为 64MP、单边 65,535 和 512 MiB 峰值预算写边界/溢出测试，再实现预检。
- [x] 执行 V00：依赖许可和最小构建已确认；第三方库的进程内 WGC/GDI/DXGI 实测不稳定，改为自实现 GDI 后端后 20/20 稳定通过，已删除 xcap。
- [x] 为捕获后端写全有或全无、物理坐标、RGBA 长度和捕获前预算测试。
- [x] 为合成帧裁切、跨屏拼接、空隙填白和无有效像素写测试并实现。
- [x] 实现每屏分块捕获；任何一屏失败时丢弃本次全部底图。
- [x] 为截图抑制写测试：捕获期间设置/详情/提醒显示不能重新显示 Bar，释放后按当前业务状态原子协调。
- [x] 创建唯一任务栏会话窗口和每屏辅助覆盖窗口；辅助窗口跳过任务栏并使用最小 capability。
- [x] 将底图准备、hide-generation、5 秒超时和恢复路径接入 `start_screen_capture`。底图像素经 `nowly-frame` 本地 scheme 以 PNG 送达覆盖层，由 WebView 自行解码；URL 带会话 ID，旧会话的请求被拒。
- [x] 为 `src/main.tsx` 写窗口路由测试，再加入 `ScreenshotApp` 路由。
- [x] 运行截图 Rust 测试、相关 Bar 测试、前端路由测试和 `npm run build`。

## 验收标准

- 同一进程仅有一个截图会话，所有命令校验调用窗口、会话 ID、状态和版本。
- Bar 在抓屏前完成隐藏，失败或取消后恢复；Nowly 主窗口仍可被截取。
- 多屏底图保留各自物理像素和有符号虚拟桌面坐标，不以全局 DPI 系数换算。
- V00–V03 和可执行的 V09 项有真实证据；未具备设备的项保持 `NOT_RUN`。

**当前状态：** 01-foundation 已全部完成。状态机、容量预检、适配器合同、选区几何、帧合成与取色、GDI 抓屏后端、覆盖窗口、启动编排与回滚、底图交付、Bar 临时抑制均已到位。V00 已 PASS，原先计划的隔离 helper 不再需要：那是为了隔离外部库 WGC 回调线程的静态初始化 `expect`，自有 GDI 后端没有这个问题。`start_screen_capture` 已接线，`is_available()` 是真实的平台判断（Windows），单次尝试的失败由后端在启动时如实报出；`cancel_screen_capture`、Esc 和 `Destroyed` 事件三条退出路径都会恢复 Bar 并释放帧。

**底图通道：** 像素走 `nowly-frame` 本地 scheme，每屏一张 PNG，由 WebView 自行解码并缓存；不走巨大 Base64/JSON invoke，也不按指针移动重新取屏（§9）。PNG 按需编码且缓存：同一屏的第二次请求复用同一个 `Arc`，测试用 `Arc::ptr_eq` 盯住这一点。URL 同时带会话 ID 和显示器 ID，所以旧会话的迟到请求得到的是拒绝，而不是新会话的桌面。`serve_frame` 除了校 URL 还校请求方 webview label，否则该 scheme 会变成任何页面都能用的读屏通道。路径解析严格到只接受两个十进制数，`..`、负数和超 u32 均拒。

覆盖层用 `<img>` 填满窗口而不用图像自身像素尺寸：窗口已经等于显示器物理矩形，而图像是物理像素、CSS 是逻辑像素，在 1.5 缩放屏上用 naturalWidth 会溢出。后续选区坐标由 naturalWidth 与渲染框的比值换算，不依赖这个填充方式。

选区、放大镜、工具条属于 02-editor；`composite.rs` 的函数尚未接线，`dead_code` 警告属预期。

hide-generation 不需要单独的计数器：`BitBlt` 每次直接读当前屏幕，没有帧池能交回旧帧（WGC 的 frame pool 才有这个问题），配上 `DwmFlush` 确认隐藏已被合成，该要求在结构上已成立。

启动编排把副作用放在 `CaptureEffects` trait 后面，因为需要证明的正是顺序：抑制 Bar → 确认合成 → 捕获 → 创建窗口 → 显示。任何一步失败都要销毁窗口、恢复 Bar 并回到 IDLE，这些路径各有测试。

两个已修正的死锁：会话锁不得跨主线程窗口操作持有，所以 `teardown` 不再接收 session，由调用方先用短锁清理状态；`abandon_session` 必须开线程，因为它从主线程的窗口事件处理器被调用，而 teardown 自己需要主线程。这也是 `start_capture` 得以安全持锁的前提：主线程上没有任何路径会去拿这把锁。Alt+F4 等其它关窗途径由 `main.rs` 的 `Destroyed` 事件兜底，否则 Bar 会永久隐藏。

GDI 后端的关键决定：用 `GetDC(None)` 取整个虚拟屏幕 DC 再按显示器物理矩形 `BitBlt`，而不是像 xcap 那样按设备名逐屏建 DC（后者在本机返回 `0x80070006`）。`capture_rgba` 与 `displays` 都先过 `require_physical_pixels`：进程不是 per-monitor DPI aware 时返回 `NotDpiAware`，因为 DPI 虚拟化下系统会交回缩放后的坐标和被拉伸的位图，那会静默违反 §4.1 但看起来像成功。生产进程由 Tao 在 `EventLoop::new` 设为 per-monitor-v2，符合要求。

合成模块的判定顺序固定为「坐标溢出 → 容量上限 → 超出桌面」，避免非法 extent 被报成普通的超大图片。镜像显示器矩形重叠时由帧列表中的第一个显示器拥有该像素，`composite_selection` 与 `sample_pixel` 共用这一规则，两条路径不会给出不同颜色。像素搬运直接用 `image::imageops::replace`：它自己裁剪负偏移和越界，且不做 alpha 混合，因此不自己算交集和行偏移。`image` 相应从 Windows 专属依赖改为无条件依赖（`windows` crate 本身已是无条件，CI 也只有 windows-latest）。这些函数尚未接线，`dead_code` 警告与 `screen_capture.rs`、`backend.rs` 现状一致。