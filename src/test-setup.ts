import '@testing-library/jest-dom/vitest';

// The i18n store reads its initial language from localStorage, falling back to
// the system language. jsdom reports `en-US`, but the existing unit tests assert
// Chinese output from the pure formatters/labels. Pin the language to Chinese
// before any module reads it so those assertions stay valid regardless of the
// host locale.
try {
  localStorage.setItem('nowly.language', 'zh');
} catch {
  // Ignore if storage is unavailable.
}
