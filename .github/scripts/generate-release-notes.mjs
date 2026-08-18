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
  { key: 'feature', title: '✨ New Features', match: /^(feat|feature)(\(.*\))?:/i },
  { key: 'fix', title: '🐛 Bug Fixes', match: /^fix(\(.*\))?:/i },
  { key: 'refactor', title: '♻️ Improvements', match: /^(refactor|perf|style)(\(.*\))?:/i },
  { key: 'docs', title: '📝 Documentation', match: /^docs(\(.*\))?:/i },
  { key: 'test', title: '✅ Tests', match: /^test(\(.*\))?:/i },
  { key: 'chore', title: '🔧 Chores', match: /^(chore|build|ci)(\(.*\))?:/i },
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
    lines.push('### 📦 Other Changes', '');
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
    'You are a senior release manager writing user-facing release notes for the desktop app "Nowly".',
    'Read the provided Git commits, analyse what this release actually changes, and produce a structured changelog in clear, professional English.',
    '',
    'Strictly follow this Markdown output format (omit any section that has no content; do not keep empty headings):',
    '',
    `## Nowly v${VERSION}`,
    '',
    '> A one-line summary of the key highlight of this release.',
    '',
    '### ✨ New Features',
    '- Describe new capabilities in clear, user-facing language (do not copy commit messages verbatim)',
    '',
    '### 🐛 Bug Fixes',
    '- Describe the fixed issues and their impact on users',
    '',
    '### ♻️ Improvements',
    '- Describe performance, UX, or internal improvements',
    '',
    '### 📝 Other',
    '- Documentation, tests, build, and other noteworthy changes',
    '',
    'Requirements:',
    '1. Write for end users: concise, professional, and easy to understand; avoid technical jargon.',
    '2. Group and merge related commits; do not list them one by one and do not expose commit hashes.',
    '3. Output Markdown only, with no extra explanation.',
  ].join('\n');

  const userPrompt = `Release version: v${VERSION}\nCompare range: ${PREV_TAG || 'first release'}\n\nCommits:\n${commitList}`;

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
      console.log('Model rejects a custom temperature; retrying without it.');
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
    writeNotes(`## Nowly v${VERSION}\n\nNo code changes in this release.`);
    return;
  }

  if (LLM_API_KEY) {
    try {
      const notes = await llmNotes(commits);
      writeNotes(notes);
      return;
    } catch (err) {
      console.error(`LLM generation failed, falling back to the default changelog: ${err.message}`);
    }
  } else {
    console.log('LLM_API_KEY is not configured; using the default changelog.');
  }

  writeNotes(fallbackNotes(commits));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
