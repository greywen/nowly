# 安装与发布

## 本地安装

1. 进入编辑模式 → 点「添加模块」→「我的模块」→「上传模块」。
2. 选择你的 `.js` 文件。App 会解析清单头。
3. 如果声明了 `network`，会弹出**风险确认弹窗**，列出可访问的域名，用户确认后才安装。

开发期不必反复走这条路，用 [preview.md](./preview.md) 的实时预览通道。

## 发布到模块市场

模块市场是**去中心化**的：一个公开的 `registry.json` 索引 + 各模块自行托管的 `.js` 文件。

1. 把你的 `.js` 文件托管到任意 https 可访问的地方（GitHub Raw、CDN 等）。
2. 向 registry 仓库提交一条索引记录（PR）：

```json
{
  "id": "weather-widget",
  "name": "天气",
  "version": "1.0.0",
  "author": "yourname",
  "description": "显示当前城市的实时天气",
  "permissions": ["state", "network"],
  "network": ["api.open-meteo.com"],
  "sourceUrl": "https://raw.githubusercontent.com/you/repo/main/weather-widget.js"
}
```

3. PR 合并后，其他用户就能在 App 的「模块市场」里搜索、下载、安装你的模块。

索引字段必须与文件里的清单头一致（见 [manifest.md](./manifest.md)）。用户从市场安装时，App 会下载 `sourceUrl`、解析清单头、（带 network 时）弹风险确认，再落库。

索引的校验规则与本地校验脚本见 [registry/README.md](../../registry/README.md)。
