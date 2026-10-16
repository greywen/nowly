import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { SHOWCASE_SLIDES, screenshotPath } from './showcase-scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_NAMES = ['index', 'download', 'guide', 'support', 'privacy', 'terms', 'data-deletion', 'calendar', 'tasks', 'notes', 'time', 'desktop', 'capture', 'connections'];
const CONFIG_KEYS = ['productName', 'officialDomain', 'supportEmail', 'developerName', 'releasesUrl', 'issuesUrl'];
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export async function readPublicConfig() { return JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8')); }
function validateConfig(config) {
  if (Object.keys(config).some(key => !CONFIG_KEYS.includes(key)) || CONFIG_KEYS.some(key => typeof config[key] !== 'string' || !config[key].trim() || /REPLACE_BEFORE_DEPLOY|\{\{/i.test(config[key]))) throw new Error('Invalid public configuration');
  for (const key of ['officialDomain', 'releasesUrl', 'issuesUrl']) {
    const url = new URL(config[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Public URLs must use HTTPS without credentials, query or fragment');
  }
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(config.supportEmail)) throw new Error('Invalid public configuration email');
}
function pageLink(page) {
  if (!PAGE_NAMES.includes(page)) throw new Error(`Unknown page: ${page}`);
  return `${page}.html`;
}
function textParagraphs(paragraphs) { return paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join(''); }
function sectionsHtml(sections) {
  return sections.map(section => `<section class="document__section"><h2>${escapeHtml(section.title)}</h2>${textParagraphs(section.paragraphs)}${(section.links ?? []).map(link => `<a class="site__text-link" href="${pageLink(link.page)}">${escapeHtml(link.text)}</a>`).join('')}</section>`).join('');
}
function showcaseHtml(assets, locale) {
  const zh = locale === 'zh-CN';
  const caption = slide => `${zh ? slide[3] : slide[4]} ${zh ? '真实应用界面 · 合成示例数据。' : 'Actual app interface · Synthetic example data.'}`;
  return `<section class="hero__showcase" data-showcase role="region" aria-label="${zh ? '模块截图展示' : 'Module screenshots'}"><figure class="hero__figure"><img class="hero__image" src="${assets}/${screenshotPath(SHOWCASE_SLIDES[0][0], zh ? 'zh' : 'en')}" width="1280" height="800" alt="${escapeHtml(caption(SHOWCASE_SLIDES[0]))}"><figcaption>${escapeHtml(caption(SHOWCASE_SLIDES[0]))}</figcaption></figure><div class="hero__controls" data-controls hidden><div class="hero__choices" role="group" aria-label="${zh ? '选择模块截图' : 'Choose module screenshot'}">${SHOWCASE_SLIDES.map((slide, i) => `<button type="button" class="hero__choice" data-slide data-src="${assets}/${screenshotPath(slide[0], zh ? 'zh' : 'en')}" data-caption="${escapeHtml(caption(slide))}" aria-pressed="${i === 0}">${escapeHtml(zh ? slide[1] : slide[2])}</button>`).join('')}</div></div></section><script type="module" src="${assets}/showcase.js"></script>`;
}
function homeHtml(content, config, assets, locale) {
  const home = content.home;
  const icons = { calendar: 'CalendarDays', tasks: 'SquareKanban', notes: 'FileText', capture: 'Crop', desktop: 'MonitorDown', guide: 'LayoutGrid', connections: 'Plug' };
  const icon = (name, card = false) => `<svg class="site__icon${card ? ' site__icon--card' : ''}" width="${card ? 20 : 18}" height="${card ? 20 : 18}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="${assets}/icons.svg#${name}"></use></svg>`;
  return `<section class="hero"><div class="hero__copy"><p class="site__eyebrow">${escapeHtml(home.eyebrow)}</p><h1>${escapeHtml(home.heading)}</h1><p class="hero__lead">${escapeHtml(home.lead)}</p><div class="site__actions"><a class="site__button site__button--primary" href="${escapeHtml(config.releasesUrl)}">${icon('Download')}${escapeHtml(content.labels.download)}</a><a class="site__button" href="guide.html">${escapeHtml(content.labels.guide)}</a></div><p class="site__meta">${escapeHtml(content.labels.compatibility)}</p></div>${showcaseHtml(assets, locale)}</section><script type="module" src="${assets}/motion.js"></script>
    <section class="site__section"><h2>${locale === 'zh-CN' ? '把工作整理到一个桌面' : 'Bring your work together'}</h2><div class="site__cards">${home.scenes.map(scene => `<article class="site__card"><h3 class="site__card-title">${icon(icons[scene.page], true)}<span>${escapeHtml(scene.title)}</span></h3><p>${escapeHtml(scene.text)}</p><a href="${pageLink(scene.page)}">${escapeHtml(content.labels.guide)} →</a></article>`).join('')}</div></section>
    <section class="site__section"><h2>${locale === 'zh-CN' ? '属于你的工作方式' : 'A workspace that fits you'}</h2><div class="site__cards site__cards--three">${home.differences.map(item => `<article class="site__card"><h3 class="site__card-title">${icon(icons[item.page], true)}<span>${escapeHtml(item.title)}</span></h3><p>${escapeHtml(item.text)}</p><a href="${pageLink(item.page)}">${escapeHtml(content.labels.guide)} →</a></article>`).join('')}</div></section>
    <section class="site__notice"><h2>${escapeHtml(home.privacyTitle)}</h2><p>${escapeHtml(home.privacyText)}</p><a href="privacy.html">${escapeHtml(content.pages.privacy.title)} →</a></section>
    <section class="site__section"><h2>${locale === 'zh-CN' ? '常见问题' : 'Common questions'}</h2><div class="site__faq">${home.faq.map(item => `<details class="site__faq-item"><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</div></section>
    <section class="site__notice"><h2>${escapeHtml(content.tagline)}</h2><div class="site__actions"><a class="site__button site__button--primary" href="download.html">${escapeHtml(content.labels.download)}</a><a class="site__button" href="guide.html">${escapeHtml(content.labels.guide)}</a></div></section>`;
}
function documentHtml(page, content, config, locale) {
  const entry = content.pages[page];
  if (!entry || !entry.sections?.length) throw new Error(`Missing content: ${locale}/${page}`);
  let extra = '';
  if (page === 'download') extra = `<div class="site__actions"><a class="site__button site__button--primary" href="${escapeHtml(config.releasesUrl)}">${escapeHtml(content.labels.download)}</a></div>`;
  if (page === 'support') extra = `<div class="site__actions"><a class="site__button" href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a><a class="site__button" href="${escapeHtml(config.issuesUrl)}">GitHub Issues</a></div>`;
  if (page === 'privacy') extra = '<p><a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy · Limited Use</a></p>';
  return `<article class="document"><header class="document__header"><p class="site__eyebrow">${escapeHtml(content.tagline)}</p><h1>${escapeHtml(entry.title)}</h1><p class="hero__lead">${escapeHtml(entry.lead)}</p>${extra}</header>${sectionsHtml(entry.sections)}</article>`;
}
export async function buildSite({ output = path.join(ROOT, 'dist'), config } = {}) {
  config ??= await readPublicConfig();
  validateConfig(config);
  const template = await fs.readFile(path.join(ROOT, 'templates', 'page.html'), 'utf8');
  const version = JSON.parse(await fs.readFile(path.join(ROOT, '..', 'package.json'), 'utf8')).version;
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.copyFile(path.join(ROOT, '..', 'public', 'logo.png'), path.join(output, 'assets', 'logo.png'));
  for (const language of ['zh', 'en']) {
    await fs.mkdir(path.join(output, 'assets', 'screenshots', language), { recursive: true });
    for (const slide of SHOWCASE_SLIDES) {
      const relative = screenshotPath(slide[0], language);
      await fs.copyFile(path.join(ROOT, 'assets', relative), path.join(output, 'assets', relative));
    }
  }
  for (const script of ['showcase.js', 'motion.js']) await fs.copyFile(path.join(ROOT, 'assets', script), path.join(output, 'assets', script));
  const iconSource = await fs.readFile(path.join(ROOT, '..', 'src', 'components', 'icon-data.ts'), 'utf8');
  const glyphs = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(iconSource)).toString('base64'));
  const iconNames = ['CalendarDays', 'SquareKanban', 'FileText', 'Crop', 'MonitorDown', 'LayoutGrid', 'Plug', 'Download'];
  await fs.writeFile(path.join(output, 'assets', 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg">' + iconNames.map(name => '<symbol id="' + name + '" viewBox="0 0 24 24">' + glyphs.iconBodies[name].outline + '</symbol>').join('') + '</svg>');
  const design = await fs.readFile(path.join(ROOT, '..', 'design.md'), 'utf8');
  const tokens = design.match(/```css\r?\n(:root \{[\s\S]*?)\r?\n```/);
  if (!tokens) throw new Error('Missing authoritative design tokens');
  const css = await fs.readFile(path.join(ROOT, 'assets', 'site.css'), 'utf8');
  await fs.writeFile(path.join(output, 'assets', 'site.css'), `${tokens[1]}\n${css}`);
  for (const prefix of ['', 'en', 'zh-CN']) {
    const locale = prefix === 'en' ? 'en' : 'zh-CN';
    const content = JSON.parse(await fs.readFile(path.join(ROOT, 'content', locale === 'en' ? 'en.json' : 'zh.json'), 'utf8'));
    const directory = path.join(output, prefix);
    await fs.mkdir(directory, { recursive: true });
    for (const page of PAGE_NAMES) {
      const chineseUrl = `${config.officialDomain.replace(/\/$/, '')}/${page}.html`;
      const englishUrl = `${config.officialDomain.replace(/\/$/, '')}/en/${page}.html`;
      const data = {
        lang: locale, description: escapeHtml(page === 'index' ? content.description : content.pages[page].lead),
        title: escapeHtml(`${page === 'index' ? content.tagline : content.pages[page].title} · ${config.productName}`),
        canonical: escapeHtml(locale === 'en' ? englishUrl : chineseUrl), chineseUrl: escapeHtml(chineseUrl), englishUrl: escapeHtml(englishUrl),
        assets: prefix ? '../assets' : 'assets', productName: escapeHtml(config.productName), tagline: escapeHtml(content.tagline),
        skipLabel: locale === 'en' ? 'Skip to content' : '跳到正文', navLabel: locale === 'en' ? 'Main navigation' : '主导航', legalLabel: locale === 'en' ? 'Legal and support' : '法律与支持',
        navigation: Object.entries(content.nav).map(([key, label]) => `<a href="${pageLink(key)}"${page === key ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join(''),
        languageUrl: locale === 'en' ? `../${page}.html` : `${prefix ? '../' : ''}en/${page}.html`, otherLang: locale === 'en' ? 'zh-CN' : 'en', languageLabel: locale === 'en' ? '简体中文' : 'English',
        body: page === 'index' ? homeHtml(content, config, prefix ? '../assets' : 'assets', locale) : documentHtml(page, content, config, locale),
        footer: escapeHtml(content.labels.footer), versionLabel: escapeHtml(content.labels.version), version: escapeHtml(version),
        legalLinks: ['privacy', 'terms', 'data-deletion', 'support'].map(key => `<a href="${pageLink(key)}">${escapeHtml(content.pages[key].title)}</a>`).join(''),
        supportEmail: escapeHtml(config.supportEmail), developerName: escapeHtml(config.developerName)
      };
      const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in data)) throw new Error(`Unknown template variable: ${key}`);
        return data[key];
      });
      await fs.writeFile(path.join(directory, `${page}.html`), html);
    }
  }
  await fs.writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.officialDomain}/sitemap.xml\n`);
  await fs.writeFile(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['', 'en/'].flatMap(prefix => PAGE_NAMES.map(page => `<url><loc>${escapeHtml(`${config.officialDomain}/${prefix}${page}.html`)}</loc></url>`)).join('')}</urlset>`);
  const errors = await validateOutput(output);
  if (errors.length) throw new Error(errors.join('\n'));
  return output;
}
export async function validateOutput(output) {
  const errors = [];
  for (const prefix of ['', 'en', 'zh-CN']) {
    for (const page of PAGE_NAMES) {
      const relative = path.join(prefix, `${page}.html`);
      const html = await fs.readFile(path.join(output, relative), 'utf8').catch(() => '');
      if (!html) { errors.push(`Missing page: ${relative}`); continue; }
      const safeHtml = html.replace(/<script type="module" src="(?:\.\.\/)?assets\/(?:showcase|motion)\.js"><\/script>/g, '');
      if (/<(?:script|iframe)\b|\{\{\w+\}\}|REPLACE_BEFORE_DEPLOY|testAccount|videoUrl/i.test(safeHtml)) errors.push(`Invalid public output: ${relative}`);
      for (const [, attribute, value] of html.matchAll(/\b(href|src|data-src)="([^"]+)"/g)) {
        if (/^(?:https:|mailto:|#)/.test(value)) continue;
        const target = path.resolve(output, prefix, value.split('#')[0]);
        if (!target.startsWith(`${path.resolve(output)}${path.sep}`) || !await fs.stat(target).catch(() => false)) errors.push(`${relative}: missing ${attribute} ${value}`);
      }
    }
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite().then(output => console.log(`Website built: ${output}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
