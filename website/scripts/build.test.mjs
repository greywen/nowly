import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = pathToFileURL(path.resolve('website/scripts/build.mjs')).href;
async function builder() {
  assert.ok(await fs.stat(new URL(modulePath)).catch(() => false), 'website builder must exist');
  return import(modulePath);
}
async function temporary(callback) {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'nowly-site-test-'));
  try { await callback(output); } finally { await fs.rm(output, { recursive: true, force: true }); }
}

test('builds Chinese, English and legacy Chinese pages with real internal links', async () => {
  const { buildSite, validateOutput } = await builder();
  await temporary(async output => {
    await buildSite({ output });
    for (const prefix of ['', 'en/', 'zh-CN/']) {
      for (const name of ['index', 'download', 'guide', 'support', 'privacy', 'terms', 'data-deletion', 'calendar', 'tasks', 'notes', 'time', 'desktop', 'capture', 'connections']) {
        const html = await fs.readFile(path.join(output, prefix, `${name}.html`), 'utf8');
        assert.match(html, new RegExp(`<html lang="${prefix === 'en/' ? 'en' : 'zh-CN'}">`));
        assert.match(html, /rel="canonical"/);
        assert.match(html, /hreflang="en"/);
        assert.match(html, /hreflang="zh-CN"/);
        assert.doesNotMatch(html, /\{\{[\w]+\}\}/);
      }
    }
    assert.deepEqual(await validateOutput(output), []);
    const home = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(home, /你的 Windows 个人工作桌面/);
    assert.match(home, /github\.com\/greywen\/nowly\/releases/);
    assert.match(home, /<script type="module" src="assets\/showcase.js"><\/script>/);
    assert.match(home, /aria-label="模块截图展示"/);
    assert.match(home, /screenshots\/zh\/kanban\.png/);
    for (const prefix of ['', 'en', 'zh-CN']) {
      const language = prefix === 'en' ? 'en' : 'zh';
      const localized = await fs.readFile(path.join(output, prefix, 'index.html'), 'utf8');
      assert.equal([...localized.matchAll(/data-slide /g)].length, 8);
      assert.match(localized, new RegExp(`src="(?:\\.\\./)?assets/screenshots/${language}/workspace\\.png"`));
      for (const scene of ['workspace', 'kanban', 'notes', 'time', 'focus', 'stickers', 'project', 'study']) {
        assert.match(localized, new RegExp(`data-src="(?:\\.\\./)?assets/screenshots/${language}/${scene}\\.png"`));
        assert.ok(await fs.stat(path.join(output, 'assets', 'screenshots', language, `${scene}.png`)));
      }
      assert.doesNotMatch(localized, new RegExp(`screenshots/${language === 'en' ? 'zh' : 'en'}/`));
    }
    assert.doesNotMatch(home, /<script(?! type="module" src="assets\/(?:showcase|motion).js"><\/script>)|<iframe|REPLACE_BEFORE_DEPLOY|review@example|testAccount|videoUrl/);
    for (const scene of ['workspace', 'kanban', 'notes', 'time', 'focus', 'stickers', 'project', 'study']) {
      const chineseImage = await fs.readFile(path.join(output, 'assets', 'screenshots', 'zh', `${scene}.png`));
      const englishImage = await fs.readFile(path.join(output, 'assets', 'screenshots', 'en', `${scene}.png`));
      assert.equal(chineseImage.readUInt32BE(16), 1280);
      assert.equal(chineseImage.readUInt32BE(20), 800);
      assert.equal(englishImage.readUInt32BE(16), 1280);
      assert.equal(englishImage.readUInt32BE(20), 800);
      assert.ok(!chineseImage.equals(englishImage), `${scene} must have separately captured language variants`);
    }
    const privacy = await fs.readFile(path.join(output, 'privacy.html'), 'utf8');
    assert.match(privacy, /Limited Use/);
    assert.match(privacy, /人工智能|AI/);
    assert.match(privacy, /更新检查/);
    assert.ok(await fs.stat(path.join(output, 'assets', 'logo.png')));
  });
});

test('escapes public configuration and rejects review or credential fields', async () => {
  const { buildSite, readPublicConfig } = await builder();
  const config = await readPublicConfig();
  await temporary(async output => {
    await buildSite({ output, config: { ...config, productName: 'Nowly <Test> & Co' } });
    const home = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(home, /Nowly &lt;Test&gt; &amp; Co/);
    assert.doesNotMatch(home, /Nowly <Test>/);
    await buildSite({ output, config: { ...config, officialDomain: 'https://example.com/" onfocus="alert(1)' } });
    const escaped = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.doesNotMatch(escaped, / onfocus="alert/);
    for (const extra of [{ review: { testAccount: 'private@example.com' } }, { apiKey: 'private' }, { unknown: true }]) {
      await assert.rejects(buildSite({ output, config: { ...config, ...extra } }), /public configuration/);
    }
    await assert.rejects(buildSite({ output, config: { ...config, officialDomain: 'http://example.com' } }), /HTTPS/);
    await assert.rejects(buildSite({ output, config: { ...config, supportEmail: 'REPLACE_BEFORE_DEPLOY_EMAIL' } }), /public configuration/);
  });
});

test('validator catches a broken link and missing image', async () => {
  const { buildSite, validateOutput } = await builder();
  await temporary(async output => {
    await buildSite({ output });
    await fs.appendFile(path.join(output, 'index.html'), '<a href="missing.html">Missing</a><img src="missing.png" alt="Missing"><button data-src="missing-slide.png">Slide</button>');
    const errors = await validateOutput(output);
    assert.ok(errors.some(error => error.includes('missing.html')));
    assert.ok(errors.some(error => error.includes('missing.png')));
    assert.ok(errors.some(error => error.includes('missing-slide.png')));
  });
});
