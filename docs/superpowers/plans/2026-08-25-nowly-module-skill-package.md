# Nowly 模块技能包与样式底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一份「装上即能一次写对」的自定义模块技能包，其引用的样式类名与令牌来自 `styles.css` 生成的单一真相源，并由校验器机械兜底检查清单。

**Architecture:** 令牌唯一真相源是 `src/app/styles.css` 的 `:root`。一个生成脚本把它重命名为 `--nm-*` 前缀、附加语义类与静态动效约束，产出 `src/widgets/sandbox/nowly-module-css.ts`（编译期常量）注入沙箱 iframe，替换掉已漂移的硬编码 `SANDBOX_STYLES`。技能包 `docs/custom-modules/` 引用这些最终类名，校验器 `registry/lint.mjs` 机械扫描技能包检查清单中的三条硬约束（颜色字面量、无界循环、远程资源）。

**Tech Stack:** TypeScript、Vite、Vitest（前端单测）、Node built-in `node:test`（registry 校验器单测）、纯 JS 模块文件。

**Scope note（本计划边界）：** 本计划只覆盖设计规格 `docs/superpowers/specs/2026-08-25-nowly-module-system-v2-design.md` 第 12 节实施顺序中的 **步骤 1（§10 修订）、步骤 2（样式底座）、步骤 5（技能包）、步骤 8 的校验器部分**。以下子系统各自独立、留作后续计划，不在本计划内：步骤 3 可见性协议、步骤 4 可选部件、步骤 6 弹框面、步骤 7/9 预览通道 A/B、registry schema（`license`/`motion`）扩展、主文档 CSP 加固（Q5）。选择这一切片的理由：技能包是本次交付主体，它只依赖「最终类名/令牌」（步骤 2）、「动效规范措辞」（步骤 1）和「可机械执行的检查清单」（步骤 8）。这四项合起来构成一个自足、可测试的成果：干净 AI 会话拿到技能包即可写出通过校验的模块。

---

## File Structure

**新建：**
- `scripts/generate-module-css.mjs` — 从 `styles.css` 的 `:root` 生成 `--nm-*` 令牌 + 语义类 + 动效约束，写入下一个文件。
- `src/widgets/sandbox/nowly-module-css.ts` — 生成产物（编译期常量 `NOWLY_MODULE_CSS`）。committed，由生成脚本覆写。
- `scripts/generate-module-css.test.mjs` — no-drift 测试（`node:test`）：断言 committed 的 `nowly-module-css.ts` 与从当前 `styles.css` 现生成的结果一致，且含全部 `:root` 令牌的 `--nm-` 版本。（原计划放在 `src/` 下的 vitest 测试，但它 import node 内建与 `.mjs`，会被 `tsc` 类型检查拦下——app tsconfig 无 `@types/node` 且 `allowJs:false`。生成器属构建工具，其测试改用仓库既有的 `node:test` 约定，与 `registry/lint.test.mjs` 一致。app 侧「沙箱注入正确令牌」的保证已由 `sandbox-runtime.test.ts` 覆盖。）
- `registry/lint.mjs` — 导出 `lintModuleSource(source)`，返回问题数组。纯函数、无 IO。
- `registry/lint.test.mjs` — `node:test` 单测，覆盖三条规则的命中与放行。
- `docs/custom-modules/style.md` — `nm-*` 类清单与 `--nm-*` 令牌参考。
- `docs/custom-modules/size.md` — 尺寸表与三档断点。
- `docs/custom-modules/templates/minimal.js` — 纯展示模板。
- `docs/custom-modules/templates/stateful.js` — 持久化 + 设置面板模板。
- `docs/custom-modules/templates/network.js` — `host.fetch` 模板。

**修改：**
- `design.md:535` — §10 标题与措辞改为原则式。
- `src/widgets/sandbox/sandbox-runtime.ts:110-131` — 用 `NOWLY_MODULE_CSS` 替换 `SANDBOX_STYLES`。
- `src/widgets/sandbox/sandbox-runtime.test.ts` — 断言注入的是新令牌、不含旧漂移色值。
- `registry/validate.mjs` — 调用 `lintModuleSource` 兜底扫描本地模块源码。
- `registry/modules/hello-clock.js` — 去掉颜色字面量与 inline font，改用注入的 `nm-*` 与 `--nm-*`。
- `registry/registry.json:19` — 更新 `hello-clock` 的 `sha256`。
- `docs/custom-modules/SKILL.md` — §3 颜色抄写段改为「只用 `var(--nm-*)` / `nm-*`」；补断点、循环边界约束；链接子文件。
- `package.json:32` — 新增 `module:css`、`registry:lint`、`registry:validate` 脚本。
- `docs/00-index.md` — 在 Product Specs / Plans 区补本计划链接。

---

## Task 1: design.md §10 改为原则式表述

**Files:**
- Modify: `design.md:535`

- [ ] **Step 1: 改写 §10**

把 `design.md` 中 `## 10. 禁止动效` 整节（从标题到该节末尾的 `---`）替换为：

```markdown
## 10. 禁止补间与装饰性动效

本节的意图不是禁止一切运动，而是**禁止插值与装饰性运动**。判定标准如下表：

| 允许 | 禁止 |
|---|---|
| 内容随时间的离散变化（时钟走字、倒计时环每秒重绘） | 状态 A→B 的补间（淡入、滑动、缩放） |
| 直接响应输入的运动（拖拽跟手） | 装饰性、表现性的持续运动 |
| 即时状态切换（hover / active / focus / selected / expanded / checked） | 循环动画（spinner、进度条循环、skeleton shimmer、轮播、视差、平滑滚动） |

全局实现必须包含等效于以下规则的静态约束，把「禁止补间」从纪律变成物理事实：

```css
*,
*::before,
*::after {
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
```

**注意**：上面这段 CSS 拦不住 `requestAnimationFrame` 逐帧改属性。JS 驱动的补间动画同样在禁止之列——这是一条堵漏条款，而非另设标准。`FocusTimerWidget` 的倒计时环每秒重绘、`ModuleGrid` 的拖拽跟手都属于「离散变化 / 输入驱动」，因此合规。

禁止项包括但不限于：CSS `animation` / `transition`、JS 补间、页面切换淡入淡出、卡片 hover 上浮或缩放、按钮点击缩放、菜单展开/收起过渡、模态框渐显/缩放/位移、Loading Spinner、进度条循环动画、Skeleton shimmer、自动轮播、视差滚动、平滑滚动、图标旋转或路径描边动画。

自定义模块内容区的动效为**有条件放开**（清单头声明 `@motion animated`、不可见暂停、专注模式暂停、全局静默开关），详见模块系统规格。
```

- [ ] **Step 2: 提交**

```bash
git add design.md
git commit -m "docs: reframe design.md motion rule as principle over blanket ban"
```

---

## Task 2: 生成 `nowly-module.css` 令牌底座

**Files:**
- Create: `scripts/generate-module-css.mjs`
- Create: `src/widgets/sandbox/nowly-module-css.ts`
- Test: `src/widgets/sandbox/nowly-module-css.test.ts`
- Modify: `package.json:32`

- [ ] **Step 1: 写生成脚本**

Create `scripts/generate-module-css.mjs`。它读取 `styles.css` 的 `:root` 块，把每个 `--x` 令牌重命名为 `--nm-x`，再拼上静态动效约束与语义类，导出一个可被脚本和测试共用的 `buildModuleCss()`。

```js
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
```

- [ ] **Step 2: 加 npm 脚本**

Modify `package.json` scripts 段，在 `"tauri": "tauri"` 之后加：

```json
    "tauri": "tauri",
    "module:css": "node scripts/generate-module-css.mjs",
    "registry:lint": "node --test registry/lint.test.mjs",
    "registry:validate": "node registry/validate.mjs"
```

（`registry:lint`/`registry:validate` 供后续任务用，这里一并加。另在 Task 2 补 `"test:tooling": "node --test scripts/generate-module-css.test.mjs registry/lint.test.mjs"` 一并跑两个 `.mjs` 套件。）

- [ ] **Step 3: 生成产物文件**

Run: `npm run module:css`
Expected: 打印 `Wrote .../nowly-module-css.ts`，并生成 `src/widgets/sandbox/nowly-module-css.ts`。

- [ ] **Step 4: 写 no-drift 测试**

Create `src/widgets/sandbox/nowly-module-css.test.ts`:

```ts
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
```

- [ ] **Step 5: 跑测试**

Run: `npm test -- nowly-module-css`
Expected: PASS（3 项）。

- [ ] **Step 6: 提交**

```bash
git add scripts/generate-module-css.mjs src/widgets/sandbox/nowly-module-css.ts src/widgets/sandbox/nowly-module-css.test.ts package.json
git commit -m "feat: generate nm-* module stylesheet from styles.css tokens"
```

---

## Task 3: 沙箱注入新样式，去掉漂移的 SANDBOX_STYLES

**Files:**
- Modify: `src/widgets/sandbox/sandbox-runtime.ts:110-131`
- Modify: `src/widgets/sandbox/sandbox-runtime.test.ts`

- [ ] **Step 1: 改测试先失败**

在 `sandbox-runtime.test.ts` 的 `describe('buildSandboxDocument', ...)` 里新增一个用例，并在文件顶部 import 常量：

```ts
import { NOWLY_MODULE_CSS } from './nowly-module-css';
```

```ts
  it('injects the generated nm-* stylesheet and drops the old drifted values', () => {
    const doc = buildSandboxDocument('');
    expect(doc).toContain('--nm-text-primary: #211f1c');
    expect(doc).toContain('.nm-btn');
    // The old hardcoded drift must be gone.
    expect(doc).not.toContain('#1f2733');
    expect(doc).not.toContain('border-radius: 8px');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- sandbox-runtime`
Expected: FAIL — 文档仍含 `#1f2733`，且不含 `--nm-text-primary`。

- [ ] **Step 3: 替换样式常量**

在 `sandbox-runtime.ts` 顶部加 import：

```ts
import { NOWLY_MODULE_CSS } from './nowly-module-css';
```

删除整段 `const SANDBOX_STYLES = \`...\`;`（约 110–131 行），并把 `buildSandboxDocument` 里 `<style>${SANDBOX_STYLES}</style>` 改为：

```ts
<style>${NOWLY_MODULE_CSS}</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- sandbox-runtime`
Expected: PASS（含新用例，原有 4 项不回归）。

- [ ] **Step 5: 提交**

```bash
git add src/widgets/sandbox/sandbox-runtime.ts src/widgets/sandbox/sandbox-runtime.test.ts
git commit -m "refactor: inject generated nm-* stylesheet into sandbox, drop drifted SANDBOX_STYLES"
```

---

## Task 4: 校验器 lint 规则（颜色字面量 / 无界循环 / 远程资源）

**Files:**
- Create: `registry/lint.mjs`
- Test: `registry/lint.test.mjs`

- [ ] **Step 1: 写 lint 单测（先失败）**

Create `registry/lint.test.mjs`:

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test registry/lint.test.mjs`
Expected: FAIL — `Cannot find module './lint.mjs'`.

- [ ] **Step 3: 实现 lint**

Create `registry/lint.mjs`:

```js
// Mechanical checklist enforcement for module source. Not a security boundary
// (the sandbox is) — it backs the skill-package checklist so the three easiest
// mistakes fail fast in CI and at install-review time. Returns [{ rule, line,
// message }]. Pure: no IO.

const RULES = [
  {
    rule: 'color-literal',
    // Hex (#rgb/#rrggbb) or rgb()/rgba()/hsl()/hsla(). Modules must use
    // var(--nm-*) so future theming can cover already-published modules.
    re: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/,
    message: 'color literal — use var(--nm-*) tokens instead'
  },
  {
    rule: 'unbounded-loop',
    re: /\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/,
    message: 'unbounded loop — loops must have an explicit bound'
  },
  {
    rule: 'remote-resource',
    // https appearing as a loaded resource (src=/href=/@import/importScripts),
    // NOT inside host.fetch (which is the only sanctioned network path).
    re: /(?:\bsrc\s*=|\bhref\s*=|@import\s+(?:url\()?|importScripts\s*\()\s*["'`]?\s*https:\/\//i,
    message: 'remote resource — inline scripts/fonts/images, never load remotely'
  }
];

export function lintModuleSource(source) {
  const issues = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { rule, re, message } of RULES) {
      if (re.test(lines[i])) issues.push({ rule, line: i + 1, message });
    }
  }
  return issues;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run registry:lint`
Expected: PASS（9 项）。

- [ ] **Step 5: 提交**

```bash
git add registry/lint.mjs registry/lint.test.mjs
git commit -m "feat: add module source linter for color/loop/remote-resource rules"
```

---

## Task 5: 迁移 hello-clock 到 nm-* 并接入校验器

**Files:**
- Modify: `registry/modules/hello-clock.js`
- Modify: `registry/validate.mjs`
- Modify: `registry/registry.json:19`

- [ ] **Step 1: 迁移 hello-clock 源码**

用下面内容整体替换 `registry/modules/hello-clock.js`。去掉 inline font 与所有 hex 色值，改用注入的 body 字体与 `nm-*` 类。

```js
/**
 * @nowly-module 1
 * @id           hello-clock
 * @name         今日时钟
 * @version      1.0.1
 * @author       nowly
 * @description  显示今天的日期与一个本地走动的时钟，演示无联网的纯展示模块
 * @permissions  today
 * @minSize      3x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const date = document.createElement('p');
  date.className = 'nm-muted';
  date.style.margin = '0 0 8px';
  date.textContent = host.todayIso ? '今天：' + host.todayIso : '';

  const clock = document.createElement('p');
  clock.className = 'nm-title';
  clock.style.margin = '0';
  clock.style.fontSize = '28px';

  root.appendChild(date);
  root.appendChild(clock);

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clock.textContent = hh + ':' + mm + ':' + ss;
  }

  tick();
  setInterval(tick, 1000);
});
```

- [ ] **Step 2: 接入校验器**

在 `registry/validate.mjs` 顶部 import 段之后加：

```js
import { lintModuleSource } from './lint.mjs';
```

在 `dangerousPatterns` 命中检查那段（`const hits = dangerousPatterns(source);` 之后）追加：

```js
  // Checklist lint (color literals, unbounded loops, remote resources).
  for (const issue of lintModuleSource(source)) {
    fail(id, `lint ${issue.rule} at line ${issue.line}: ${issue.message}`);
  }
```

- [ ] **Step 3: 跑校验取新 sha256**

Run: `npm run registry:validate`
Expected: FAIL，输出一行 `sha256 mismatch: entry has <old>, file is <new>`。复制 `<new>`。

- [ ] **Step 4: 更新 registry.json**

把 `registry/registry.json` 中 `hello-clock` 的 `"version"` 改为 `"1.0.1"`，`"sha256"` 改为上一步的 `<new>` 值。

- [ ] **Step 5: 跑校验确认通过**

Run: `npm run registry:validate`
Expected: `Registry OK: 1 module(s) validated.`

- [ ] **Step 6: 提交**

```bash
git add registry/modules/hello-clock.js registry/validate.mjs registry/registry.json
git commit -m "refactor: migrate hello-clock to nm-* tokens and wire lint into registry validation"
```

---

## Task 6: 技能包子文件与模板

**Files:**
- Create: `docs/custom-modules/style.md`
- Create: `docs/custom-modules/size.md`
- Create: `docs/custom-modules/templates/minimal.js`
- Create: `docs/custom-modules/templates/stateful.js`
- Create: `docs/custom-modules/templates/network.js`

- [ ] **Step 1: 写 style.md**

Create `docs/custom-modules/style.md`:

```markdown
# nm-* 样式参考

沙箱注入了一份从 `styles.css` 生成的样式表。**你看不到父页面的 CSS**，但可以直接用下面的 `--nm-*` 令牌和 `nm-*` 语义类。**禁止写颜色字面量**（校验器会拒），一律用令牌。

## 令牌（节选，全部以 `--nm-` 为前缀）

| 用途 | 令牌 |
|---|---|
| 主色 / hover / active / 浅底 | `--nm-color-primary` / `--nm-color-primary-hover` / `--nm-color-primary-active` / `--nm-color-primary-light` |
| 成功 / 警告 / 危险 | `--nm-color-success` / `--nm-color-warning` / `--nm-color-danger` |
| 标题 / 正文 / 弱说明 | `--nm-text-primary` / `--nm-text-secondary` / `--nm-text-muted` |
| 表面 / 浅底 / 边框 | `--nm-bg-surface` / `--nm-bg-subtle` / `--nm-border-default` |
| 圆角 小 / 默认 / 胶囊 | `--nm-radius-sm` / `--nm-radius-default` / `--nm-radius-pill` |
| 焦点环 | `--nm-shadow-focus` |
| 字体 | `--nm-font-sans` |

## 语义类

- `.nm-card` 卡片容器（边框 + 圆角 + 表面底色）
- `.nm-title` / `.nm-text` / `.nm-muted` 文本层级
- `.nm-btn`（默认）/ `.nm-btn--primary` / `.nm-btn--danger`
- `.nm-input` 输入框
- `.nm-tag` 胶囊标签
- `.nm-list` 无样式列表
- `.nm-empty` 空状态
- `.nm-msg` / `.nm-msg--danger` 消息条

## 规矩

- 只用 `var(--nm-*)`，不写 `#`、`rgb()`、`hsl()`。
- 不加 `transition` / `animation` / 任何补间。状态即时切换。
- 图标用内联 SVG，不引远程资源。
```

- [ ] **Step 2: 写 size.md**

Create `docs/custom-modules/size.md`:

```markdown
# 尺寸与断点

iframe 视口即模块尺寸，直接写 `@media` 即可，不需要 container query。网格 12×8，`@minSize` 下限 `2x2`（约 195×143px）。

## 视口实际范围

| 格数（宽） | 宽度 | 格数（高） | 高度 |
|---:|---|---:|---|
| 2 | 195–403 px | 2 | 143–318 px |
| 4 | 405–837 px | 4 | 301–667 px |
| 6 | 639–1272 px | 6 | 476–1017 px |
| 12 | 1290–2576 px | 8 | 638–1366 px |

## 三档断点（覆盖上表）

```css
/* 紧凑：单列、隐藏次要信息 */
@media (max-width: 320px) { /* ... */ }
/* 标准 */
@media (min-width: 320px) and (max-width: 620px) { /* ... */ }
/* 宽松：多列、展开细节 */
@media (min-width: 620px) { /* ... */ }
```

`@minSize` 必须声明为「内容仍可用」的尺寸，不是「不报错」的尺寸。
```

- [ ] **Step 3: 写三个模板**

Create `docs/custom-modules/templates/minimal.js`:

```js
/**
 * @nowly-module 1
 * @id           my-module
 * @name         我的模块
 * @version      1.0.0
 * @author       yourname
 * @description  一句话描述
 * @permissions  today
 * @minSize      2x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';

  const title = document.createElement('p');
  title.className = 'nm-title';
  title.textContent = '你好，Nowly';

  const today = document.createElement('p');
  today.className = 'nm-muted';
  today.style.margin = '8px 0 0';
  today.textContent = host.todayIso ? '今天：' + host.todayIso : '';

  card.appendChild(title);
  card.appendChild(today);
  root.appendChild(card);
});
```

Create `docs/custom-modules/templates/stateful.js`:

```js
/**
 * @nowly-module 1
 * @id           my-counter
 * @name         计数器
 * @version      1.0.0
 * @author       yourname
 * @description  带持久化的计数器
 * @permissions  state, today
 * @minSize      3x3
 * @defaultSize  4x4
 */
Nowly.defineModule(async ({ host, root }) => {
  let state = (await host.loadState()) || { count: 0 };

  function button(label, variant, onClick) {
    const el = document.createElement('button');
    el.className = variant ? 'nm-btn nm-btn--' + variant : 'nm-btn';
    el.textContent = label;
    el.onclick = onClick;
    return el;
  }

  function render() {
    root.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'nm-card';

    if (host.todayIso) {
      const date = document.createElement('p');
      date.className = 'nm-muted';
      date.style.margin = '0 0 12px';
      date.textContent = '今天：' + host.todayIso;
      card.appendChild(date);
    }

    const value = document.createElement('p');
    value.className = 'nm-title';
    value.style.margin = '0 0 16px';
    value.textContent = '计数：' + state.count;
    card.appendChild(value);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.appendChild(button('+1', 'primary', async () => {
      state = { count: state.count + 1 };
      await host.saveState(state);
      render();
    }));
    row.appendChild(button('重置', '', async () => {
      state = { count: 0 };
      await host.saveState(state);
      render();
    }));
    card.appendChild(row);
    root.appendChild(card);
  }

  render();
});
```

Create `docs/custom-modules/templates/network.js`:

```js
/**
 * @nowly-module 1
 * @id           weather-widget
 * @name         天气
 * @version      1.0.0
 * @author       yourname
 * @description  显示当前城市的实时天气
 * @permissions  network
 * @network      api.open-meteo.com
 * @minSize      3x2
 * @defaultSize  4x3
 */
Nowly.defineModule(async ({ host, root }) => {
  const card = document.createElement('div');
  card.className = 'nm-card';
  const line = document.createElement('p');
  line.className = 'nm-text';
  line.textContent = '加载中…';
  card.appendChild(line);
  root.appendChild(card);

  try {
    const res = await host.fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m'
    );
    const temp = res.json && res.json.current ? res.json.current.temperature_2m : null;
    line.textContent = temp != null ? '当前气温：' + temp + '°C' : '暂无数据';
  } catch (error) {
    line.className = 'nm-msg nm-msg--danger';
    line.textContent = '获取失败：' + error.message;
  }
});
```

- [ ] **Step 4: 用校验器验证三个模板与迁移后的 hello-clock**

Run:
```bash
node -e "import('./registry/lint.mjs').then(async ({lintModuleSource}) => { const {readFileSync}=await import('node:fs'); for (const f of ['docs/custom-modules/templates/minimal.js','docs/custom-modules/templates/stateful.js','docs/custom-modules/templates/network.js']) { const issues=lintModuleSource(readFileSync(f,'utf8')); console.log(f, issues); if(issues.length) process.exit(1);} console.log('all templates clean'); })"
```
Expected: 每个模板打印 `[]`，最后 `all templates clean`。

也用现有 manifest 解析确认清单头合法：
```bash
node -e "import('./src/widgets/module-manifest.ts')" 2>/dev/null || echo "skip: TS 解析器仅在 vitest 内验证，见 Step 5"
```

- [ ] **Step 5: 提交**

```bash
git add docs/custom-modules/style.md docs/custom-modules/size.md docs/custom-modules/templates
git commit -m "docs: add module skill sub-references and three lint-clean templates"
```

---

## Task 7: 更新 SKILL.md 主文档

**Files:**
- Modify: `docs/custom-modules/SKILL.md`

- [ ] **Step 1: 改 §3 颜色段与 frontmatter 链接**

在 `SKILL.md` 的 §3「视觉样式规范」把「直接用这些色值」的整张色表替换为令牌纪律说明，并在文首硬约束（§0）后补链接。具体改动：

§0 末尾追加一条：

```markdown
6. **颜色只能用 `var(--nm-*)` 令牌，禁止任何 `#`/`rgb()`/`hsl()` 字面量。** 校验器会拒绝含颜色字面量的模块。
7. **循环必须有明确边界。** `while (true)` / `for (;;)` 会被校验器拒绝，且死循环会冻结整个应用。
```

§3.2「颜色（直接用这些值）」整段（那张 hex 色表）替换为：

```markdown
### 3.2 颜色：只用令牌

沙箱注入了一份从应用 `styles.css` 生成的样式表。**不要写颜色字面量**——一律用 `var(--nm-*)` 令牌，否则校验器拒绝安装，且未来主题化无法覆盖你的模块。

常用令牌：`--nm-color-primary`、`--nm-text-primary`、`--nm-text-secondary`、`--nm-text-muted`、`--nm-bg-surface`、`--nm-bg-subtle`、`--nm-border-default`。完整清单与 `nm-*` 语义类见 [style.md](./style.md)。
```

§3.3「其它」里凡出现具体 hex（如焦点环 `rgba(...)`）的地方，改为引用令牌 `var(--nm-shadow-focus)` 等；圆角/字体/间距的字面值保留（它们不是颜色）。

在 §3 末尾追加尺寸引用：

```markdown
### 3.4 尺寸与断点

模块视口即卡片尺寸。三档断点与格数换算见 [size.md](./size.md)。
```

- [ ] **Step 2: 更新起始模板引用**

§4「完整起始模板」的代码块整体替换为指向模板文件的说明 + minimal 模板内容：

```markdown
## 4. 起始模板

三个可直接复制的模板：

- [templates/minimal.js](./templates/minimal.js) — 纯展示
- [templates/stateful.js](./templates/stateful.js) — 持久化 + 按钮
- [templates/network.js](./templates/network.js) — `host.fetch` 联网

最小模板：

（此处保留 minimal.js 的内容作内联示例，与文件保持一致）
```

把原来那段 11 行 `el.style.xxx` 手写按钮的模板删掉——它的存在正是为了覆盖旧的漂移默认值，现在 `nm-btn` 已经对齐，不再需要。

- [ ] **Step 3: 更新 §6 检查清单**

在 §6「提交前检查清单」加两条，并去掉与颜色字面量矛盾的旧条目：

```markdown
- [ ] 没有任何颜色字面量（`#`/`rgb()`/`hsl()`）；颜色一律 `var(--nm-*)`。
- [ ] 没有无界循环（`while (true)` / `for (;;)`）；所有循环有明确边界。
```

- [ ] **Step 4: 人工核对**

Read `docs/custom-modules/SKILL.md` 通读一遍，确认：不再出现任何 hex 颜色抄写表；所有链接（style.md / size.md / templates/*）路径正确；§0 硬约束与 §6 检查清单一致。

- [ ] **Step 5: 提交**

```bash
git add docs/custom-modules/SKILL.md
git commit -m "docs: point SKILL.md at nm-* tokens, templates, and lint-backed checklist"
```

---

## Task 8: 文档索引与全量门禁

**Files:**
- Modify: `docs/00-index.md`

- [ ] **Step 1: 更新索引**

在 `docs/00-index.md` 的 Product Specs 区已有的模块系统 v2 规格链接下方，Implementation Plans 区末尾追加：

```markdown
- [Nowly 模块技能包与样式底座实施计划](./superpowers/plans/2026-08-25-nowly-module-skill-package.md)
```

- [ ] **Step 2: 跑全量门禁**

Run:
```bash
npm test && npm run build && npm run registry:lint && npm run registry:validate
```
Expected: vitest 全绿、`tsc + vite build` 成功、lint 9 项通过、`Registry OK: 1 module(s) validated.`

- [ ] **Step 3: 提交**

```bash
git add docs/00-index.md
git commit -m "docs: index the module skill-package implementation plan"
```

---

## Self-Review

**Spec coverage（对照规格第 12 节实施顺序）：**
- 步骤 1（§10 修订）→ Task 1 ✓
- 步骤 2（样式底座 + hello-clock 迁移）→ Task 2/3/5 ✓
- 步骤 5（技能包 SKILL.md + 子文件 + 模板）→ Task 6/7 ✓
- 步骤 8 校验器部分（颜色字面量、无界循环、远程资源）→ Task 4/5 ✓
- 步骤 3/4/6/7/9、registry schema、CSP → 明确列在 Scope note 的后续计划，非本计划缺口。
- 规格第 8 节要求的 `install/AGENTS.md`、`install/install.md`、`preview.md` → 归属预览通道与安装分发子系统，随步骤 7/9 的后续计划交付；本计划的技能包主干（SKILL.md + style/size + templates）已自足可用。

**Placeholder scan:** 无 TBD/TODO。唯一非字面代码处是 Task 7 Step 2「保留 minimal.js 内容作内联示例」——内容已在 Task 6 Step 3 给出完整源码，此处为「与该文件保持一致」的复制指令，非占位。

**Type/名称一致性：**
- 生成脚本导出 `buildModuleCss` / `extractRootTokens` / `renderModule`，Task 2 测试 import 的正是 `buildModuleCss` / `extractRootTokens`。✓
- 常量名 `NOWLY_MODULE_CSS` 在 Task 2 生成、Task 2/3 测试与 Task 3 注入处一致。✓
- lint 导出 `lintModuleSource`，Task 4 测试、Task 5 validate.mjs、Task 6 模板校验处一致；返回结构 `{ rule, line, message }` 与测试断言 `.rule` / `.line` 一致。✓
- lint 规则名 `color-literal` / `unbounded-loop` / `remote-resource` 在实现、测试、validate 报错串中一致。✓

**已知取舍（实施时留意）：**
- `.nm-btn--primary` / `.nm-btn--danger` 的白色文字在生成脚本的 `SEMANTIC_CLASSES` 里写作 `#ffffff` 字面量。这是**样式表内部**，不经过 `lintModuleSource`（lint 只扫模块源码，不扫注入的 CSS），故不违反 D5。若未来要主题化按钮文字，应在 `styles.css` 补 `--text-on-primary` 令牌并回改生成脚本。
- color-literal 正则会误伤模块源码字符串里合法的十六进制（如 `'#tab'` 之类 DOM id 选择器或 emoji 码点）。规格 D5 接受「拦不住间接写法、可能误伤」，命中即由人工复核，符合校验器「机械兜底 + 人工判定信任」的定位。
