// Syntax highlighting language pack, kept in its own module so Vite emits it as
// a single lazy chunk.
//
// highlight.js ships ~190 languages and its default bundle is several megabytes.
// Only `lib/core` plus a curated list is registered here: the languages this
// project is written in, plus the ones most likely to appear in a note. Adding
// one is a two-line change.
//
// KaTeX's stylesheet is imported here too so it rides the same lazy chunk
// instead of the initial bundle.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import 'katex/dist/katex.min.css';

/**
 * Languages offered in the code block picker. `plain` is Quill's own no-op and
 * needs no registration, so it is not listed among the registrations below.
 * Labels are product names, not prose, so they are not translated.
 *
 * The length matters. Quill merges module options with lodash `merge`, which
 * combines arrays *index by index* rather than replacing them, and its own
 * defaults hold 14 entries. A shorter list here would leave Quill's trailing
 * entries in place — languages that are offered in the picker but never
 * registered, and picking one throws inside highlight.js. Staying at or above 14
 * keeps that from happening; `safeHighlighter` below covers it regardless.
 */
export const highlightLanguages: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'plain', label: 'Plain' },
  { key: 'bash', label: 'Bash' },
  { key: 'c', label: 'C / C++' },
  { key: 'csharp', label: 'C#' },
  { key: 'css', label: 'CSS' },
  { key: 'diff', label: 'Diff' },
  { key: 'go', label: 'Go' },
  { key: 'java', label: 'Java' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'json', label: 'JSON' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'python', label: 'Python' },
  { key: 'rust', label: 'Rust' },
  { key: 'sql', label: 'SQL' },
  { key: 'typescript', label: 'TypeScript' },
  { key: 'xml', label: 'HTML / XML' },
  { key: 'yaml', label: 'YAML' }
];

hljs.registerLanguage('bash', bash);
// cpp registers both 'cpp' and 'c'; the picker offers it under the 'c' alias.
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * highlight.js behind a guard for unregistered languages.
 *
 * `hljs.highlight` throws `Unknown language: "x"` rather than degrading, and
 * Quill's own guard cannot catch it: that guard tests the merged options list,
 * so an entry present there but absent from highlight.js sails through. Falling
 * back to escaped text matches exactly what the `plain` language produces.
 *
 * Escaping is required, not cosmetic: Quill assigns the result straight to
 * `innerHTML`, so unescaped code containing `<` would inject markup.
 */
export const safeHighlighter = {
  versionString: hljs.versionString,
  highlight(text: string, options: { language: string }) {
    if (!hljs.getLanguage(options.language)) return { value: escapeHtml(text) };
    return hljs.highlight(text, options);
  }
};

export { hljs };
