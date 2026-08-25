// Registry validator. Runs in CI on every PR and locally via `node registry/validate.mjs`.
//
// It enforces the contract that lets the app trust a registry entry without a
// central server: each entry is well-formed, its id is unique, its declared
// metadata matches the module's own manifest header, the published sha256
// matches the hosted/committed file, and the source has no obviously dangerous
// patterns. Human review handles trust; this catches mechanical mistakes.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lintModuleSource } from './lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, 'registry.json');

const KNOWN_PERMISSIONS = ['state', 'today', 'network'];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const errors = [];
const fail = (id, message) => errors.push(`[${id}] ${message}`);

// --- Minimal manifest parser (mirrors src/widgets/module-manifest.ts) --------

function parseManifest(source) {
  const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  const tags = new Map();
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/^\s*\*?\s?/, '').trimEnd();
    const m = line.match(/^@([a-zA-Z-]+)\s*(.*)$/);
    if (m) tags.set(m[1].toLowerCase(), m[2].trim());
  }
  const list = (v) =>
    (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  return {
    manifestVersion: tags.get('nowly-module'),
    id: tags.get('id') ?? '',
    name: tags.get('name') ?? '',
    version: tags.get('version') ?? '',
    permissions: list(tags.get('permissions')),
    network: list(tags.get('network')).map((h) => h.toLowerCase())
  };
}

// Cheap scan for patterns a sandboxed module should never contain. These are not
// a security guarantee (the sandbox is), but they flag low-quality or suspicious
// submissions for closer human review.
function dangerousPatterns(source) {
  const hits = [];
  const checks = [
    [/\beval\s*\(/, 'eval('],
    [/new\s+Function\s*\(/, 'new Function('],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\brequire\s*\(/, 'require('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    // Bare fetch( that is not host.fetch(
    [/(?<!host\.)\bfetch\s*\(/, 'bare fetch( (use host.fetch)']
  ];
  for (const [re, label] of checks) {
    if (re.test(source)) hits.push(label);
  }
  return hits;
}

// --- Load registry -----------------------------------------------------------

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8'));
} catch (error) {
  console.error(`registry.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(registry.modules)) {
  console.error('registry.json must have a "modules" array.');
  process.exit(1);
}

const seenIds = new Set();

for (const entry of registry.modules) {
  const id = entry.id ?? '(missing id)';

  if (!ID_PATTERN.test(entry.id ?? '')) fail(id, 'invalid id (use [a-z0-9-])');
  if (seenIds.has(entry.id)) fail(id, 'duplicate id');
  seenIds.add(entry.id);

  if (!entry.name) fail(id, 'missing name');
  if (!SEMVER.test(entry.version ?? '')) fail(id, `invalid version "${entry.version}"`);
  if (typeof entry.sourceUrl !== 'string' || !entry.sourceUrl.startsWith('https://')) {
    fail(id, 'sourceUrl must be an https URL');
  }

  for (const permission of entry.permissions ?? []) {
    if (!KNOWN_PERMISSIONS.includes(permission)) fail(id, `unknown permission "${permission}"`);
  }
  const declaresNetwork = (entry.permissions ?? []).includes('network');
  const hosts = entry.network ?? [];
  if (declaresNetwork && hosts.length === 0) fail(id, 'network permission needs at least one host');
  if (!declaresNetwork && hosts.length > 0) fail(id, 'network hosts listed without network permission');

  // If the module file is committed in this repo (recommended), resolve it and
  // check the manifest + sha256 against the entry. Convention: sourceUrl points
  // at registry/modules/<id>.js in this repo.
  const localPath = join(here, 'modules', `${entry.id}.js`);
  if (!existsSync(localPath)) {
    // Self-hosted modules are allowed; we cannot verify them offline in CI, so
    // just note it. A reviewer must fetch and inspect manually.
    console.warn(`[${id}] no local file at registry/modules/${entry.id}.js — self-hosted, manual review required`);
    continue;
  }

  const source = readFileSync(localPath, 'utf8');

  // sha256 must match when the entry publishes one.
  const actual = createHash('sha256').update(source).digest('hex');
  if (entry.sha256 && entry.sha256.toLowerCase() !== actual) {
    fail(id, `sha256 mismatch: entry has ${entry.sha256}, file is ${actual}`);
  }
  if (!entry.sha256) fail(id, `missing sha256 (should be ${actual})`);

  // Manifest header must exist and agree with the registry entry.
  const manifest = parseManifest(source);
  if (!manifest) {
    fail(id, 'module file has no manifest header');
  } else {
    if (manifest.manifestVersion !== '1') fail(id, '@nowly-module must be 1');
    if (manifest.id !== entry.id) fail(id, `manifest @id "${manifest.id}" != entry id "${entry.id}"`);
    if (manifest.version !== entry.version) {
      fail(id, `manifest @version "${manifest.version}" != entry version "${entry.version}"`);
    }
    const entryPerms = [...(entry.permissions ?? [])].sort().join(',');
    const manifestPerms = [...manifest.permissions].sort().join(',');
    if (entryPerms !== manifestPerms) {
      fail(id, `permissions mismatch: entry [${entryPerms}] vs manifest [${manifestPerms}]`);
    }
    const entryHosts = [...hosts].map((h) => h.toLowerCase()).sort().join(',');
    const manifestHosts = [...manifest.network].sort().join(',');
    if (entryHosts !== manifestHosts) {
      fail(id, `network hosts mismatch: entry [${entryHosts}] vs manifest [${manifestHosts}]`);
    }
  }

  // Dangerous-pattern scan.
  const hits = dangerousPatterns(source);
  if (hits.length > 0) fail(id, `suspicious patterns: ${hits.join(', ')}`);

  // Checklist lint (color literals, unbounded loops, remote resources).
  for (const issue of lintModuleSource(source)) {
    fail(id, `lint ${issue.rule} at line ${issue.line}: ${issue.message}`);
  }
}

if (errors.length > 0) {
  console.error(`\nRegistry validation failed with ${errors.length} problem(s):\n`);
  for (const line of errors) console.error('  ' + line);
  process.exit(1);
}

console.log(`Registry OK: ${registry.modules.length} module(s) validated.`);
