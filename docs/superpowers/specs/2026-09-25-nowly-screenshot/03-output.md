# 截图输出实施计划

**功能目标：** 将同一版本的底图和标注文档合成为真实 sRGB 像素，可靠写入 Windows 图片剪贴板或原子保存 PNG。

**涉及文件：**

- 新建 `src-tauri/src/screen_capture/renderer.rs`：底图 → 叠加层 → 马赛克 的合成。
- 新建 `src-tauri/src/screen_capture/output.rs`：导出事务状态机与 sink trait。
- 新建 `src-tauri/src/screen_capture/dib.rs`：CF_DIB 打包（纯逻辑）。
- 新建 `src-tauri/src/screen_capture/encode.rs`：PNG 编码与容量预算。
- 新建 `src-tauri/src/screen_capture/export.rs`：合成 → 渲染 → 编码 → 写入的编排。
- 新建 `src-tauri/src/screen_capture/clipboard.rs`：真实 Windows 剪贴板 FFI。
- 修改 `src-tauri/src/screen_capture.rs`：导出状态、版本冻结和命令校验。
- 修改截图前端：导出静态状态、取消导出和局部错误反馈。

## 开发步骤

- [x] 写渲染黄金测试，验证无 UI 像素、对象顺序、马赛克最终遮挡和分块边界。实现在 `src-tauri/src/screen_capture/renderer.rs`（11 项）。
- [x] 写导出事务测试，覆盖编码期取消、提交前取消、提交期禁用取消、迟到结果和失败回到 EDITING。实现在 `src-tauri/src/screen_capture/output.rs`（15 项）。
- [x] 实现有界合成和 PNG 编码，所有尺寸乘法使用检查运算并纳入 512 MiB 预算。`encode.rs`（6 项）复用已有的 `validate_output_dimensions`。
- [x] 写剪贴板适配器测试，再接入 Windows 标准图片格式和七字符文本格式。`dib.rs`（11 项）+ `clipboard.rs`。
- [x] 写保存事务测试：系统对话框取消、中文路径、覆盖失败保留旧文件、临时文件精确清理。`save.rs`（12 项）。对话框取消在前端验证（返回 `false` → 编辑器原样回来、无错误）；中文路径需真实对话框，仍待人工验收。
- [x] 实现同目录临时文件、目标身份复核和文件系统能力不足时拒绝覆盖。`SafeFileSink`。变异测试：把复核改成 `if false`，恰好挂那三项身份测试。
- [ ] 真实枚举剪贴板格式，并在微信、画图、Word 中读回图片；独立解码保存 PNG 比较尺寸和像素。**需真实桌面人工验收。**

## 验收标准

- 只有真实复制或保存成功才关闭会话；取消和失败完整保留编辑状态。
- PNG 不携带窗口标题、桌面坐标、路径或未遮挡原图。
- 复制与保存结果像素一致；保存不隐式修改剪贴板。

**当前状态：** 复制与保存两条路径已端到端可用，用户点得动。

- 命令：`stage_capture_overlay`（二进制体 + 头部几何）、`copy_capture_to_clipboard`、`save_capture_to_file`（返回 `bool`，`false` 是用户取消对话框）。三个都先校验调用窗口标签。
- 前端：`rasterize.ts` 将预览用的同一个 SVG 序列化后 1:1 光栅化；`useExport.ts` 两条路径共用一份几何描述。
- 尚未完成：马赛克预览回程、微信/画图/Word 的真实粘贴验收、中文路径与真实对话框验收。

保存对话框用 `IFileSaveDialog`（COM，`dialog.rs`）而不引入 `tauri-plugin-dialog`：剪贴板已经是手写 Win32 FFI，沿用同一条路不增加依赖，而且 §8.2 的目标身份复核必须紧贴写入发生。`dialog.rs` 故意做得很薄：能不靠对话框判定的东西全在 `save.rs`，它自己只剩阻塞等用户输入的部分，那部分无法单测。

错误文案的归属：Rust 报错已是本地化且按 §8.3 措辞，所以前端原文展示；本地抛出的是面向开发者的英文，必须换成本地化文案。两者用是否 `Error` 实例区分，各自有测试。

`FrameStore::with_frames` 用闭包而不返回克隆：帧是整个桌面的物理像素，拷一份会把会话峰值内存翻倍。它同时拒绕过期会话，所以迟到的导出读不到新的桌面像素（`refuses_to_render_for_a_superseded_session`）。

渲染与编码在可取消阶段，写入前再次校验版本，所以编码期间提交的标注会中止本次导出而不是复制旧图（`does_not_copy_when_the_version_moved_on`）。

剪贴板已用可重复的真实探针验证（`writes_a_real_image_to_the_clipboard`，`#[ignore]`，因为它会改变本机剪贴板）。它写入后**再读回**：单纯 `SetClipboardData` 成功只证明调用被接受，读回并校验 biSize=40、biWidth=2、biHeight=1、biBitCount=24 和 BGR 像素，才证明其他应用真能解码。已实际跑过并通过。

CF_DIB 有三个容易错的地方，各有测试：行是**自下向上**的（写反了每张截图都倒置）、通道是 **BGR** 不是 RGB、每行要补齐到 **4 字节**边界。用 24 位而非 32 位：导出本来就不透明（`renderer.rs` 断言了），而部分消费方会把 32 位 DIB 的 alpha 当零，粘贴出黑块。

FFI 里有一个必须说清的所有权规则：`SetClipboardData` **成功后内存归系统所有**，此时再 `GlobalFree` 就是 use-after-free，表现为另一个应用粘贴出乱码。所以只在调用**失败**时释放。`EmptyClipboard` 必须在所有 `SetClipboardData` 之前，否则旧内容会与新内容共存、应用可能拿到陈旧格式。

PNG 格式是增强而非必需：注册或写入失败不失败整次导出，因为 DIB 已经能粘贴。

## 文字渲染分工（实施中做出的决定）

规格 §5.3 line 394 明确要求「不能假设 Rust 和 WebView 的文字渲染自动相同」，而 §8.1 又要求预览与输出一致。这两条加起来意味着文字只能有一份实现。`--font-sans` 是系统字体栈（Inter → Microsoft YaHei → …），Rust 要逐像素复刻浏览器的 shaping/hinting/抗键齿不现实，且中文需要打包好几 MB 的 CJK 字体并涉及授权。

所以分工是：

- **标注绘制（含文字）归 WebView。** 它已有 `AnnotationLayer.tsx` 的 SVG 渲染并测过；导出时把同一层光栅化成一张透明 RGBA 叠加图交给 Rust。文字因此只有一份实现，预览与输出天然一致，也不用打包字体。
- **马赛克归 Rust**（`mosaic.rs`），与已确认的决定一致：均值算法写两份终将不一致。
- **Rust 仍是最终缓冲区、编码和写入的权威**，权威像素不依赖 WebView 保留副本。

马赛克在最后一步，所以它会遮住下方的任何标注包括文字——这是意图行为（盖住标签就必须真的看不见），`a_mosaic_hides_the_text_underneath_it` 验证这一点。顺序断言已用变异测试确认：把 `apply_mosaics` 提到混合之前，三个顺序测试全挂。

**一个必要推论（已实现）：** 预览必须显示真实的马赛克像素，只画虚线框等于没遮住。提交马赛克对象时向 Rust 往返一次、取回新的预览底图，走 `preview.rs` + 同一个 `nowly-frame` 方案。这是离散的用户动作而非每帧。

- 预览路径是 `preview/<会话>/<序号>`，用前缀而非第三个数字，这样显示帧的解析器仍然只接受两个数字，两类请求不可能混淆。
- 序号每次渲染递增，否则 WebView 可能命中缓存、显示上一次的马赛克状态——那等于给用户看一个不是他要导出的画面。
- 渲染失败时显示无预览而非旧预览，理由同上。
- 预览故意不含标注叠加层：WebView 自己已经画在上面，混进去会画两次。
- `clear_frames` 现在同时清 `PreviewStore` 和 `OverlayStaging`（§8.3），否则它们会活得比会话长。

**光栅化时结构性剔除编辑态（自我纠正）：** 马赛克的虚线框和选中态虚线当前只由应用样式表提供，而序列化后的 SVG 不套用外部样式表，所以今天它们本来就进不了导出。依赖这一点是个陷阱：把马赛克描边改成 presentation attribute 是个看起来很合理的改动，却会开始把虚线框烤进每一个保存的文件。所以 `rasterize.ts` 结构性地移除它们，并有 8 项测试；变异测试确认去掉剔除后恰好挂那两项马赛克测试。

