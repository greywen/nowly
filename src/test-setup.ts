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
