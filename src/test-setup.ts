import '@testing-library/jest-dom/vitest';

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
