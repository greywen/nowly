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
