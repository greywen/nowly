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

// A module that declares `@motion animated` opts into continuous motion, which
// is only allowed when it pauses off-screen. The runtime relays visibility via
// `host.onVisibilityChange`; a module that never calls it cannot honor the
// pause obligation, so we reject it. Static modules (the default) never animate
// and need no such code.
function motionVisibilityIssue(source) {
  const header = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  const motion = header && /@motion\s+animated\b/i.test(header[1]);
  if (!motion) return null;
  if (/onVisibilityChange/.test(source)) return null;
  return {
    rule: 'motion-visibility',
    line: 1,
    message: '@motion animated must call host.onVisibilityChange to pause off-screen'
  };
}

// Buttons whose only content is an icon (an <svg>) with no accessible name are
// invisible to screen readers. We accept an accessible name from any of: an
// aria-label / aria-labelledby / title attribute on the button, a <title>
// inside the svg, or readable text sitting next to the icon. Anything else with
// an <svg> and no text is flagged. This scans the whole source because the
// button can span multiple lines.
function iconButtonIssues(source) {
  const issues = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    if (!/<svg\b/i.test(inner)) continue; // not an icon button
    const labelledByAttr = /\b(?:aria-label|aria-labelledby|title)\s*=/i.test(attrs);
    const svgTitle = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(inner);
    const readableText = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, '') !== '';
    if (labelledByAttr || svgTitle || readableText) continue;
    const line = source.slice(0, m.index).split('\n').length;
    issues.push({
      rule: 'icon-button-label',
      line,
      message: 'icon-only button needs an aria-label (or visible text/svg <title>)'
    });
  }
  return issues;
}

// Upper bound on module source size. The spec leaves the exact number open
// ("节点数或源码体积的合理上限"); we bound source bytes rather than live DOM
// nodes because the linter is static and cannot execute the module to count
// nodes. 256 KiB is generous for a self-contained module that inlines its SVG
// icons and even a small helper library, but it catches a whole framework or a
// generated blob accidentally pasted in — code that is too large for a human
// reviewer to actually audit, which is the point of the ceiling.
const MAX_SOURCE_BYTES = 256 * 1024;

function domSizeIssue(source) {
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes <= MAX_SOURCE_BYTES) return null;
  return {
    rule: 'dom-size',
    line: 1,
    message: `module source is ${bytes} bytes, over the ${MAX_SOURCE_BYTES}-byte ceiling`
  };
}

export function lintModuleSource(source) {
  const issues = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { rule, re, message } of RULES) {
      if (re.test(lines[i])) issues.push({ rule, line: i + 1, message });
    }
  }
  const motion = motionVisibilityIssue(source);
  if (motion) issues.push(motion);
  issues.push(...iconButtonIssues(source));
  const domSize = domSizeIssue(source);
  if (domSize) issues.push(domSize);
  return issues;
}
