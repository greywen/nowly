import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_REVIEW_FILES, REQUIRED_SITE_FILES, loadConfig, validateConfig } from './generate-site.mjs';

const SECRET_PATTERNS = [
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /private[_-]?key/i,
  /oauth-credentials\.json/i,
  /\.sqlite\b/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/
];
const REMOTE_RESOURCE = /<(?:script|iframe|img)\b[^>]+(?:src|href)\s*=\s*["']https?:/i;
const REMOTE_STYLESHEET = /<link\b[^>]+href\s*=\s*["']https?:/i;

export async function validateMaterials(productRoot, { preview = false, config: suppliedConfig } = {}) {
  const root = path.resolve(productRoot);
  const configPath = path.join(root, 'config.json');
  const config = suppliedConfig ?? (await readJson(configPath)).config;
  const errors = validateConfig(config, { preview });
  const siteRoot = path.join(root, 'site');
  const reviewRoot = path.join(root, 'review');
  for (const file of REQUIRED_SITE_FILES) await requireFile(path.join(siteRoot, file), errors);
  for (const file of REQUIRED_REVIEW_FILES) await requireFile(path.join(reviewRoot, file), errors);

  const htmlFiles = REQUIRED_SITE_FILES.filter((file) => file.endsWith('.html'));
  for (const file of htmlFiles) {
    const filePath = path.join(siteRoot, file);
    if (!(await exists(filePath))) continue;
    const content = await fs.readFile(filePath, 'utf8');
    if (!/^<!doctype html>/i.test(content)) errors.push(`${file} 缺少 doctype`);
    const expectedLanguage = file.startsWith('zh-CN/') ? 'zh-CN' : 'en';
    if (!content.includes(`<html lang="${expectedLanguage}">`)) errors.push(`${file} 缺少 lang="${expectedLanguage}"`);
    if (!/<title>[^<]+<\/title>/i.test(content)) errors.push(`${file} 缺少 title`);
    if (!/href="privacy\.html"/.test(content)) errors.push(`${file} 缺少隐私政策链接`);
    if (!/href="support\.html"/.test(content)) errors.push(`${file} 缺少支持页面链接`);
    if (REMOTE_RESOURCE.test(content) || REMOTE_STYLESHEET.test(content)) errors.push(`${file} 包含远程资源`);
    checkRelativeLinks(content, file, siteRoot, errors);
  }

  const files = [...htmlFiles.map((file) => path.join(siteRoot, file)), path.join(siteRoot, 'site.css'), ...REQUIRED_REVIEW_FILES.map((file) => path.join(reviewRoot, file))];
  for (const filePath of files) {
    if (!(await exists(filePath))) continue;
    const content = await fs.readFile(filePath, 'utf8');
    const relative = path.relative(root, filePath);
    if (!preview && /REPLACE_BEFORE_DEPLOY/.test(content)) errors.push(`${relative} 仍包含部署占位符`);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) errors.push(`${relative} 包含敏感凭证或本地数据标识`);
    const motionDeclarations = [...content.matchAll(/\b((?:animation|transition)(?:-[a-z-]+)?)\s*:\s*([^;}]*)/gi)];
    if (motionDeclarations.some(([, property, value]) => {
      const normalized = value.trim().toLowerCase();
      if (property === 'animation-duration') return !/^0s(?:\s*!important)?$/.test(normalized);
      return !/^none(?:\s*!important)?$/.test(normalized);
    })) errors.push(`${relative} 包含禁止的动效声明`);
    if (/<(?:script|iframe)\b/i.test(content)) errors.push(`${relative} 不应包含脚本或 iframe`);
  }

  const scopeMaterial = await readIfExists(path.join(reviewRoot, 'scope-justification.md'));
  const verificationMaterial = await readIfExists(path.join(reviewRoot, 'verification-answers.md'));
  for (const scope of config.oauthScopes ?? []) {
    const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!(new RegExp(`\\\`${escaped}\\\``).test(scopeMaterial))) errors.push(`审核材料缺少 scope：${scope}`);
    if (!new RegExp(escaped).test(verificationMaterial)) errors.push(`审核答案缺少 scope：${scope}`);
  }
  for (const filePath of await walkFiles(root)) {
    const relative = path.relative(root, filePath);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (SECRET_PATTERNS.some((pattern) => pattern.test(relative) || pattern.test(content))) {
      errors.push(`${relative} 包含敏感凭证或本地数据标识`);
    }
  }
  return errors;
}

async function readJson(filePath) {
  try {
    return { config: JSON.parse(await fs.readFile(filePath, 'utf8')) };
  } catch (error) {
    throw new Error(`无法读取配置 ${filePath}：${error.message}`);
  }
}

async function requireFile(filePath, errors) {
  if (!(await exists(filePath))) errors.push(`缺少文件：${path.relative(process.cwd(), filePath)}`);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(filePath) {
  return (await exists(filePath)) ? fs.readFile(filePath, 'utf8') : '';
}

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(filePath));
    else files.push(filePath);
  }
  return files;
}

function checkRelativeLinks(content, currentFile, siteRoot, errors) {
  const links = [...content.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  for (const link of links) {
    if (link.startsWith('#') || link.startsWith('mailto:') || link.startsWith('http:') || link.startsWith('https:')) continue;
    const target = path.resolve(path.dirname(path.join(siteRoot, currentFile)), link);
    if (!target.startsWith(path.resolve(siteRoot)) || (!target.endsWith('.html') && !target.endsWith('.css')) || !fsSync.existsSync(target)) {
      errors.push(`${currentFile} 链接无效：${link}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const configFile = configIndex === -1 ? undefined : args[configIndex + 1];
  const productRoot = args.find((arg, index) => !arg.startsWith('--') && (configIndex === -1 || index !== configIndex + 1));
  const preview = args.includes('--preview');
  if (!productRoot) {
    console.error('用法：node validate-materials.mjs <provider/product> [--preview] [--config <original-config.json>]');
    process.exitCode = 1;
  } else {
    Promise.resolve(configFile ? readJson(path.resolve(configFile)).then(result => result.config) : undefined)
      .then(config => validateMaterials(productRoot, { preview, config }))
      .then((errors) => {
        if (errors.length) {
          console.error(`材料校验失败：\n- ${errors.join('\n- ')}`);
          process.exitCode = 1;
        } else {
          console.log(`材料校验通过：${path.resolve(productRoot)}`);
        }
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
