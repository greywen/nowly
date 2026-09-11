import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// The rich text editor defers construction until KaTeX (~4 MB) and highlight.js
// have loaded. Paying Vite's transform cost for those on the critical path of
// every dialog-opening test made the suite flaky: under parallel load the import
// overran `waitFor`'s 1000ms default and three App tests failed intermittently.
//
// So the loader is stubbed for the suite and the real one is covered directly by
// rich-deps.test.ts, which is the only place that pays for it.
//
// The hljs stub mirrors the v11 API Quill's syntax module calls —
// `highlight(text, { language }).value` — and escapes its output because Quill
// assigns the result straight to `innerHTML`.
vi.mock('./components/rich-text/rich-deps', () => ({
  loadRichTextDeps: () =>
    Promise.resolve({
      hljs: {
        versionString: '11.12.0',
        highlight: (text: string) => ({
          value: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        })
      },
      languages: [
        { key: 'plain', label: 'Plain' },
        { key: 'javascript', label: 'JavaScript' }
      ]
    }),
  resetRichTextDeps: () => {}
}));

// The i18n store reads its initial language from the system (navigator), and
// the existing unit tests assert Chinese output from the pure formatters /
// labels. jsdom reports `en-US` by default, so pin the reported language to
// Chinese before any module reads it, keeping those assertions valid
// regardless of the host locale.
try {
  Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
  Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true });
} catch {
  // Ignore if the properties cannot be redefined.
}

// jsdom implements Blob but not the object-URL API. The rich text editor shows
// attachments as blob: URLs, so provide a minimal stand-in that hands out stable
// fake URLs and can resolve them back to their Blob. This lets component tests
// exercise the real attachment code path instead of a mock of it.
if (typeof URL.createObjectURL !== 'function') {
  const blobs = new Map<string, Blob>();
  let counter = 0;
  URL.createObjectURL = (object: Blob | MediaSource) => {
    counter += 1;
    const url = `blob:nowly/${counter}`;
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
  };
}
