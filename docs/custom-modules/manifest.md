# 清单头与文件结构

一个模块文件由两部分组成：**清单头**（顶部块注释）+ **模块代码**（`Nowly.defineModule` 调用）。

```js
/**
 * @nowly-module 1
 * @id           weather-widget
 * @name         天气
 * @version      1.0.0
 * @author       yourname
 * @description  显示当前城市的实时天气
 * @permissions  state, today, network
 * @network      api.open-meteo.com
 * @minSize      3x3
 * @defaultSize  4x4
 */
Nowly.defineModule(async ({ host, root }) => {
  // 你的代码
});
```

清单头必须是文件**最顶部**的第一个 `/** ... */` 块注释（前面只能有空白）。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `@nowly-module` | 是 | 清单版本号，当前恒为 `1` |
| `@id` | 是 | 稳定标识，只能是小写字母、数字、连字符（`[a-z0-9-]`）。用于去重和升级 |
| `@name` | 是 | 显示名称 |
| `@version` | 是 | 语义化版本号，如 `1.0.0`，用于市场的更新检测 |
| `@author` | 否 | 作者名 |
| `@description` | 否 | 一句话描述 |
| `@permissions` | 否 | `state` / `today` / `network`，逗号分隔。不声明就没有对应能力 |
| `@network` | 声明 network 时**必填** | 允许访问的域名，逗号分隔。`host.fetch` 只放行这些域名 |
| `@minSize` | 否 | 最小尺寸 `宽x高`（格数），默认 `2x2`。必须声明为「内容仍可用」的尺寸，不是「不报错」的尺寸 |
| `@defaultSize` | 否 | 初始尺寸 `宽x高`（格数），默认 `4x4`。宽 2–12，高 2–8 |
| `@motion` | 否 | `static`（默认）或 `animated`。声明 `animated` 表示内容区有持续动效，安装时会告知用户，且**必须**响应可见性暂停，见 [runtime.md](./runtime.md) |

格数与像素的换算见 [size.md](./size.md)。
