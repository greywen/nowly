# 运行契约：`host` 能做什么

```js
Nowly.defineModule(async ({ host, root }) => { ... });
```

`host` 是模块与 App 之间**唯一**的桥梁，`root` 是你唯一能操作的 DOM 容器。`host` 的能力由清单头声明的 `@permissions` 决定（见 [manifest.md](./manifest.md)）。

| 成员 | 需要权限 | 说明 |
|---|---|---|
| `host.moduleId` | 无 | 模块的稳定 id（也是状态存储的键） |
| `host.todayIso` | `today` | 今天的本地日期，格式 `YYYY-MM-DD`。未授权时为 `undefined` |
| `host.loadState()` | `state` | 返回上次保存的状态（已 JSON 解析），没有则返回 `null` |
| `host.saveState(value)` | `state` | 保存状态，`value` 必须可 JSON 序列化。覆盖上一次的值 |
| `host.fetch(url, options?)` | `network` | 代理网络请求，仅放行 `@network` 白名单内的域名 |
| `host.isVisible()` | 无 | 返回当前是否可见（在视野内且窗口前台）。同步读当前状态 |
| `host.onVisibilityChange(fn)` | 无 | 注册可见性回调，`fn(visible)` 在状态变化时触发，注册时也立即触发一次当前值。返回一个取消注册的函数 |
| `host.surface` | 无 | 当前面：`'main'`（卡片）或 `'dialog'`（弹框）。同一份源码在两个面各跑一份 |
| `host.openDialog(title?)` | 无 | 请求宿主打开弹框面。可传标题，显示在弹框标题栏。已打开时重复请求被忽略 |
| `host.closeDialog()` | 无 | 请求宿主关闭弹框面。任一面都可调用 |
| `host.onStateChanged(fn)` | `state` | 注册状态变更回调。另一个面 `saveState` 成功后触发 `fn()`，用于重新 `loadState` 刷新。返回取消注册的函数 |

所有调用被限流为**每秒最多 30 次**，超出会被拒绝。

`host.fetch` 和 `host.loadState` 都要 `try/catch`，失败时给用户可读提示。

---

## 弹框面（突破卡片边界）

`2x2` 卡片约 195×143px，放不下设置面板。模块可以调用 `host.openDialog()` 请求宿主打开一个**弹框面**：宿主渲染一个 Dialog 外壳（含关闭按钮、Esc 关闭、焦点管理），里面加载**同一份模块源码**的第二个实例。两个面靠 `host.surface` 区分自己是 `'main'` 还是 `'dialog'`，据此渲染不同内容。

两个面共享同一 `moduleId`，因此读写**同一行状态**。一个面 `saveState` 后，宿主会向另一个面广播状态变更——收到的那一面用 `host.onStateChanged` 重新 `loadState` 刷新，否则弹框改完设置主面仍显示旧值。

**弹框高度随内容自适应，别写死高度。** 宿主会测量弹框面内容的自然高度并把 Dialog 撑到刚好包住内容（超过视口上限时封顶并让弹框内部滚动）。因此弹框面不要在 `root` / `body` / `html` 上写死 `height`，也不要为了「撑满」而套 `height:100%` 的外层——那会把内容拉伸、量出的高度失真。让内容按自身高度自然堆叠即可（纵向字段间距 20px，操作按钮靠右）。内容变化（展开下拉、增删字段）时宿主会重新测量并调整。

```js
Nowly.defineModule(async ({ host, root }) => {
  async function render() {
    const state = (await host.loadState()) || { count: 0 };
    root.textContent = '';
    if (host.surface === 'dialog') {
      // 弹框面：完整设置面板
      const btn = document.createElement('button');
      btn.className = 'nm-btn';
      btn.textContent = '加一';
      btn.addEventListener('click', async () => {
        await host.saveState({ count: state.count + 1 });
        await render();
      });
      root.appendChild(btn);
    } else {
      // 主面：紧凑展示 + 打开设置的入口
      const value = document.createElement('p');
      value.textContent = '计数：' + state.count;
      const open = document.createElement('button');
      open.className = 'nm-btn';
      open.textContent = '设置';
      open.addEventListener('click', () => host.openDialog('模块设置'));
      root.appendChild(value);
      root.appendChild(open);
    }
  }
  // 另一个面保存后刷新本面，避免显示过期状态。
  host.onStateChanged(() => { void render(); });
  await render();
});
```

---

## 可见性与 `@motion animated`（耗电治理，强制）

Nowly 是常驻桌面应用，模块的渲染跑在与应用**共享的渲染线程**上。一个滚出视野还在跑 `requestAnimationFrame` 的模块会持续唤醒 GPU / 风扇。因此：

- 只有声明 `@motion animated` 的模块才允许在内容区做持续动效（逐帧 rAF）。默认 `static` 模块不得有任何补间/循环动画。
- 声明 `animated` 的模块**必须**用 `host.onVisibilityChange` 在不可见时暂停动画循环、可见时恢复。校验器会拒绝「声明了 animated 却没有 `onVisibilityChange`」的模块。
- 「不可见」包含三种情形，宿主统一下发：模块滚出视野、应用窗口最小化/切后台、进入专注模式。

```js
let raf = 0;
function frame() { /* 逐帧绘制 */ raf = requestAnimationFrame(frame); }
host.onVisibilityChange(function (visible) {
  if (visible) { if (!raf) raf = requestAnimationFrame(frame); }
  else { cancelAnimationFrame(raf); raf = 0; }
});
```

时钟走字、倒计时每秒重绘这类**离散**更新（`setInterval` 每秒一次）不算持续动效，属 `static`，无需声明 `animated`。

---

## `host.fetch` 详解

```js
const res = await host.fetch('https://api.open-meteo.com/v1/forecast?...', {
  method: 'GET',              // 'GET'（默认）或 'POST'
  headers: [['Accept', 'application/json']],  // 可选，[[name, value], ...]
  body: JSON.stringify({...}) // 可选，仅 POST 用
});

// 返回：
// res.ok      → boolean，HTTP 状态是否 2xx
// res.status  → number，HTTP 状态码
// res.headers → [[name, value], ...]
// res.text    → string，响应体文本
// res.json    → 已解析的 JSON（解析失败为 null）
```

约束（由 App 后端强制，无法绕过）：

- 只允许 **https**。
- 目标域名必须在 `@network` 白名单内。
- 只支持 **GET / POST**。
- 禁止重定向、禁止内网 / 环回地址。
- 响应体上限约 1MB，请求 8 秒超时。
- `Cookie`、`Authorization`、`Origin` 等敏感头会被后端丢弃。
