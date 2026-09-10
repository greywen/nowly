# 提交前检查清单

发布或交付前逐条自检。前 12 条对应 [SKILL.md](./SKILL.md) 的硬约束，违反即安装失败或运行时报错；其余是质量基线。

## 清单头

- [ ] 文件顶部有合法清单头，`@nowly-module 1` / `@id` / `@name` / `@version` 齐全。
- [ ] `@id` 只含小写字母、数字、连字符。
- [ ] 用到的每个 `host` 能力都在 `@permissions` 里声明了。
- [ ] 用了 `host.fetch` 就声明了 `network` 权限并在 `@network` 列出所有域名。
- [ ] `@minSize` 是「内容仍可用」的尺寸，不是「不报错」的尺寸。

## 沙箱约束

- [ ] 是纯 JS：没有 `import` / `require` / JSX / TypeScript 语法。
- [ ] 没有直接用 `fetch` / `XMLHttpRequest` / `WebSocket`；联网只走 `host.fetch`。
- [ ] 没有加载远程脚本 / 字体 / 图片。
- [ ] 没有无界循环（`while (true)` / `for (;;)`）；所有循环有明确边界。
- [ ] 模块源码未超过 256 KiB（第三方库内联也要克制体积）。
- [ ] 在 `root` 上手动渲染，没有假设父页面存在任何元素。

## 视觉

- [ ] 没有颜色字面量（`#` / `rgb()` / `hsl()`）；颜色一律 `var(--nm-*)` 或套 `nm-*` 类。
- [ ] 没有任何 `transition` / `animation` / 动效。
- [ ] 若声明了 `@motion animated`，已用 `host.onVisibilityChange` 在不可见时暂停动画；默认 `static` 模块无任何持续动效。
- [ ] 视觉严格对齐 `design.md`：圆角、字号、字重、行高、间距、边框、阴影都落在其规定的档位上，没有 `14px` / `18px` / `10px 14px` 这类拍脑袋的近似值。
- [ ] 超出便捷类的组件（图标按钮、卡片头、chip、下划线 Tab、复选框 / 单选、状态徽标、下拉浮层等）按 `design.md` 对应小节的确切数值用 `--nm-*` 令牌手写，没有自造近似样式。
- [ ] 三档断点下都验过：紧凑档没有横向溢出，宽松档没有大片空白。

## 交互与可达性

- [ ] 纯图标按钮（只含 `<svg>`、无可读文字）都带了 `aria-label`（或 `aria-labelledby` / `title` / svg 内 `<title>`）。命令式构建（`createElement`）时校验器扫不到，靠自觉。
- [ ] 每个可交互元素都实现了 `design.md` §9 要求的静态状态（default / hover / active / focus-visible / disabled，必要时 error），且只即时改颜色 / 背景 / 边框 / 阴影。
- [ ] 自己实现的下拉 / 日期 / 时间类控件键盘可达（`Tab` 聚焦、方向键操作、`Esc` 关闭）；能用 [widgets.md](./widgets.md) 的现成部件就别自己拼。

## 健壮性

- [ ] `host.fetch` 和 `host.loadState` 都做了错误处理（`try/catch`），失败时给用户可读提示。
- [ ] 预览页 lint 输出为「通过」（见 [preview.md](./preview.md)）。
