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
  return issues;
}
