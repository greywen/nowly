import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOWLY_MODULE_CSS } from './nowly-module-css';
import { buildModuleCss, extractRootTokens } from '../../../scripts/generate-module-css.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = join(here, '..', '..', 'app', 'styles.css');

describe('nowly-module-css', () => {
  it('matches a fresh generation from styles.css (no drift)', () => {
    expect(NOWLY_MODULE_CSS).toBe(buildModuleCss());
  });

  it('exports every :root token under the --nm- namespace', () => {
    const tokens = extractRootTokens(readFileSync(stylesPath, 'utf8'));
    for (const [name] of tokens) {
      expect(NOWLY_MODULE_CSS).toContain(`--nm-${name.slice(2)}:`);
    }
  });

  it('carries the design.md static motion constraint', () => {
    expect(NOWLY_MODULE_CSS).toContain('animation: none !important');
    expect(NOWLY_MODULE_CSS).toContain('transition: none !important');
  });
});
