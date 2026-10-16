# Nowly 应用合规材料

这里保存 Nowly（你的 Windows 个人工作桌面）面向应用商店和 OAuth 平台的合规材料。当前包含 Google Calendar 的审核材料，并为 Microsoft Calendar 保留扩展边界；预留材料不表示平台审核已经通过。

产品官网源码已独立到 `website/`，构建和发布见 [官网开发与发布](../docs/website.md)。正式域名根目录只部署 `website/dist/`；本目录的公开模板保留为平台连接说明与审核工具，不再作为完整产品官网。旧法律页面路径由新站兼容输出，不能直接删除整个合规目录。

## 目录

```text
app-compliance/
├── google/nowly/
│   ├── config.json       # Google 公开材料配置
│   ├── site/             # 生成后部署到 HTTPS 域名
│   └── review/           # 提交 Google 审核时使用
├── microsoft/nowly/      # Microsoft 预留边界
├── templates/            # 公共 HTML、CSS、Markdown 模板
├── scripts/              # 生成与校验工具
└── deploy/               # Nginx / IIS 示例
```

## 生成与校验

在仓库根目录执行：

```powershell
node app-compliance/scripts/generate-site.mjs google nowly
node app-compliance/scripts/validate-materials.mjs app-compliance/google/nowly
```

仓库只分发 `google/nowly/config.json.example`。先复制为同目录的本地 `config.json`；实际配置与生成输出保持忽略，不能提交审核账号或视频字段。样例故意包含 `REPLACE_BEFORE_DEPLOY_` 标记，因此生产生成会失败并列出必须补充的字段。你需要先填写：

- 正式公司名称和公开地址；
- 官网域名；
- 支持、隐私和数据删除邮箱；
- 隐私政策/服务条款生效日期；
- Google 审核测试账号和演示视频地址。

Nowly 版本号不在配置里填写，生成器直接从仓库根目录 `package.json` 读取。

本地查看模板可以使用：

```powershell
node app-compliance/scripts/generate-site.mjs google nowly --preview
node app-compliance/scripts/validate-materials.mjs app-compliance/google/nowly --preview
```

`--preview` 允许占位字段保留，只适合本地检查页面结构，不得部署到正式域名，也不得提交 Google 审核。

使用 `--output <dir>` 输出到其他目录时，校验器需要原始配置，生成器会打印带 `--config <原始配置路径>` 的完整命令。它不把含审核字段的配置复制到输出或部署目录。预览生成后的校验也必须加 `--preview`。

生成器只输出静态 HTML、CSS 和 Markdown，不需要 Next.js、Node.js 生产运行时、数据库或后端服务。生成后的 `site` 目录可以部署到 Nginx、IIS、Cloudflare Pages 或静态对象存储。

## 安全边界

此目录可能被上传到服务器或作为审核材料提供给第三方，因此绝不能放入：

- Google/Microsoft `client_secret`；
- refresh token、access token 或私钥；
- `src-tauri/oauth-credentials.json`；
- SQLite 数据库、日志或崩溃转储；
- 真实用户的日历导出、邮箱或个人资料；
- 任何只适合本机编译环境的 OAuth 配置。

终端用户不需要配置 Client ID。Client ID 由 Nowly 的发布构建注入，公开材料只解释用户点击连接、同意权限和使用日历的流程。

## 发布流程

1. 修改对应产品的 `config.json`；
2. 运行生产生成命令；
3. 运行材料校验命令；
4. 构建产品官网，将 `website/dist/` 内容部署到 HTTPS 域名根目录；`google/nowly/site/` 仅作为权限与材料核对输出，不覆盖新版官网，`review/` 永不部署；
5. 从真实浏览器访问首页、隐私政策、服务条款、数据删除和支持页面；
6. 在 Google Cloud 中验证域名并填写相同的品牌网址；
7. 将 `google/nowly/review/` 中的内容复制到审核表单；
8. 使用专门的测试账号录制未列出的审核演示视频；
9. 提交前由公司负责人确认隐私政策、服务条款、联系方式和数据删除流程。

Google 项目、域名验证和应用验证状态不会由本目录自动完成，也不会在材料中被假定为已经完成。

## 为其他公司生成材料

复制 `google/nowly/config.json` 为新的产品配置，修改产品和公司公开信息，然后使用：

```powershell
node app-compliance/scripts/generate-site.mjs google other-product
node app-compliance/scripts/validate-materials.mjs app-compliance/google/other-product
```

平台和产品是两层目录，便于未来分别维护 `google/<product>` 和 `microsoft/<product>`。

