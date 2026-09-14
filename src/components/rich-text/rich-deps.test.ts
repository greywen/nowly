// The suite stubs the lazy loader in test-setup so no dialog test pays KaTeX's
// transform cost. This file is the one place that exercises the real thing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('./rich-deps');
vi.unmock('./highlight-languages');

describe('the real lazy dependency loader', () => {
  beforeEach(async () => {
    const { resetRichTextDeps } = await import('./rich-deps');
    resetRichTextDeps();
    delete (window as unknown as { katex?: unknown }).katex;
  });

  it('highlights a registered language', async () => {
    const { loadRichTextDeps } = await import('./rich-deps');
    const { hljs } = await loadRichTextDeps();

    // Quill's syntax module branches on this, then calls the v11 signature.
    expect(typeof hljs.versionString).toBe('string');
    expect(hljs.highlight('const a = 1;', { language: 'javascript' }).value).toContain('<span');
  });

  it('publishes KaTeX on window, which the formula blot reads', async () => {
    // The blot throws 'Formula module requires KaTeX' if this is missing, so it
    // has to be in place before Quill is constructed rather than passed as an
    // option.
    const { loadRichTextDeps } = await import('./rich-deps');
    await loadRichTextDeps();
    const katex = (window as unknown as { katex?: { renderToString(tex: string): string } }).katex;
    expect(katex).toBeDefined();
    expect(katex?.renderToString('e=mc^2')).toContain('katex');
  });

  it('memoises, so the chunk is fetched once per session', async () => {
    const { loadRichTextDeps } = await import('./rich-deps');
    const [first, second] = await Promise.all([loadRichTextDeps(), loadRichTextDeps()]);
    expect(first).toBe(second);
  });
});

describe('every offered language is registered', () => {
  // This is the invariant that stops a crash. Quill merges module options with
  // lodash `merge`, which combines arrays index by index instead of replacing
  // them, so a list shorter than Quill's 14 defaults leaves its trailing entries
  // in the picker. Picking one throws inside highlight.js, and Quill's own guard
  // tests the merged list so it cannot catch that.
  it('registers a language for every picker entry, and covers Quill 2.0.3 defaults', async () => {
    const { hljs, highlightLanguages } = await import('./highlight-languages');
    for (const { key } of highlightLanguages) {
      if (key === 'plain') continue; // Quill's own no-op, never registered
      expect(hljs.getLanguage(key), key).toBeTruthy();
    }
    expect(highlightLanguages.length).toBeGreaterThanOrEqual(14);
  });
});

describe('the unregistered-language guard', () => {
  it('degrades to escaped text instead of throwing', async () => {
    const { safeHighlighter, hljs } = await import('./highlight-languages');
    // Raw highlight.js throws outright.
    expect(() => hljs.highlight('x', { language: 'nosuchlang' })).toThrow(/Unknown language/);
    // The guard returns the same shape the `plain` language produces.
    expect(safeHighlighter.highlight('a < b', { language: 'nosuchlang' })).toEqual({ value: 'a &lt; b' });
  });

  it('escapes its fallback, because Quill assigns the result to innerHTML', async () => {
    const { safeHighlighter } = await import('./highlight-languages');
    const { value } = safeHighlighter.highlight('<script>alert(1)</script>', { language: 'nosuchlang' });
    expect(value).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(value).not.toContain('<script>');
  });

  it('still delegates to highlight.js for a registered language', async () => {
    const { safeHighlighter } = await import('./highlight-languages');
    expect(safeHighlighter.highlight('SELECT 1', { language: 'sql' }).value).toContain('<span');
  });
});
