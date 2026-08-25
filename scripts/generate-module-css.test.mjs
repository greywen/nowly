// No-drift test for the generated sandbox stylesheet. Run with `node --test`.
// Lives here (not in src/) because the generator is build tooling: the app's
// tsconfig has no node types and does not allow .js, so a vitest/tsc test that
// imports node built-ins + this .mjs would break `npm run build`. The app-side
// guarantee (sandbox injects the right tokens) is covered separately by
// src/widgets/sandbox/sandbox-runtime.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModuleCss, extractRootTokens } from './generate-module-css.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tsPath = join(here, '..', 'src', 'widgets', 'sandbox', 'nowly-module-css.ts');
const stylesPath = join(here, '..', 'src', 'app', 'styles.css');

// Pull the JSON.stringify'd string literal back out of the generated .ts file.
function committedCss() {
  const ts = readFileSync(tsPath, 'utf8');
  const m = ts.match(/export const NOWLY_MODULE_CSS = (".*");/s);
  if (!m) throw new Error('could not find NOWLY_MODULE_CSS in generated file');
  return JSON.parse(m[1]);
}

test('committed nowly-module-css.ts matches a fresh generation (no drift)', () => {
  assert.equal(committedCss(), buildModuleCss());
});

test('exports every :root token under the --nm- namespace', () => {
  const css = committedCss();
  const tokens = extractRootTokens(readFileSync(stylesPath, 'utf8'));
  for (const [name] of tokens) {
    assert.ok(css.includes(`--nm-${name.slice(2)}:`), `missing --nm-${name.slice(2)}`);
  }
});

test('carries the design.md static motion constraint', () => {
  const css = committedCss();
  assert.ok(css.includes('animation: none !important'));
  assert.ok(css.includes('transition: none !important'));
});
