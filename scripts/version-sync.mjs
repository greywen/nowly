// Single place that knows where the app version physically lives.
//
// The version number is duplicated across five manifests because npm, Cargo
// and Tauri each insist on owning their own copy. Reading and writing them all
// from here is what keeps them from drifting apart.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PKG = 'package.json';
const PKG_LOCK = 'package-lock.json';
const CARGO = 'src-tauri/Cargo.toml';
const CARGO_LOCK = 'src-tauri/Cargo.lock';
const TAURI_CONF = 'src-tauri/tauri.conf.json';

export const MANIFESTS = [PKG, PKG_LOCK, CARGO, CARGO_LOCK, TAURI_CONF];

// Matches the `version` line of the `[[package]] name = "nowly"` entry only,
// so dependency versions in the same lock file are left alone.
const CARGO_LOCK_ENTRY = /(\[\[package\]\]\r?\nname = "nowly"\r?\nversion = )"([^"]*)"/;
// The first `version = "..."` in Cargo.toml is the one under [package].
const CARGO_PACKAGE_VERSION = /^(version\s*=\s*)"([^"]*)"/m;

function read(file) {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

function write(file, content) {
  writeFileSync(path.join(ROOT, file), content);
}

function readJson(file) {
  return JSON.parse(read(file));
}

function writeJson(file, value) {
  write(file, JSON.stringify(value, null, 2) + '\n');
}

// The version every other manifest must agree with.
export function readBaselineVersion() {
  return readJson(PKG).version;
}

// Current version of each manifest, keyed by its repo-relative path.
export function readVersions() {
  const cargoToml = CARGO_PACKAGE_VERSION.exec(read(CARGO));
  const cargoLock = CARGO_LOCK_ENTRY.exec(read(CARGO_LOCK));
  return {
    [PKG]: readJson(PKG).version,
    [PKG_LOCK]: readJson(PKG_LOCK).version,
    [CARGO]: cargoToml?.[2] ?? null,
    [CARGO_LOCK]: cargoLock?.[2] ?? null,
    [TAURI_CONF]: readJson(TAURI_CONF).version
  };
}

// Files whose version differs from package.json, with what they actually hold.
export function findMismatches() {
  const versions = readVersions();
  const baseline = versions[PKG];
  return Object.entries(versions)
    .filter(([file, version]) => file !== PKG && version !== baseline)
    .map(([file, version]) => ({ file, version, expected: baseline }));
}

export function writeVersions(version) {
  const pkg = readJson(PKG);
  pkg.version = version;
  writeJson(PKG, pkg);

  const lock = readJson(PKG_LOCK);
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeJson(PKG_LOCK, lock);

  write(CARGO, read(CARGO).replace(CARGO_PACKAGE_VERSION, `$1"${version}"`));
  write(CARGO_LOCK, read(CARGO_LOCK).replace(CARGO_LOCK_ENTRY, `$1"${version}"`));

  const conf = readJson(TAURI_CONF);
  conf.version = version;
  writeJson(TAURI_CONF, conf);
}
