// Lazy loader for the editor's two heavy optional dependencies.
//
// KaTeX (~4 MB unpacked, plus 20 woff2 faces) and highlight.js are only needed
// once a rich text field is actually opened, so they are dynamically imported
// and cached. Both have to be in place *before* Quill is constructed:
//
//   - the syntax module reads `options.hljs` at construction time
//   - the formula blot throws 'Formula module requires KaTeX' unless
//     `window.katex` exists when a formula is first created
//
// Hence a single promise the editor awaits before instantiating Quill, rather
// than two independent imports.

/**
 * The subset of highlight.js that Quill's syntax module actually calls. It
 * branches on `versionString` and then uses the v11 signature, so a guarded
 * stand-in only has to provide these two members.
 */
export type Highlighter = {
  versionString: string | undefined;
  highlight(text: string, options: { language: string }): { value: string };
};

export type RichTextDeps = {
  hljs: Highlighter;
  languages: ReadonlyArray<{ key: string; label: string }>;
};

let pending: Promise<RichTextDeps> | null = null;

/**
 * Load KaTeX and highlight.js. Memoised, so every editor after the first
 * resolves immediately and the chunk is fetched once per session.
 */
export function loadRichTextDeps(): Promise<RichTextDeps> {
  pending ??= (async () => {
    const [{ safeHighlighter, highlightLanguages }, katex] = await Promise.all([
      import('./highlight-languages'),
      import('katex')
    ]);
    // Quill's formula blot reads the global rather than taking an option.
    (window as unknown as { katex: unknown }).katex = katex.default ?? katex;
    // safeHighlighter rather than raw hljs: an unregistered language throws
    // inside highlight.js, and Quill's own guard cannot catch it.
    return { hljs: safeHighlighter, languages: highlightLanguages };
  })();
  return pending;
}

/** Reset the memo. Test-only, so one test's stub cannot leak into the next. */
export function resetRichTextDeps(): void {
  pending = null;
}
