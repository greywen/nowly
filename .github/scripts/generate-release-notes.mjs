// Generates release notes for a new release.
//
// It collects the commits since the previous tag, asks a large language
// model to analyse and summarise them into a fixed, readable format, and
// writes the result to $GITHUB_OUTPUT under the "notes" key (and to a file
// path given by the RELEASE_NOTES_FILE env var, if set).
//
// If no LLM API key is configured, it falls back to a deterministic
// changelog grouped by conventional-commit type so releases still ship
// with useful notes.
//
// Env:
//   VERSION            required, e.g. 0.1.0
//   PREV_TAG           optional, previous release tag. Empty for first release.
//   LLM_API_KEY        optional, OpenAI-compatible API key.
//   LLM_BASE_URL       optional, defaults to https://api.openai.com/v1
//   LLM_MODEL          optional, defaults to gpt-4o-mini
//   RELEASE_NOTES_FILE optional, extra file to write the notes to.

import { execSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const VERSION = process.env.VERSION || '0.0.0';
const PREV_TAG = (process.env.PREV_TAG || '').trim();
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

function collectCommits() {
  const range = PREV_TAG ? `${PREV_TAG}..HEAD` : 'HEAD';
  // Separate subject and body with a rare delimiter for reliable parsing.
  const raw = execSync(
    `git log ${range} --no-merges --pretty=format:"%h%x1f%s%x1f%b%x1e"`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, subject, body] = chunk.split('\x1f');
      return { hash: (hash || '').trim(), subject: (subject || '').trim(), body: (body || '').trim() };
    })
    .filter((c) => c.subject);
}

const TYPE_SECTIONS = [
  { key: 'feature', title: '✨ 新功能', match: /^(feat|feature)(\(.*\))?:/i },
  { key: 'fix', title: '🐛 问题修复', match: /^fix(\(.*\))?:/i },
  { key: 'refactor', title: '♻️ 重构优化', match: /^(refactor|perf|style)(\(.*\))?:/i },
  { key: 'docs', title: '📝 文档', match: /^docs(\(.*\))?:/i },
  { key: 'test', title: '✅ 测试', match: /^test(\(.*\))?:/i },
  { key: 'chore', title: '🔧 其他', match: /^(chore|build|ci)(\(.*\))?:/i },
];

function stripType(subject) {
  return subject.replace(/^[a-z]+(\(.*\))?:\s*/i, '').trim();
}

function fallbackNotes(commits) {
  const buckets = new Map();
  const other = [];
  for (const c of commits) {
    const section = TYPE_SECTIONS.find((s) => s.match.test(c.subject));
    if (section) {
      if (!buckets.has(section.key)) buckets.set(section.key, []);
      buckets.get(section.key).push(c);
    } else {
      other.push(c);
    }
  }

  const lines = [`## Nowly v${VERSION}`, ''];
  for (const section of TYPE_SECTIONS) {
    const items = buckets.get(section.key);
    if (items && items.length) {
      lines.push(`### ${section.title}`, '');
      for (const c of items) {
        lines.push(`- ${stripType(c.subject)} (${c.hash})`);
      }
      lines.push('');
    }
  }
  if (other.length) {
    lines.push('### 📦 其他变更', '');
    for (const c of other) {
      lines.push(`- ${c.subject} (${c.hash})`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function llmNotes(commits) {
  const commitList = commits
    .map((c) => `- ${c.subject}${c.body ? `\n  ${c.body.replace(/\n/g, '\n  ')}` : ''} (${c.hash})`)
    .join('\n');

  const systemPrompt = [
    '你是一名资深的发布经理，负责为桌面应用 "Nowly" 编写面向用户的发布说明（Release Notes）。',
    '请阅读提供的 Git 提交记录，分析本次发布真正带来的变化，并用简体中文整理成结构化的发布日志。',
    '',
    '严格遵循以下 Markdown 输出格式（没有内容的分区请直接省略，不要保留空标题）：',
    '',
    `## Nowly v${VERSION}`,
    '',
    '> 一句话概述本次发布的核心亮点。',
    '',
    '### ✨ 新功能',
    '- 用清晰、面向用户的语言描述新增能力（不要照抄提交信息）',
    '',
    '### 🐛 问题修复',
    '- 描述修复的问题及其对用户的影响',
    '',
    '### ♻️ 优化改进',
    '- 描述性能、体验或内部结构的改进',
    '',
    '### 📝 其他',
    '- 文档、测试、构建等其他值得一提的变更',
    '',
    '要求：',
    '1. 面向最终用户，语言简洁、专业、易懂，避免技术黑话。',
    '2. 归纳合并相关提交，不要逐条罗列，不要暴露 commit hash。',
    '3. 只输出 Markdown，不要额外解释。',
  ].join('\n');

  const userPrompt = `本次发布版本：v${VERSION}\n对比范围：${PREV_TAG || '首次发布'}\n\n提交记录：\n${commitList}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  async function call(includeTemperature) {
    const body = { model: LLM_MODEL, messages };
    // Some newer models (e.g. GPT-5 family) only accept the default
    // temperature and reject a custom value with a 400. We try with it
    // first, then retry without it if that's the complaint.
    if (includeTemperature) body.temperature = 0.3;

    return fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send both header styles so the same script works against OpenAI
        // (Authorization: Bearer) and Azure AI (api-key).
        Authorization: `Bearer ${LLM_API_KEY}`,
        'api-key': LLM_API_KEY,
      },
      body: JSON.stringify(body),
    });
  }

  let res = await call(true);
  if (res.status === 400) {
    const errText = await res.text();
    if (/temperature/i.test(errText)) {
      console.log('模型不支持自定义 temperature，去掉该参数后重试。');
      res = await call(false);
    } else {
      throw new Error(`LLM request failed: 400 ${errText}`);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('LLM returned empty content');
  return content;
}

function writeNotes(notes) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const delimiter = `NOTES_EOF_${Date.now()}`;
    appendFileSync(outFile, `notes<<${delimiter}\n${notes}\n${delimiter}\n`);
  }
  if (process.env.RELEASE_NOTES_FILE) {
    writeFileSync(process.env.RELEASE_NOTES_FILE, notes + '\n');
  }
  console.log('----- Release Notes -----');
  console.log(notes);
}

async function main() {
  const commits = collectCommits();
  if (!commits.length) {
    writeNotes(`## Nowly v${VERSION}\n\n本次发布无代码变更记录。`);
    return;
  }

  if (LLM_API_KEY) {
    try {
      const notes = await llmNotes(commits);
      writeNotes(notes);
      return;
    } catch (err) {
      console.error(`LLM 生成失败，回退到默认变更日志: ${err.message}`);
    }
  } else {
    console.log('未配置 LLM_API_KEY，使用默认变更日志。');
  }

  writeNotes(fallbackNotes(commits));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
