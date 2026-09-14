// Fails when the app version is not identical across every manifest.
//
// Run by `npm run version:check` and in the release workflow right after the
// version is injected, so a manifest that the writer forgot cannot reach a
// build or a tag.

import { findMismatches, readBaselineVersion } from './version-sync.mjs';

const mismatches = findMismatches();

if (mismatches.length) {
  console.error(`版本不一致，package.json 为 ${readBaselineVersion()}：`);
  for (const { file, version, expected } of mismatches) {
    console.error(`  ${file}: ${version ?? '(未找到版本字段)'}，应为 ${expected}`);
  }
  process.exit(1);
}

console.log(`版本一致：${readBaselineVersion()}`);
