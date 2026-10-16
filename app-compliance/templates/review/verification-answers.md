# {{productName}} Google OAuth 审核填写材料

> 这是复制粘贴到 Google Cloud OAuth 应用验证表单的草稿。提交前必须复核所有产品、主体、联系信息、测试账号和演示视频信息。

## 1. 应用功能

{{productName}} 是你的 Windows 个人工作桌面。用户可以将自己的 {{providerLabel}} 连接到应用，在一个本地优先的工作台中选择和查看日历及事件，并执行由用户明确发起的事件创建、编辑、移动、时长调整和删除操作。日历连接不是后台替用户寻找或分析其他人的数据，而是用户在应用设置中主动启用的功能。

## 2. 为什么需要这些权限

{{scopeTableMarkdown}}

完整 Calendar 权限是因为当前版本同时支持读取日历和事件，以及用户发起的创建、编辑、移动、调整时长和删除事件。若发布版本改为只读，必须在重新提交前同步收窄 scope 和本材料。

## 3. 授权流程和安全措施

- 用户在 {{productName}} 的日历设置中点击连接账户。
- 应用使用 Authorization Code + PKCE 发起 OAuth 流程。
- 浏览器授权完成后，回调返回到本机 `127.0.0.1` 的临时 loopback 端口，不是公开网站。
- 应用使用随机 `state` 校验回调，降低 CSRF 风险。
- {{tokenStorageDescription}}
- 公开材料网站不接收 OAuth 回调、Client Secret、access token 或 refresh token。

## 4. 数据使用和删除

{{calendarBehavior}}

{{calendarStorageDescription}}

用户可以在应用中断开账户。断开后会删除本机连接账户、令牌、订阅配置和相关本地事件数据。{{providerLabel}} 账户中的原始数据仍由用户和平台控制。

## 5. 广告、出售和第三方共享

{{thirdPartyDataStatement}}

{{analyticsStatement}}

### 可选 AI 外部日历上下文

AI 助手需用户自行配置模型服务，并单独允许外部日历读取。启用后，查询到的本机 Google 日历缓存可能作为工具结果连同输入及对话历史发送给该模型服务；结果可能包含事件标题、时间、来源、描述和地点等查询字段。OAuth 凭证不作为模型上下文。AI 对外部事件只读，普通日历编辑的远端写入仍需用户授权。

该传输属于用户主动请求的辅助功能，不用于广告、出售数据或训练、开发、改进通用模型，必须遵守 Google API Services User Data Policy 的 Limited Use 要求。提交前核对所用模型服务的保留、训练与处理条款，不将任意第三方配置描述为自动符合平台政策；若无法满足要求，应关闭外部日历 AI 读取，不在审核中隐瞒此数据流。

## 6. 审核测试信息

- Google Cloud 项目：`nowly-507401`
- 测试账号：`{{testAccount}}`
- Nowly 版本：`{{appVersion}}`
- 演示视频：`{{videoUrl}}`
- 首页：`{{officialDomain}}/`
- 隐私政策：`{{officialDomain}}/privacy.html`
- 服务条款：`{{officialDomain}}/terms.html`
- 数据删除：`{{officialDomain}}/data-deletion.html`
- 支持页面：`{{officialDomain}}/support.html`

## 7. 提交前核对

- [ ] 公开域名已经部署并可以使用 HTTPS 访问。
- [ ] 域名已经在 Google Cloud 中完成所有权验证。
- [ ] OAuth 品牌资料中的应用名称、支持邮箱、首页和隐私政策 URL 与公开站点一致。
- [ ] 测试账号能完成授权并看到日历列表。
- [ ] 视频使用专门测试账号，没有展示真实个人日历、令牌、Client Secret 或本地路径。
- [ ] 公司负责人已确认隐私政策、服务条款、数据删除邮箱和实际数据处理行为。
