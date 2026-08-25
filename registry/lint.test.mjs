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
