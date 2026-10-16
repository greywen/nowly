import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REQUIRED_REVIEW_FILES, REQUIRED_SITE_FILES, renderMaterials, validateConfig } from './generate-site.mjs';
import { validateMaterials } from './validate-materials.mjs';

const baseConfig = {
  productName: 'Nowly <Test>',
  productDescription: '测试产品 & 说明',
  productDescriptionEn: 'Test product & description',
  companyName: 'Example Company',
  companyNameEn: 'Example Company',
  companyAddress: 'Example address',
  companyAddressEn: 'Example address',
  officialDomain: 'https://example.com',
  authorizedDomain: 'example.com',
  supportEmail: 'support@example.com',
  developerEmail: 'developer@example.com',
  privacyEmail: 'privacy@example.com',
  dataDeletionEmail: 'delete@example.com',
  effectiveDate: '2026-09-03',
  lastUpdated: '2026-09-03',
  provider: 'google',
  providerLabel: 'Google Calendar',
  locale: 'zh-CN',
  oauthScopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
  features: {
    calendarRead: true,
    calendarWrite: true,
    localTokenStorage: true,
    windowsDpapi: true,
    serverCalendarStorage: false,
    analytics: false,
    crashReporting: false
  },
  review: {
    testAccount: 'review@example.com',
    videoUrl: 'https://video.example.com/nowly-review'
  }
};

async function withTempDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nowly-materials-'));
  try {
    return await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('public privacy materials cover optional AI and update networking', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const chinese = await fs.readFile(path.join(directory, 'site', 'zh-CN', 'privacy.html'), 'utf8');
    const english = await fs.readFile(path.join(directory, 'site', 'privacy.html'), 'utf8');
    assert.match(chinese, /AI 助手/);
    assert.match(chinese, /更新检查/);
    assert.match(english, /AI assistant/);
    assert.match(english, /update checks/);
    const review = await fs.readFile(path.join(directory, 'review', 'verification-answers.md'), 'utf8');
    assert.match(review, /AI/);
    assert.match(review, /Limited Use/);
  });
});

test('validates custom output with an explicitly supplied original configuration', async () => {
  await withTempDirectory(async directory => {
    await renderMaterials(baseConfig, directory);
    assert.deepEqual(await validateMaterials(directory, { config: baseConfig }), []);
    assert.equal(await fs.stat(path.join(directory, 'config.json')).catch(() => null), null);
  });
});

test('rejects a config containing deployment markers', () => {
  const errors = validateConfig({ ...baseConfig, companyName: 'REPLACE_BEFORE_DEPLOY_COMPANY_NAME' });
  assert.ok(errors.some((error) => error.includes('存在未替换字段')));
});

test('rejects a non-https official domain', () => {
  const errors = validateConfig({ ...baseConfig, officialDomain: 'http://example.com' });
  assert.ok(errors.includes('officialDomain 必须使用 HTTPS'));
});

test('escapes HTML special characters in public config values', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const english = await fs.readFile(path.join(directory, 'site', 'index.html'), 'utf8');
    const chinese = await fs.readFile(path.join(directory, 'site', 'zh-CN', 'index.html'), 'utf8');
    assert.match(english, /Nowly &lt;Test&gt;/);
    assert.match(english, /Test product &amp; description/);
    assert.match(chinese, /测试产品 &amp; 说明/);
    assert.doesNotMatch(english, /Nowly <Test>/);
  });
});

test('renders every required page and review file', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    for (const file of REQUIRED_SITE_FILES) assert.ok(await fs.stat(path.join(directory, 'site', file)));
    for (const file of REQUIRED_REVIEW_FILES) assert.ok(await fs.stat(path.join(directory, 'review', file)));
  });
});

test('renders English pages at the root and Chinese pages below zh-CN', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const english = await fs.readFile(path.join(directory, 'site', 'privacy.html'), 'utf8');
    const chinese = await fs.readFile(path.join(directory, 'site', 'zh-CN', 'privacy.html'), 'utf8');
    assert.match(english, /<html lang="en">/);
    assert.match(english, /Privacy Policy/);
    assert.match(english, /href="zh-CN\/privacy\.html"/);
    assert.match(chinese, /<html lang="zh-CN">/);
    assert.match(chinese, /隐私政策/);
    assert.match(chinese, /href="\.\.\/privacy\.html"/);
  });
});

test('privacy policy explicitly describes sensitive Google user data protections', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const english = await fs.readFile(path.join(directory, 'site', 'privacy.html'), 'utf8');
    const chinese = await fs.readFile(path.join(directory, 'site', 'zh-CN', 'privacy.html'), 'utf8');

    for (const required of [
      /Protection of sensitive Google user data/,
      /Authorization Code flow with PKCE/,
      /HTTPS \(TLS\)/,
      /Windows Data Protection API \(DPAPI\)/,
      /not intentionally logged/,
      /developer-operated server/
    ]) {
      assert.match(english, required);
    }

    for (const required of [
      /Google 用户敏感数据保护机制/,
      /Authorization Code \+ PKCE/,
      /HTTPS（TLS）/,
      /Windows 数据保护 API（DPAPI）/,
      /不会被有意写入日志/,
      /开发者运营的服务器/
    ]) {
      assert.match(chinese, required);
    }
  });
});

test('demo video script requires a continuous OAuth permission request flow', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const script = await fs.readFile(path.join(directory, 'review', 'demo-video-script.md'), 'utf8');

    assert.match(script, /撤销测试账号此前授予 Nowly 的访问权限/);
    assert.match(script, /不要剪切或跳过/);
    assert.match(script, /Google 授权同意页面/);
    assert.match(script, /展开权限详情/);
    assert.match(script, /https:\/\/www\.googleapis\.com\/auth\/calendar/);
    assert.match(script, /点击“允许”/);
  });
});

test('renders the configured scope list in the review material', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    const material = await fs.readFile(path.join(directory, 'review', 'scope-justification.md'), 'utf8');
    for (const scope of baseConfig.oauthScopes) assert.match(material, new RegExp(`\\\`${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\``));
  });
});

test('rejects generated output containing secret-like filenames or values', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(baseConfig), 'utf8');
    await fs.writeFile(path.join(directory, 'site', 'client_secret.txt'), 'do-not-publish', 'utf8');
    const errors = await validateMaterials(directory, { preview: true });
    assert.ok(errors.some((error) => error.includes('缺少文件') || error.includes('敏感凭证')));
  });
});

test('rejects broken local page links', async () => {
  await withTempDirectory(async (directory) => {
    await renderMaterials(baseConfig, directory);
    await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(baseConfig), 'utf8');
    const indexPath = path.join(directory, 'site', 'index.html');
    const index = await fs.readFile(indexPath, 'utf8');
    await fs.writeFile(indexPath, `${index}<a href="missing.html">broken</a>`, 'utf8');
    const errors = await validateMaterials(directory, { preview: true });
    assert.ok(errors.some((error) => error.includes('链接无效：missing.html')));
  });
});
