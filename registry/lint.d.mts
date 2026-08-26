// Type surface for the plain-JS registry linter, so the TypeScript preview page
// can import it without duplicating the rules. The implementation lives in
// lint.mjs (also consumed by validate.mjs and the node:test suite).

export type LintIssue = {
  rule:
    | 'color-literal'
    | 'unbounded-loop'
    | 'remote-resource'
    | 'motion-visibility'
    | 'icon-button-label'
    | 'dom-size';
  line: number;
  message: string;
};

export function lintModuleSource(source: string): LintIssue[];
