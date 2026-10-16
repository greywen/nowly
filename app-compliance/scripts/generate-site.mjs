import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBaselineVersion } from '../../scripts/version-sync.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_ROOT = path.join(ROOT, 'templates');
export const PUBLIC_PAGE_FILES = ['index.html', 'privacy.html', 'terms.html', 'data-deletion.html', 'support.html'];
export const REQUIRED_SITE_FILES = [...PUBLIC_PAGE_FILES, 'site.css', ...PUBLIC_PAGE_FILES.map((file) => `zh-CN/${file}`)];
export const REQUIRED_REVIEW_FILES = ['README.md', 'scope-justification.md', 'verification-answers.md', 'demo-video-script.md'];

const DEPLOYMENT_MARKER = /REPLACE_BEFORE_DEPLOY(?:_[A-Z0-9]+)+/g;
const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPE[character]);
}

export function parseArgs(argv) {
  const positional = [];
  let preview = false;
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--preview') {
      preview = true;
    } else if (arg === '--output') {
      output = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  return { provider: positional[0], product: positional[1], preview, output };
}

export async function loadConfig(provider, product) {
  const configPath = path.join(ROOT, provider, product, 'config.json');
  const examplePath = path.join(ROOT, provider, product, 'config.json.example');
  const selectedPath = await fileExists(configPath) ? configPath : examplePath;
  if (!(await fileExists(selectedPath))) {
    throw new Error(`配置不存在：${path.relative(process.cwd(), configPath)}`);
  }
  try {
    return { config: JSON.parse(await fs.readFile(selectedPath, 'utf8')), configPath: selectedPath };
  } catch (error) {
    throw new Error(`无法解析配置 ${selectedPath}：${error.message}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function findMarkers(value, prefix = '') {
  const found = [];
  if (typeof value === 'string' && DEPLOYMENT_MARKER.test(value)) {
    found.push(`${prefix || 'config'}=${value}`);
    DEPLOYMENT_MARKER.lastIndex = 0;
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findMarkers(item, `${prefix}[${index}]`)));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => found.push(...findMarkers(item, prefix ? `${prefix}.${key}` : key)));
  }
  return found;
}

export function validateConfig(config, { preview = false } = {}) {
  const errors = [];
  const requiredStrings = ['productName', 'productDescription', 'productDescriptionEn', 'companyName', 'companyNameEn', 'companyAddress', 'companyAddressEn', 'officialDomain', 'authorizedDomain', 'supportEmail', 'developerEmail', 'privacyEmail', 'dataDeletionEmail', 'effectiveDate', 'lastUpdated', 'provider', 'providerLabel', 'locale'];
  requiredStrings.forEach((field) => {
    if (typeof config[field] !== 'string' || !config[field].trim()) errors.push(`缺少配置字段：${field}`);
  });
  if (!Array.isArray(config.oauthScopes) || config.oauthScopes.length === 0 || config.oauthScopes.some((scope) => typeof scope !== 'string' || !scope.trim())) {
    errors.push('oauthScopes 必须是非空字符串数组');
  }
  if (!config.features || typeof config.features !== 'object') errors.push('缺少 features 配置');
  if (!config.review || typeof config.review !== 'object') errors.push('缺少 review 配置');
  const markers = findMarkers(config);
  if (!preview && markers.length) errors.push(`存在未替换字段：${markers.join('; ')}`);
  try {
    const domain = new URL(config.officialDomain);
    if (domain.protocol !== 'https:') errors.push('officialDomain 必须使用 HTTPS');
  } catch {
    errors.push('officialDomain 必须是有效的 HTTPS URL');
  }
  for (const field of ['supportEmail', 'developerEmail', 'privacyEmail', 'dataDeletionEmail']) {
    if (typeof config[field] === 'string' && !preview && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config[field])) errors.push(`${field} 不是有效邮箱`);
  }
  return errors;
}

function scopeDetails(provider, scope) {
  const details = {
    openid: ['识别授权主体', 'OpenID Connect 身份标识', '用于建立本地连接账户并区分授权主体', '只保存连接所需的账户标识，不用于广告画像'],
    email: ['显示账户标签', '授权账户的邮箱地址', '帮助用户在 Nowly 中区分多个已连接账户', '仅作为账户标签展示和本地账户管理的一部分'],
    'https://www.googleapis.com/auth/calendar': ['同步 Google 日历', '已授权日历、日历列表和事件', '当前版本支持读取并执行用户发起的事件创建、编辑、移动、时长调整和删除', '只用于用户在 Nowly 中查看和管理已授权日历'],
    offline_access: ['维持 Microsoft 连接', '可用于刷新授权的离线访问权限', '在用户已同意且应用需要继续同步时保持连接', '仅由 Microsoft 授权流程使用，不用于广告或出售数据'],
    'https://graph.microsoft.com/Calendars.ReadWrite': ['同步 Microsoft 日历', '已授权日历和事件', '支持读取以及用户发起的创建、编辑和删除操作', '只用于用户在 Nowly 中查看和管理已授权日历']
  };
  const fallback = ['平台授权权限', scope, `用于 ${provider} 连接功能的实际资源访问`, '仅用于用户主动启用的产品功能'];
  const [purpose, data, necessity, handling] = details[scope] ?? fallback;
  return { purpose, data, necessity, handling };
}

function scopeDetailsEn(provider, scope) {
  const details = {
    openid: ['Identify the authorized user', 'OpenID Connect subject identifier', 'Creates a local connection and distinguishes authorized accounts', 'Used only to maintain the account connection; not used for advertising profiles'],
    email: ['Display an account label', 'Email address of the authorized account', 'Helps users distinguish multiple connected accounts in Nowly', 'Used only as an account label and for local account management'],
    'https://www.googleapis.com/auth/calendar': ['Synchronize Google Calendar', 'Authorized calendars, calendar lists, and events', 'Nowly reads calendars and performs user-initiated event creation, editing, moving, duration changes, and deletion', 'Used only to display and manage calendars selected by the user'],
    offline_access: ['Maintain a Microsoft connection', 'Permission to refresh authorization', 'Keeps the connection active after user consent when synchronization is needed', 'Used only by the Microsoft authorization flow; never for advertising or data sales'],
    'https://graph.microsoft.com/Calendars.ReadWrite': ['Synchronize Microsoft calendars', 'Authorized calendars and events', 'Supports reading and user-initiated creation, editing, and deletion', 'Used only to display and manage calendars selected by the user']
  };
  const fallback = ['Platform authorization permission', scope, `Provides the resource access required by the ${provider} connection`, 'Used only for features explicitly enabled by the user'];
  const [purpose, data, necessity, handling] = details[scope] ?? fallback;
  return { purpose, data, necessity, handling };
}

function scopeTableHtml(config) {
  const rows = config.oauthScopes.map((scope) => {
    const detail = scopeDetails(config.provider, scope);
    return `<tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(detail.purpose)}</td><td>${escapeHtml(detail.data)}</td><td>${escapeHtml(detail.necessity)}</td><td>${escapeHtml(detail.handling)}</td></tr>`;
  }).join('');
  return `<table class="scope-table"><thead><tr><th>Scope</th><th>用途</th><th>访问数据</th><th>必要性</th><th>处理方式</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function scopeTableMarkdown(config) {
  const rows = config.oauthScopes.map((scope) => {
    const detail = scopeDetails(config.provider, scope);
    return `| \`${scope}\` | ${detail.purpose} | ${detail.data} | ${detail.necessity} | ${detail.handling} |`;
  }).join('\n');
  return `| Scope | 用户可见用途 | 访问的数据 | 为什么需要 | 如何处理 |\n|---|---|---|---|---|\n${rows}`;
}

function scopeTableHtmlEn(config) {
  const rows = config.oauthScopes.map((scope) => {
    const detail = scopeDetailsEn(config.provider, scope);
    return `<tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(detail.purpose)}</td><td>${escapeHtml(detail.data)}</td><td>${escapeHtml(detail.necessity)}</td><td>${escapeHtml(detail.handling)}</td></tr>`;
  }).join('');
  return `<table class="scope-table"><thead><tr><th>Scope</th><th>User-visible purpose</th><th>Data accessed</th><th>Why it is needed</th><th>How it is handled</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildContext(config) {
  const features = config.features ?? {};
  const calendarBehavior = features.calendarWrite
    ? '应用支持查看日历和事件，并执行用户明确发起的创建、编辑、移动、调整时长和删除操作。'
    : '应用只在用户授权范围内读取并显示日历和事件，不执行写入操作。';
  const writeCapability = features.calendarWrite
    ? '用户可以创建、编辑、移动、调整时长和删除自己的测试事件。'
    : '当前版本只显示已授权日历和事件。';
  const tokenStorageDescription = features.localTokenStorage && features.windowsDpapi
    ? 'OAuth 令牌保存在用户本机，并使用 Windows 数据保护 API（DPAPI）加密保护。'
    : 'OAuth 令牌的保存方式以当前发布版本和隐私政策为准。';
  const calendarStorageDescription = features.serverCalendarStorage
    ? '日历数据可能在提供同步服务所需的服务器组件中暂存，具体范围以本配置和隐私政策为准。'
    : '当前配置不声明服务器端保存日历数据；页面只描述产品实际验证过的本地处理范围。';
  const thirdPartyDataStatement = '我们不会出售用户的日历数据，也不会将其用于定向广告。除非隐私政策另有明确说明，日历数据不会提供给不参与该功能的第三方。';
  const analyticsStatement = features.analytics || features.crashReporting
    ? '诊断或分析功能的具体数据类型、目的和保留方式必须以发布版本和隐私政策中的配置说明为准。'
    : '当前配置不启用产品分析或崩溃报告；如果发布版本改变这一点，必须先更新隐私政策和审核材料。';
  const calendarBehaviorEn = features.calendarWrite
    ? 'The application displays calendars and events and performs only event creation, editing, moving, duration changes, or deletion explicitly initiated by the user.'
    : 'The application reads and displays calendars and events within the authorized scope and does not modify them.';
  const writeCapabilityEn = features.calendarWrite
    ? 'Users can create, edit, move, resize, and delete their own calendar events.'
    : 'The current version only displays authorized calendars and events.';
  const tokenStorageDescriptionEn = features.localTokenStorage && features.windowsDpapi
    ? 'OAuth tokens are stored on the user’s device and encrypted with Windows Data Protection API (DPAPI).'
    : 'OAuth token storage is described by the current release and this privacy policy.';
  const calendarStorageDescriptionEn = features.serverCalendarStorage
    ? 'Calendar data may be temporarily stored by server components only as needed to provide synchronization, as described in this policy.'
    : 'Nowly does not store Google Calendar data on a developer-operated server. Calendar data is processed and stored locally on the user’s device.';
  const thirdPartyDataStatementEn = 'We do not sell Google user data, use it for advertising, or transfer it to third parties except as necessary to provide the user-requested feature, comply with law, or protect users and the service.';
  const analyticsStatementEn = features.analytics || features.crashReporting
    ? 'Any diagnostic or analytics data, its purpose, and retention period must be described by the current release and this privacy policy.'
    : 'The current configuration does not enable product analytics or crash reporting. This policy must be updated before that changes.';
  return {
    productName: escapeHtml(config.productName),
    productDescription: escapeHtml(config.productDescription),
    productDescriptionEn: escapeHtml(config.productDescriptionEn),
    companyName: escapeHtml(config.companyName),
    companyNameEn: escapeHtml(config.companyNameEn),
    companyAddress: escapeHtml(config.companyAddress),
    companyAddressEn: escapeHtml(config.companyAddressEn),
    officialDomain: escapeHtml(config.officialDomain),
    authorizedDomain: escapeHtml(config.authorizedDomain),
    supportEmail: escapeHtml(config.supportEmail),
    developerEmail: escapeHtml(config.developerEmail),
    privacyEmail: escapeHtml(config.privacyEmail),
    dataDeletionEmail: escapeHtml(config.dataDeletionEmail),
    effectiveDate: escapeHtml(config.effectiveDate),
    lastUpdated: escapeHtml(config.lastUpdated),
    providerLabel: escapeHtml(config.providerLabel),
    calendarBehavior: escapeHtml(calendarBehavior),
    writeCapability: escapeHtml(writeCapability),
    tokenStorageDescription: escapeHtml(tokenStorageDescription),
    calendarStorageDescription: escapeHtml(calendarStorageDescription),
    thirdPartyDataStatement: escapeHtml(thirdPartyDataStatement),
    analyticsStatement: escapeHtml(analyticsStatement),
    calendarBehaviorEn: escapeHtml(calendarBehaviorEn),
    writeCapabilityEn: escapeHtml(writeCapabilityEn),
    tokenStorageDescriptionEn: escapeHtml(tokenStorageDescriptionEn),
    calendarStorageDescriptionEn: escapeHtml(calendarStorageDescriptionEn),
    thirdPartyDataStatementEn: escapeHtml(thirdPartyDataStatementEn),
    analyticsStatementEn: escapeHtml(analyticsStatementEn),
    testAccount: escapeHtml(config.review?.testAccount ?? ''),
    appVersion: escapeHtml(readBaselineVersion()),
    videoUrl: escapeHtml(config.review?.videoUrl ?? ''),
    scopeTable: scopeTableHtml(config),
    scopeTableEn: scopeTableHtmlEn(config),
    scopeTableMarkdown: scopeTableMarkdown(config)
  };
}

function renderTemplate(source, context) {
  return source.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (token, key) => {
    if (!(key in context)) throw new Error(`模板使用了未定义变量：${token}`);
    return context[key];
  });
}

export async function renderMaterials(config, outputRoot) {
  const context = buildContext(config);
  const siteRoot = path.join(outputRoot, 'site');
  const reviewRoot = path.join(outputRoot, 'review');
  await fs.mkdir(siteRoot, { recursive: true });
  await fs.mkdir(reviewRoot, { recursive: true });
  for (const file of REQUIRED_SITE_FILES) {
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, 'site', file), 'utf8');
    const destination = path.join(siteRoot, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, renderTemplate(source, context), 'utf8');
  }
  for (const file of REQUIRED_REVIEW_FILES) {
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, 'review', file), 'utf8');
    await fs.writeFile(path.join(reviewRoot, file), renderTemplate(source, context), 'utf8');
  }
}

export async function generateSite({ provider, product, preview = false, output } = {}) {
  if (!provider || !product) throw new Error('用法：node generate-site.mjs <provider> <product> [--preview] [--output <dir>]');
  const { config, configPath } = await loadConfig(provider, product);
  const errors = validateConfig(config, { preview });
  if (errors.length) throw new Error(`配置校验失败（${configPath}）：\n- ${errors.join('\n- ')}`);
  const outputRoot = path.resolve(output ?? path.join(ROOT, provider, product));
  const rootBoundary = path.resolve(ROOT, provider, product);
  if (!output && !outputRoot.startsWith(rootBoundary)) throw new Error('输出目录必须位于所选产品目录内');
  await renderMaterials(config, outputRoot);
  return { outputRoot, config, configPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  generateSite(args)
    .then(({ outputRoot, configPath }) => {
      console.log(`材料已生成：${outputRoot}`);
      console.log(`下一步校验：node app-compliance/scripts/validate-materials.mjs "${path.relative(process.cwd(), outputRoot)}" --config "${configPath}"${args.preview ? ' --preview' : ''}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
