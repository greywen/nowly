# Nowly 模块市场（Registry）

这里是 Nowly "模块市场"的去中心化索引。App 读取 `registry.json` 展示可安装的模块列表，用户点安装时下载对应源码、校验、落库运行。

- 索引文件：`registry.json`
- 模块源码：`modules/*.js`（推荐提交进本仓库，审核与文件走同一个 PR）
- 校验脚本：`validate.mjs`（本地和 CI 都跑它）

编写模块的完整规范见 [`docs/custom-modules/SKILL.md`](../docs/custom-modules/SKILL.md)。

## 如何发布一个模块

### 1. 写好模块文件

按 `SKILL.md` 写一个自描述的 `.js`，顶部带清单头。放到 `modules/你的-id.js`。

### 2. 计算 sha256

```bash
sha256sum registry/modules/你的-id.js
# 或
shasum -a 256 registry/modules/你的-id.js
```

### 3. 在 registry.json 里加一条记录

```json
{
  "id": "你的-id",
  "name": "显示名",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "一句话描述",
  "permissions": ["state", "today"],
  "network": [],
  "license": "MIT",
  "motion": "static",
  "minW": 3,
  "minH": 2,
  "defaultW": 4,
  "defaultH": 3,
  "sourceUrl": "https://raw.githubusercontent.com/greywen/nowly/main/registry/modules/你的-id.js",
  "sha256": "上一步算出的哈希"
}
```

字段规则：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一，`[a-z0-9-]`，必须与清单头 `@id` 一致 |
| `name` | 是 | 与清单头 `@name` 一致 |
| `version` | 是 | semver，更新时必须比上一版高 |
| `permissions` | 是 | 与清单头 `@permissions` 一致 |
| `network` | 是 | 与清单头 `@network` 一致；无联网填 `[]` |
| `license` | 是 | 许可证标识（如 `MIT`）。去中心化分发下可能引入第三方代码，许可信息必须随索引可见 |
| `motion` | 否 | `static`（默认）或 `animated`，须与清单头 `@motion` 一致 |
| `sourceUrl` | 是 | https 地址，指向模块源码 |
| `sha256` | 是 | 源码的 sha256，App 下载后会校验，不匹配拒装 |

### 4. 本地自检后提 PR

```bash
node registry/validate.mjs
```

通过后提交 PR。CI 会自动跑同样的校验，maintainer 审核后合并。

## 更新一个已有模块

改 `modules/你的-id.js`，重算 sha256，提升 `registry.json` 里的 `version`，更新 `sha256` 字段，提 PR。

## 审核清单（maintainer）

CI 自动校验：schema、id 唯一、semver 递增、清单与索引一致、sha256 匹配、危险模式扫描。

CI 通过后，maintainer 人工确认：

- 权限最小化：只申请了必要的 `permissions`。
- 白名单合理：`network` 域名可信、与功能相符、无可疑数据回传域名。
- 源码可信：无混淆、无外泄 `host` 数据、无滥用 `host.fetch`。
- 名称/描述真实，不误导。

全部满足才合并。
