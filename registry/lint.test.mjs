import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintModuleSource } from './lint.mjs';

const rules = (src) => lintModuleSource(src).map((i) => i.rule);

test('flags hex color literals', () => {
  assert.ok(rules('root.style.color = "#211F1C";').includes('color-literal'));
});

test('flags rgb/hsl color literals', () => {
  assert.ok(rules('x.style.background = "rgb(1,2,3)";').includes('color-literal'));
  assert.ok(rules('x.style.background = "hsl(1,2%,3%)";').includes('color-literal'));
});

test('allows var(--nm-*) usage', () => {
  assert.deepEqual(lintModuleSource('x.style.color = "var(--nm-text-primary)";'), []);
});

test('flags unbounded while(true)', () => {
  assert.ok(rules('while (true) { work(); }').includes('unbounded-loop'));
});

test('flags for(;;)', () => {
  assert.ok(rules('for (;;) { work(); }').includes('unbounded-loop'));
});

test('flags remote resource in src=', () => {
  assert.ok(rules('img.src = "https://evil.example/x.png";').includes('remote-resource'));
});

test('flags @import of remote css', () => {
  assert.ok(rules('const c = "@import url(https://cdn.example/x.css)";').includes('remote-resource'));
});

test('allows https inside host.fetch url', () => {
  assert.deepEqual(
    lintModuleSource('await host.fetch("https://api.open-meteo.com/v1/forecast");'),
    []
  );
});

test('reports line numbers', () => {
  const issues = lintModuleSource('a();\nwhile (true) {}\n');
  assert.equal(issues[0].line, 2);
});

test('flags @motion animated without a visibility response', () => {
  const src = [
    '/**',
    ' * @nowly-module 1',
    ' * @id anim',
    ' * @name 动画',
    ' * @version 1.0.0',
    ' * @motion animated',
    ' */',
    'Nowly.defineModule(({ root }) => { requestAnimationFrame(function loop(){ loop(); }); });'
  ].join('\n');
  assert.ok(rules(src).includes('motion-visibility'));
});

test('allows @motion animated that calls onVisibilityChange', () => {
  const src = [
    '/**',
    ' * @nowly-module 1',
    ' * @id anim',
    ' * @name 动画',
    ' * @version 1.0.0',
    ' * @motion animated',
    ' */',
    'Nowly.defineModule(({ host, root }) => {',
    '  host.onVisibilityChange(function (v) { /* pause when !v */ });',
    '});'
  ].join('\n');
  assert.ok(!rules(src).includes('motion-visibility'));
});

test('does not require visibility response for static modules', () => {
  const src = [
    '/**',
    ' * @nowly-module 1',
    ' * @id calm',
    ' * @name 静态',
    ' * @version 1.0.0',
    ' */',
    'Nowly.defineModule(({ root }) => { root.textContent = "hi"; });'
  ].join('\n');
  assert.ok(!rules(src).includes('motion-visibility'));
});

test('flags an icon-only button with no accessible name', () => {
  const src = 'root.innerHTML = `<button class="nm-btn-icon"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></button>`;';
  assert.ok(rules(src).includes('icon-button-label'));
});

test('flags an icon-only button written across lines', () => {
  const src = [
    'root.innerHTML = `',
    '  <button>',
    '    <svg viewBox="0 0 24 24"><path d="M1 1"/></svg>',
    '  </button>',
    '`;'
  ].join('\n');
  assert.ok(rules(src).includes('icon-button-label'));
});

test('allows an icon button with aria-label', () => {
  const src = 'root.innerHTML = `<button aria-label="设置"><svg><path d="M1 1"/></svg></button>`;';
  assert.ok(!rules(src).includes('icon-button-label'));
});

test('allows an icon button with aria-labelledby', () => {
  const src = 'root.innerHTML = `<button aria-labelledby="lbl"><svg><path/></svg></button>`;';
  assert.ok(!rules(src).includes('icon-button-label'));
});

test('allows an icon button whose svg carries a title', () => {
  const src = 'root.innerHTML = `<button><svg><title>设置</title><path/></svg></button>`;';
  assert.ok(!rules(src).includes('icon-button-label'));
});

test('allows a button with readable text next to its icon', () => {
  const src = 'root.innerHTML = `<button><svg><path/></svg> 保存</button>`;';
  assert.ok(!rules(src).includes('icon-button-label'));
});

test('allows a text-only button', () => {
  const src = 'root.innerHTML = `<button class="nm-btn">保存</button>`;';
  assert.ok(!rules(src).includes('icon-button-label'));
});

test('reports the line where the icon button starts', () => {
  const src = [
    'a();',
    'root.innerHTML = `<button><svg><path/></svg></button>`;'
  ].join('\n');
  const issue = lintModuleSource(src).find((i) => i.rule === 'icon-button-label');
  assert.equal(issue.line, 2);
});

test('flags source that exceeds the size ceiling', () => {
  const bloat = 'root.textContent = "' + 'x'.repeat(300 * 1024) + '";';
  assert.ok(rules(bloat).includes('dom-size'));
});

test('allows a normally sized module', () => {
  const src = 'Nowly.defineModule(({ root }) => { root.textContent = "hi"; });';
  assert.ok(!rules(src).includes('dom-size'));
});

// The linter runs in the browser too (preview page channel B and the in-app
// workbench channel A both import it), where Node's `Buffer` does not exist.
// Measuring source size must use a cross-environment API, so guard against a
// regression to `Buffer.byteLength` by running the size check with `Buffer`
// removed from the global scope.
test('measures source size without relying on Node Buffer', () => {
  const saved = globalThis.Buffer;
  // eslint-disable-next-line no-global-assign
  globalThis.Buffer = undefined;
  try {
    const bloat = 'root.textContent = "' + 'x'.repeat(300 * 1024) + '";';
    assert.ok(rules(bloat).includes('dom-size'));
    const small = 'root.textContent = "hi";';
    assert.ok(!rules(small).includes('dom-size'));
  } finally {
    globalThis.Buffer = saved;
  }
});
