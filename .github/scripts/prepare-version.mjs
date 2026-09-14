// Determines the version to release and writes it into every manifest.
//
// Git tags are the source of truth for what has already shipped. The repo's
// package.json version is only a floor: bump it by hand to move to a new
// minor/major, and the patch number follows the tags automatically.
//
// Rules:
// - Take the highest released `vX.Y.Z` tag and the package.json version,
//   whichever is greater, as the candidate.
// - If that candidate is already tagged, bump its patch so every run on main
//   produces a fresh release.
// - Write the result into all manifests so the built artifact matches the tag.
//   These writes stay in the runner's working tree; nothing is committed or
//   pushed back to a branch, which is what keeps release and feature branches
//   from drifting apart.
//
// Outputs (written to $GITHUB_OUTPUT):
//   version  -> the version to release, e.g. 0.1.6
//   tag      -> the tag to create, e.g. v0.1.6

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { readBaselineVersion, writeVersions } from '../../scripts/version-sync.mjs';

function parse(version) {
  const [major, minor, patch] = version.split('.').map((part) => parseInt(part, 10) || 0);
  return [major, minor, patch];
}

function isNewer(candidate, current) {
  const left = parse(candidate);
  const right = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function releasedVersions() {
  try {
    return execSync('git tag -l "v*"', { encoding: 'utf8' })
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
      .map((tag) => tag.slice(1));
  } catch {
    return [];
  }
}

function bumpPatch(version) {
  const [major, minor, patch] = parse(version);
  return `${major}.${minor}.${patch + 1}`;
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

const released = releasedVersions();
const baseline = readBaselineVersion();
const highest = released.reduce((max, version) => (isNewer(version, max) ? version : max), baseline);
const releaseVersion = released.includes(highest) ? bumpPatch(highest) : highest;

console.log(`baseline=${baseline} released=${released.length} -> releasing ${releaseVersion}`);
writeVersions(releaseVersion);

setOutput('version', releaseVersion);
setOutput('tag', `v${releaseVersion}`);
