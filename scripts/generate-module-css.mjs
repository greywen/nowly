// Generates the sandbox stylesheet from the app's single source of truth
// (styles.css :root). Renaming tokens to a --nm- namespace makes drift between
// the app and modules structurally impossible: change one place, both update.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = join(here, '..', 'src', 'app', 'styles.css');
const outPath = join(here, '..', 'src', 'widgets', 'sandbox', 'nowly-module-css.ts');

// Pull `--name: value;` pairs from the first :root { ... } block.
export function extractRootTokens(css) {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error('styles.css has no :root block');
  const tokens = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/i);
    if (m) tokens.push([m[1], m[2]]);
  }
  if (tokens.length === 0) throw new Error('no tokens found in :root');
  return tokens;
}

// Curated semantic classes. Namespaced `nm-*` so app-internal class names stay
// free to refactor. Values reference the generated --nm-* tokens only.
const SEMANTIC_CLASSES = `
*, *::before, *::after {
  box-sizing: border-box;
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
html, body { margin: 0; height: 100%; }
body {
  font: 400 16px/1.5 var(--nm-font-sans);
  color: var(--nm-text-secondary);
  background: transparent;
}
#root { padding: 16px; height: 100%; }
.nm-card {
  padding: 16px;
  border: 1px solid var(--nm-border-default);
  border-radius: var(--nm-radius-default);
  background: var(--nm-bg-surface);
}
.nm-title { margin: 0; color: var(--nm-text-primary); font-size: 18.4px; font-weight: 600; }
.nm-text { margin: 0; color: var(--nm-text-secondary); font-size: 16px; }
.nm-muted { color: var(--nm-text-muted); font-size: 13.6px; }
.nm-btn {
  height: 40px; min-height: 40px; padding: 8px 24px;
  border: 1px solid transparent; border-radius: var(--nm-radius-default);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font: inherit; font-size: 16px; font-weight: 500; cursor: pointer;
  color: var(--nm-text-strong); background: var(--nm-bg-subtle);
}
.nm-btn:focus-visible { outline: none; box-shadow: var(--nm-shadow-focus); }
.nm-btn--primary { color: #ffffff; background: var(--nm-color-primary); border-color: var(--nm-color-primary); }
.nm-btn--primary:hover { background: var(--nm-color-primary-hover); }
.nm-btn--primary:active { background: var(--nm-color-primary-active); }
.nm-btn--danger { color: #ffffff; background: var(--nm-color-danger); border-color: var(--nm-color-danger); }
.nm-btn--danger:active { background: var(--nm-color-danger-active); }
.nm-input {
  height: 40px; padding: 8px 12px; width: 100%;
  border: 1px solid var(--nm-border-default); border-radius: var(--nm-radius-default);
  font: inherit; font-size: 16px; color: var(--nm-text-primary); background: var(--nm-bg-surface);
}
.nm-input:focus-visible { outline: none; border-color: var(--nm-color-primary); box-shadow: var(--nm-shadow-focus); }
.nm-tag {
  padding: 2px 8px; border-radius: var(--nm-radius-pill);
  font-size: 13.6px; font-weight: 600;
  color: var(--nm-text-secondary); background: var(--nm-bg-subtle);
}
.nm-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.nm-empty { display: grid; place-items: center; padding: 24px; color: var(--nm-text-muted); font-size: 15.2px; }
.nm-msg { padding: 12px; border-radius: var(--nm-radius-default); font-size: 15.2px; }
.nm-msg--danger { color: var(--nm-color-danger-active); background: var(--nm-color-danger-light); }

/* Optional widgets (Nowly.Select / Tabs / DatePicker / TimePicker / ColorPicker). */
.nm-field-label { display: block; margin: 0 0 6px; color: var(--nm-text-strong); font-size: 13.6px; font-weight: 600; }
.nm-select, .nm-datepicker { position: relative; }
.nm-select__trigger {
  height: 40px; width: 100%; padding: 8px 12px;
  display: inline-flex; align-items: center; justify-content: space-between; gap: 8px;
  border: 1px solid var(--nm-border-default); border-radius: var(--nm-radius-default);
  font: inherit; font-size: 16px; color: var(--nm-text-primary); background: var(--nm-bg-surface); cursor: pointer;
}
.nm-select__trigger:focus-visible, .nm-datepicker__trigger:focus-visible {
  outline: none; border-color: var(--nm-color-primary); box-shadow: var(--nm-shadow-focus);
}
.nm-select__caret { color: var(--nm-text-muted); }
.nm-select__popup, .nm-datepicker__popup {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 10;
  padding: 6px; border: 1px solid var(--nm-border-emphasis); border-radius: var(--nm-radius-default);
  background: var(--nm-bg-surface); box-shadow: var(--nm-shadow-dropdown);
}
.nm-select__listbox { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.nm-select__option {
  padding: 8px 12px; border-radius: var(--nm-radius-sm);
  color: var(--nm-text-primary); font-size: 15.2px; cursor: pointer;
}
.nm-select__option[data-active="true"] { background: var(--nm-bg-subtle); }
.nm-select__option[aria-selected="true"] { color: var(--nm-color-primary-active); font-weight: 600; }
.nm-tabs__list { display: flex; gap: 4px; border-bottom: 1px solid var(--nm-border-default); }
.nm-tabs__tab {
  padding: 8px 16px; border: none; border-bottom: 2px solid transparent;
  background: transparent; font: inherit; font-size: 15.2px; color: var(--nm-text-secondary); cursor: pointer;
}
.nm-tabs__tab:focus-visible { outline: none; box-shadow: var(--nm-shadow-focus); border-radius: var(--nm-radius-sm); }
.nm-tabs__tab[aria-selected="true"] { color: var(--nm-color-primary-active); border-bottom-color: var(--nm-color-primary); font-weight: 600; }
.nm-tabs__panel { padding: 16px 0; }
.nm-colorpicker__group { display: flex; flex-wrap: wrap; gap: 8px; }
.nm-colorpicker__swatch {
  width: 28px; height: 28px; padding: 0; border: 2px solid var(--nm-border-emphasis);
  border-radius: var(--nm-radius-pill); cursor: pointer;
}
.nm-colorpicker__swatch[aria-checked="true"] { box-shadow: var(--nm-shadow-focus); }
.nm-colorpicker__swatch:focus-visible { outline: none; box-shadow: var(--nm-shadow-focus); }
.nm-datepicker__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.nm-datepicker__nav {
  height: 32px; width: 32px; border: 1px solid var(--nm-border-default); border-radius: var(--nm-radius-sm);
  background: var(--nm-bg-surface); color: var(--nm-text-primary); cursor: pointer;
}
.nm-datepicker__nav:focus-visible { outline: none; box-shadow: var(--nm-shadow-focus); }
.nm-datepicker__month { font-size: 15.2px; font-weight: 600; color: var(--nm-text-primary); }
.nm-datepicker__weekdays, .nm-datepicker__week { display: grid; grid-template-columns: repeat(7, 1fr); }
.nm-datepicker__weekday { text-align: center; font-size: 12px; color: var(--nm-text-muted); padding: 4px 0; }
.nm-datepicker__day {
  height: 32px; border: none; border-radius: var(--nm-radius-sm);
  background: transparent; font: inherit; font-size: 14px; color: var(--nm-text-primary); cursor: pointer;
}
.nm-datepicker__day:focus-visible { outline: none; box-shadow: var(--nm-shadow-focus); }
.nm-datepicker__day[aria-selected="true"] { background: var(--nm-color-primary); color: #ffffff; font-weight: 600; }
.nm-datepicker__day--blank { visibility: hidden; }
`.trim();

export function buildModuleCss() {
  const css = readFileSync(stylesPath, 'utf8');
  const tokens = extractRootTokens(css);
  const root =
    ':root {\n  color-scheme: light;\n' +
    tokens.map(([name, value]) => `  --nm-${name.slice(2)}: ${value};`).join('\n') +
    '\n}';
  return root + '\n' + SEMANTIC_CLASSES + '\n';
}

export function renderModule(cssText) {
  return (
    '// GENERATED by scripts/generate-module-css.mjs — do not edit by hand.\n' +
    '// Source of truth: src/app/styles.css :root. Regenerate: npm run module:css\n' +
    'export const NOWLY_MODULE_CSS = ' +
    JSON.stringify(cssText) +
    ';\n'
  );
}

// Run directly: write the file.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(outPath, renderModule(buildModuleCss()), 'utf8');
  console.log(`Wrote ${outPath}`);
}
