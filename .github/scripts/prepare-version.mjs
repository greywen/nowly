// Determines the version to release and bumps it when needed.
//
// Rules:
// - The source of truth is the "version" field in package.json.
// - If no git tag exists for that version yet, we release it as-is
//   (this is how the very first release, 0.1.0, ships).
// - If a tag already exists for the current version, we auto-bump the
//   patch number so every merge to main produces a fresh release.
// - When we bump, we rewrite the version across all project manifests
//   so the built artifact and the tag stay in sync.
//
// Outputs (written to $GITHUB_OUTPUT):
//   version  -> the version to release, e.g. 0.1.0
//   tag      -> the tag to create, e.g. v0.1.0
//   bumped   -> "true" when manifests were rewritten, else "false"

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const PKG = 'package.json';
const LOCK = 'package-lock.json';
const CARGO = 'src-tauri/Cargo.toml';
const TAURI_CONF = 'src-tauri/tauri.conf.json';

function tagExists(tag) {
  try {
    const out = execSync(`git tag -l "${tag}"`, { encoding: 'utf8' }).trim();
    return out === tag;
  } catch {
    return false;
  }
}

function bumpPatch(version) {
  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10));
  return `${major}.${minor}.${patch + 1}`;
}

function writeManifests(newVersion) {
  // package.json
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  pkg.version = newVersion;
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');

  // package-lock.json (root + root package entry)
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');

  // Cargo.toml (only the [package] version, i.e. the first "version = ...")
  const cargo = readFileSync(CARGO, 'utf8');
  const cargoUpdated = cargo.replace(/^version\s*=\s*".*"/m, `version = "${newVersion}"`);
  writeFileSync(CARGO, cargoUpdated);

  // tauri.conf.json
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
  conf.version = newVersion;
  writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + '\n');
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

const currentVersion = JSON.parse(readFileSync(PKG, 'utf8')).version;
let releaseVersion = currentVersion;
let bumped = false;

if (tagExists(`v${currentVersion}`)) {
  releaseVersion = bumpPatch(currentVersion);
  writeManifests(releaseVersion);
  bumped = true;
  console.log(`Tag v${currentVersion} already exists -> bumped to ${releaseVersion}`);
} else {
  console.log(`Releasing current version ${currentVersion} (no existing tag)`);
}

setOutput('version', releaseVersion);
setOutput('tag', `v${releaseVersion}`);
setOutput('bumped', String(bumped));
