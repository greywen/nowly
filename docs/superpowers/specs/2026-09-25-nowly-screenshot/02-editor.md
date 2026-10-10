# 普通截图与标注编辑实施计划

**功能目标：** 完成 AIMING、SELECTING、EDITING 的取色、框选、对象标注、撤销重做和键盘/IME 行为。

**涉及文件：**

- 新建 `src/screenshot/ScreenshotApp.tsx`：截图窗口状态编排。
- 新建 `src/screenshot/screenshot-model.ts`：选区、局部状态和按键分派纯模型。
- 新建 `src-tauri/src/screen_capture/mosaic.rs`：马赛克算法（唯一实现，预览与输出共用）。
- 新建 `src/screenshot/AnnotationLayer.tsx`：六种对象的 SVG 渲染。
- 新建 `src/screenshot/useAnnotationDrawing.ts`：绘制交互，一次拖拽一个事务。
- 新建 `src/screenshot/useCaptureKeyboard.ts`：把 §7 调度接到真实事件。
- 新建 `src/screenshot/frame-geometry.ts`：CSS 像素 ↔ 物理像素映射。
- 新建 `src/screenshot/useSelection.ts`：框选拖拽交互。
- 新建 `src/screenshot/SelectionLayer.tsx`：遇罩、边框、八个手柄、尺寸读数。
- 新建 `src/screenshot/ScreenshotToolbar.tsx` 与 `toolbar-placement.ts`：工具条组件与置位。
- 新建 `src/screenshot/Magnifier.tsx` 与 `pixel-color.ts`：放大镜与取色。
- 新建 `src/screenshot/tool-properties.ts`：§5.2 的固定输出参数。
- 新建 `src/screenshot/toolbar-model.ts`：工具顺序、三组分组、禁用原因和 i18n 键。
- 新建 `src/screenshot/magnifier-layout.ts`：放大镜卡片几何、置位翻转和三档退让。
- 新建 `src/screenshot/key-dispatch.ts`：§7 的按键优先级纯函数。
- 新建 `src/screenshot/annotation-document.ts`：版本化对象、事务历史和 redo 失效规则。
- 新建 `src/screenshot/ScreenshotCanvas.tsx`：分块底图与可见范围渲染。
- 新建 `src/screenshot/ScreenshotToolbar.tsx`：固定工具分组和属性控件。
- 新建 `src/screenshot/Magnifier.tsx`：冻结帧采样、坐标和 HEX。
- 新建 `src/screenshot/screenshot.css`：仅使用 `design.md` Token 的语义化 CSS。
- 修改 `scripts/generate-icons.mjs`、`src/components/icons.tsx`：补齐 Solar 工具图标并重新生成数据。

## 开发步骤

- [x] 纯模型已覆盖 1×1、反向拖选、半开区间、负坐标和移动边界；八向调整已完成（`resizeSelection`，锁对边、不反转、不越桌面）。跨屏指针协调属原生会话，仍未实现。
- [x] 写按键优先级测试，逐项覆盖规格 §7 的 Ctrl+C/S/Z/Y、Enter、Delete、方向键和 Esc 分层。实现在 `src/screenshot/key-dispatch.ts`（26 项）。
- [x] 写标注文档测试：六类对象、单次事务、undo/redo、新提交清分支、选区变化清旧 redo。
- [x] 写马赛克独立真值测试：图像原点网格、边缘块、交叠对象和逐通道四舍五入。实现在 `src-tauri/src/screen_capture/mosaic.rs`（14 项）。
- [x] 逐个实现纯模型，每次只让当前失败测试转绿。
- [x] 写组件测试验证工具顺序、默认选择、`aria-pressed`、Tooltip、禁用原因和焦点语义。`ScreenshotToolbar.test.tsx`。
- [x] 实现放大镜三档退让、无效像素状态和仅复制七字符大写 HEX 的命令流。Ctrl+C 已接线：`copy_capture_color` 由 Rust 采样冻结底图并写入剪贴板（`format_hex` 4 项 + 集成 5 项）。
- [x] 实现框选、移动、八向调整和首个标注后锁定选区。指针拖拽见 `selection-hit.ts`（9 项）+ `useSelectionEditing.ts`（10 项）；键盘方向键与 Shift 调整此前已接。
- [x] 实现矩形、椭圆、箭头、画笔、文字、马赛克的创建与单对象编辑。创建全部完成；单对象编辑含选择、移动与逐类属性（`annotation-hit.ts` 13 项 + `useAnnotationEditing.ts` 13 项 + `PropertyPanel` 7 项）。**仍缺：逐类改尺寸与箭头拖端点。**
- [ ] 实现长图分块/可见范围画布，禁止整高 DOM/Canvas。**等 04 的长图产出后才有可渲染对象。**
- [ ] 用 Playwright 检查标准与窄小显示空间下的工具栏、放大镜、焦点和无重叠。

## 验收标准

- 预览和输出共享同一标注文档坐标及渲染规则，不通过截取 DOM 导出。
- 控件遵守 `design.md` §14；原始像素、裁切边界和控制点不被应用圆角污染。
- 真正中文 IME 与原生跨屏指针仍需 Windows 验收，不能由 jsdom 结果代替。

**当前状态：** 选区几何与标注文档已完成，均为纯模型且有测试（`screenshot-model.ts` 24 项、`annotation-document.ts` 20 项）。

八向调整的两条硬规则：每条边同时锁对边（至少保留 1px）和捕获桌面边界，所以拖过对边时停在 1×1 而不是翻转矩形，且被锁住时对边位置不动。

历史用快照栈：对象不可变，所以快照很便宜。只有已提交的变更进栈，因此一条画笔（测试用 50 个采样点）是一次 undo，而不是每点一步。选中状态不进历史。`noteSelectionGeometryChanged` 实现 §5.3 那条容易遗漏的规则：撕销到零标注后，真正改变了几何的选区调整要清空 redo（否则旧对象会在新裁切坐标上复活），而中止并恢复原几何的调整不清。

**已确认的架构决定：** 合成归 Rust。马赛克只有一份实现（`mosaic.rs`），WebView 不自己算一遍，只显示 Rust 给的结果。理由：§5.3 要求预览与输出逐通道完全相同，而马赛克是唯一以销毁信息为目的的标注——两边不一致意味着用户看到某处被遮盖而实际没有。少一份算法实现就少一处不一致来源。

马赛克的关键规则及其测试：网格锚定图像 `(0,0)` 而非矩形自身原点；边缘不足整块只统计实际像素，不补零；多个马赛克各自从**同一份预马赛克合成图**取样，按创建顺序覆盖。最后这条最易错：从运行结果取样会让后一个依赖前一个，两者就无法各自复算。已用变异测试验证：把取样改成运行结果后，`a_later_mosaic_does_not_see_an_earlier_one_s_output` 失败；另一个重叠测试无法区分，这一点已写在该测试的注释里。

四舍五入用整数运算 `(sum + count / 2) / count`，不用浮点：它就是规格要的四舍五入，且不引入平台或 Rust/WebView 之间的浮点舍入模式差异。

**已可用：** 冻结底图 → 框选 → 遇罩/手柄/尺寸 → 工具条 → 选工具绘制标注 → undo/redo，放大镜在矄准时取色、框选完成后隐藏，键盘走 §7 调度（Esc 取消、Ctrl+Z/Y、Delete、方向键、`[`/`]`）。`ScreenshotOverlayApp.test.tsx` 用真实事件走完整链路（18 项）。

**尚未开始：** 文字输入框的 DOM（`pendingText` 已有状态但未渲染编辑器）、标注的选中拖动与变形、工具属性弹层、工具条顶部拖动区（§5.1 line 101）、Solar 工具图标（现为文字字符占位）、Playwright 验收。`mosaic.rs` 仍无调用方，它要等到导出（ 03-output）才有意义。

坐标映射是这一步最容易出错的地方：指针事件是 CSS 像素，选区必须是物理像素，本机 150% 下差 1.5×。比例从已渲染盒子读取而非假定缩放因子，否则四舍五入的窗口尺寸会与图像逐渐错位。越界指针返回 `null` 而不钳制，因为 §5.2 禁止读取授权范围外的像素。

**用失败测试找到并修正的一个真实 bug：** 工具条是截图表面的子节点，所以点击按钮会冒泡到画布的 pointerdown；在选择工具下它会在按钮位置做命中测试、落空，静默清空用户正要操作的选中对象。先写了会失败的测试（第 262 行断言真的挂了），再在工具条锚点上 `stopPropagation` 修正。注意单纯“点击不会画出图形”的测试是空跑的——点击是同一位置的 down+up，本来就会因零尺寸被丢弃，所以改成验证选中态是否存活。

写的过程中纠正了四处自己的错误：（1）给“无拖动单击”凭空定了 3px 阈值，而 §4.2 line 165 明确“最小有效选区为 1×1”；（2）工具条尺寸写死为 592×56，而 line 103 要求固定分组换行适配宽度，现改为渲染后实测；（3）在 `setState` updater 里调 `setDoc`，React 可能重跑 updater 导致同一标注提交两次，改为 ref 镜像；（4）一条方向键断言写成 `> 66` 而初值已是 100，是空跑的，改为与实测起始值比较。

取色分两条路径且有意为之：放大镜显示的 HEX 由 WebView 从底图 1:1 重绘单像素读回（PNG 无损，关掉平滑）；但 Ctrl+C 实际写入剪贴板的值将由 Rust 重新采样同一缓冲区，因为 §5.3 要求权威值与导出图像逐位一致，而 WebView canvas 原则上可能应用色彩管理。

键盘只对真正消费的按键调 `preventDefault`。`ignore` 不阻止默认行为，否则 Tab 会被吞掉、键盘用户因此被困在覆盖层里；这有单独测试。

工具条模型已完成（16 项测试）。顺序、分组、默认选择写成数据而非 JSX，所以不渲染也能断言。每个控件的可访问名称用 `translate()` 实测不等于原键，因为本项目的 i18n 缺失时回退到键名——只检查键存在会放过未翻译的控件。滚动禁用原因按「跨屏 → 已有标注 → 已是长图 → 环境不安全」判定，多因同时成立时取最具体的那一条（有单独测试，否则顺序只是巧合）。

导出期间的禁用范围比最初写的宽：我一开始只禁了 save/done，但 §8.1 要求「冻结本次版本」，所以绘图工具和撤销/重做也必须禁，否则输出的文件与用户看到的不一致。取消始终不禁，否则卡住的导出会困住会话。

放大镜布局已完成（15 项测试）。卡片宽固定 192，三档高度 269 / 189 / 93，均由 §2.3 常量推导。置位试错顺序是「每一档依次试四个角，全不符合才降档」，所以不会在 reduced 放得下时跳到纯数值。关键不变量：卡片要么整体符合，要么被拒，不存在被推到指针上的中间态——测试用一个辅助断言在每个置位用例上同时检查「在边距内」和「不覆盖指针」。只有视口小于最小卡片时才钳制，此时 `clamped: true` 显式报出。退让只作用于预览：三档宽度相同、缩放固定 8×、坐标/HEX/快捷键三行从不丢弃。

按键模型写成严格按 §7 顺序排列的 guard clause，因为规格真正要保证的是「每个按键只有一个处理者」：局部编辑不得顺带产生剪贴板或文件副作用。几个容易写错的点各有测试：未提交草稿的 Ctrl+C 返回 `ignore` 而不是复制半成品；四个滚动阶段的 Ctrl+C/S/Enter 全部不导出；文本控件内的 Ctrl+Z/Y 归文本而不动标注历史；第一个标注提交后方向键不再移动选区；焦点在按钮上时 Enter 不同时触发按钮和完成。

滚动阶段的 Esc 行为已在表中定下（prepare → editing、scrolling/paused → review、review → 丢弃长图），但滚动会话本身属 04，这几行现在只是模型层预先就位，不代表滚动截图已实现。

## 下一轮交接：渲染层

纯逻辑已全部就绪且有测试，下一轮只做渲染与接线。以下是开工前需要知道的事实，避免重新摸索。

### 可直接调用的现成接口

| 位置 | 提供 |
|---|---|
| `src/screenshot/screenshot-model.ts` | `selectionFromDrag`、`moveSelection`、`resizeSelection`（八向，`ResizeHandle` 为 `nw\|n\|ne\|w\|e\|sw\|s\|se`） |
| `src/screenshot/annotation-document.ts` | `emptyDocument`、`addAnnotation`、`updateAnnotation`、`deleteAnnotation`、`selectAnnotation`、`undo`/`redo`/`canUndo`/`canRedo`、`isSelectionLocked`、`noteSelectionGeometryChanged`、`cycleSelection` |
| `src/screenshot/key-dispatch.ts` | `dispatchKey(press, context)` 返回单一 `KeyAction`；组件只负责执行返回的动作，不得再自己判断优先级 |
| `src/screenshot/useCaptureFrame.ts` | 已拿到底图 `src`、物理宽高 |
| `src/screenshot/useCancelOnEscape.ts` | 已装 Esc 取消；接入 `dispatchKey` 后应改由它统一分发，不要两套监听共存 |
| `src-tauri/src/screen_capture/composite.rs` | 选区裁切、跨屏拼接、空隙填白、`sample_pixel`、`format_hex`（均未接线） |
| `src-tauri/src/screen_capture/mosaic.rs` | `apply_mosaics`（未接线） |

### 不能违反的决定

- **合成归 Rust。** 渲染层不得在 WebView 里再实现一遍马赛克或导出合成。预览可以用 Canvas 画轮廓，但最终像素必须来自 Rust。
- **坐标换算陷阱。** 覆盖窗口等于显示器物理矩形，底图 `<img>` 用 `width:100%/height:100%` 填满。图像是物理像素、CSS 是逻辑像素，在 1.5 缩放屏上差 1.5 倍。选区坐标必须用 `naturalWidth / 渲染框宽` 的比值换算，不能直接用 `clientX`。
- **标注参数是输出物理像素**，不是 CSS 尺寸：线宽 2/4/8（默 4）、字号 18/24/32（默 24）、马赛克块 8/16/24（默 16）。预览倍率不得改变输出像素。
- **截图内容不是应用表面**（§2.3）：原始像素和裁切边界不加 15.2px 圆角；控制点是 8×8 实心方形 + 24×24 透明命中区，不套普通按钮圆角；放大镜网格用最近邻，无模糊无装饰动效。
- **编辑工具条用标准档** 40×40、图标 18px，不沿用 Bar 的紧凑档 28/16。
- **无补间动画、无 Toast、无 spinner**；状态与错误是来源控件旁的静态文案。

### 工具条固定顺序（§5.1）

三组，组间 1px 分隔：

1. 选择、矩形、椭圆、箭头、画笔、文字、马赛克
2. 撤销、重做、滚动截图
3. 保存、取消、完成

初次框选默认「选择」。完成的 Tooltip 写「复制图片并完成」，保存写「另存为 PNG」；不增加语义重复的独立复制按钮。状态用 `aria-pressed` 与视觉双重表达。

### 图标管线

`scripts/generate-icons.mjs` 里是「名称 → Solar slug」映射表（已有 `Crop: 'crop-minimalistic'`），运行后生成 `src/components/icon-data.ts`（生成文件，不手改），`src/components/icons.tsx` 用 `createIcon('Name')` 消费。添加工具图标：先补映射表 → 跑生成器 → 在 `icons.tsx` 加 `createIcon`。图标统一 Solar，不得内联新 SVG。

### 验证命令

```
npx vitest run src/screenshot/          # 截图前端，当前 82 项
npx tsc --noEmit -p tsconfig.json      # 无输出即干净；vitest 通过不代表类型正确
cargo test --manifest-path src-tauri/Cargo.toml screen_capture   # 当前 68 项
npm test && npm run build
rustfmt --edition 2021 <本次改动的叶子文件>   # 不跑 cargo fmt
```

### 已知风险

- `composite.rs`、`mosaic.rs`、`key-dispatch.ts` 都还没有调用方，`dead_code` 警告属预期。接线时如果发现接口不好用，改接口比绕过它们好。
- 导出（复制/保存）属 03-output，尚未开始。工具条的保存/完成按钮可以先渲染并接 `dispatchKey` 的动作，但真实导出要等 03；在那之前不要假装成功。

## 指针命中判定（本轮新增）

命中判定按对象种类分开，而不是所有对象共用一个包围盒。理由是具体的：§5.2 的矩形和椭圆用 `fill="none"` 绘制，内部不属于它们。如果把包围盒当作可命中区域，一个框住某片区域的矩形就会吞掉画在里面的每一个对象——用户框完一圈，圈内的东西再也选不中。文字和马赛克是实心的，所以对这两类用面积才是对的。

- 描边对象（矩形、椭圆、箭头、画笔）按轮廓命中，容差 = 6 CSS px + 半个描边宽度。
- 容差用 CSS 像素表达再按显示比例换算：写死物理像素会让 DPI 越高目标越小。两项测试分别在 100% 和 150% 下断言同一个点的不同结果。
- 椭圆用归一化近似距离，注释里写明了它在极扁椭圆的长轴方向会低估，作为指针容差够用，不当通用距离函数使用。
- 命中搜索从最新对象往回找：后画的盖在先画的上面，否则会选中看不见的对象。

## 两处重复实现的合并（自我纠正）

`useAnnotationDrawing.ts` 里原本有自己的 `hitTest`，只按包围盒判定，并在 select 工具下直接改选中态。这一轮新增 `useAnnotationEditing` 后就成了两份实现同一个决定——必然漂移。已删除绘制钩子里的 select 分支和 `hitTest`，选中态只有一个归属；同时删掉随之失效的三项测试（它们的职责已被新钩子的测试覆盖，且新测试还能区分轮廓与内部），保留"select 工具下不画任何东西"并补了一项"不碰文档"。

`updateAnnotation` 的入参类型原本是 `Partial<Omit<Annotation, 'id' | 'kind'>>`。`Omit` 作用在联合类型上会塌缩成各分支的公共键，于是画笔的 `points` 和文字的 `content` 根本无法表达——移动画笔必须同时移动采样点，这个合法编辑被类型挡住了。改为分配式的 `ChangesOf<T>`。

## 一处陈旧闭包 bug

`useAnnotationEditing` 的按下、移动、释放可能在 React 重渲染之前全部到达，所以回调捕获的 `doc` 可能早于按下时刚做的选中。提交这个陈旧值会丢掉 `selectedId`，每次拖动结束对象都会自己取消选中。用 `docRef` 镜像修正——这与绘制钩子里 `stateRef` 的理由相同。集成测试先失败、修正后转绿。

## 一处变异测试存活（诚实记录）

把"先问对象、再问选区"的顺序反过来，**没有任何测试失败**。原因是 §4.2 的锁定规则让两者互斥：有标注时选区锁定，undo 到零标注时解锁，所以二者永远不会同时可用。当前这个顺序因此不承重。代码里保留该顺序并写明了原因：它是 §4.2 line 170 描述的读法，如果将来放宽锁定规则，它已经是正确的那一种。

## 取色复制的归属

Ctrl+C 传坐标而不传颜色字符串：§4.1 line 157 要求在冻结底图的原始像素上采样，如果由 WebView 采样再把 HEX 发过去，canvas 的色彩管理差异就可能让"告诉用户复制了的值"和"文件里的值"不一致。`format_hex` 独立可测（4 项，含补零与恒为 7 字符）。桌面空隙返回 `false` 而不是报错——§4.1 line 159 要求此时不动剪贴板，提示也不能声称复制成功。

## 一处四次修错的 bug（诚实记录）

Ctrl+C 接线后集成测试连续失败四次，每次我都改了一个"看起来相关"的地方：`applyKey` 的依赖数组、在 ScreenshotApp 里加 ref 镜像、把镜像从渲染期改到事件期、再改为由 `useSelection` 暴露。真正的原因是：那个"事件期写入 ref"的编辑批次里 `edits[1]` 匹配失败，而 edit 工具是原子的，整批回滚——所以**写入那一行从来没有存在过**，声明和 return 却都在。探针打出 `at= null` 四次，我读作"值不对"，实际是"没人写"。

教训是过程性的：同一症状连续失败两次之后就不该继续改下一个可疑点，应当先确认上一次的改动真的落到了文件里。`grep` 一次就能看出 `pointerPixelRef` 只有声明和返回、没有赋值。

顺带发现的真实设计约束：`state.box` 由同一个 pointermove 事件设置，所以调用方在第一次移动时**无法**自己换算坐标——ref 必须由拥有该状态的钩子在事件内写入，这不是风格选择。

## 属性面板

§5.2 固定了取值集合,所以是离散选项而不是滑块或自由取色器:自由取色器会让用户选到规格不允许的颜色,滑块则暗示存在不存在的中间值。

同一个面板承担两件事,区别很重要:有选中对象时编辑该对象,是一个撤销事务;没有选中时设置下一个图形的默认值,**不进历史**。后者若进历史,Ctrl+Z 会看起来什么都没做。两条各有测试。

逐类行也不是可有可无:马赛克的像素来自图像,没有用户可选的颜色,给它一个颜色行等于告诉用户改动生效了而实际没有;文字有字号而没有描边宽度。

**又一处变异测试存活(已修正为删除):** 我在面板上加了 `onPointerDown` 的 `stopPropagation`,注释写着"防止点击穿透到画布导致取消选中"。变异测试把它改成空函数后**没有任何测试失败**——因为面板渲染在工具栏 anchor 内部,而 anchor 早已拦截 pointerdown/move/up 三者。那个守卫是死代码,测试通过靠的是父节点。已删除并写明原因,而不是留着一段声称自己有作用的代码。
