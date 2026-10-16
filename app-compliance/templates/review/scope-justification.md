# {{productName}} / {{providerLabel}} Scope 用途说明

> 本文由配置生成。提交前请确认配置中的 scope 与发布版本实际请求的 scope 完全一致。

## Scope 明细

{{scopeTableMarkdown}}

## 统一数据处理说明

用户在 {{productName}} 中主动点击连接账户后，浏览器打开 {{providerLabel}} 授权页面。授权完成后，应用通过本机回调接收授权结果，并只在用户已同意的范围内访问资源。用户可以选择要显示的日历，也可以在应用设置中随时断开账户。

{{calendarBehavior}}

{{tokenStorageDescription}}

{{calendarStorageDescription}}

