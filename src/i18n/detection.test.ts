import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-CN'] });
  Reflect.deleteProperty(window, '__NOWLY_SYSTEM_LANGUAGE__');
  vi.resetModules();
});

it('uses English when the primary language is unsupported, not a secondary preference', async () => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'de-DE' });
  Object.defineProperty(navigator, 'languages', { configurable: true, value: ['de-DE', 'ja-JP', 'en-US'] });
  expect((await import('./store')).getLanguage()).toBe('en');
});

it.each([
  ['zh-CN', 'zh'], ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'],
  ['en-GB', 'en'], ['fr-CA', 'fr'], ['es-MX', 'es'],
  ['ar-SA', 'ar'], ['ja-JP', 'ja'], ['ko-KR', 'ko'],
])('matches the primary %s language to %s', async (tag, expected) => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { configurable: true, value: tag });
  expect((await import('./store')).getLanguage()).toBe(expected);
});

it.each([null, undefined, ''])('uses English when the primary language is missing (%s)', async tag => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { configurable: true, value: tag });
  expect((await import('./store')).getLanguage()).toBe('en');
});

it.each([['fr-FR', 'fr'], ['zh-TW', 'zh-Hant'], ['de-DE', 'en'], [null, 'en']])(
  'prefers the native Windows UI language %s over WebView preferences', async (tag, expected) => {
    vi.resetModules();
    localStorage.clear();
    Object.defineProperty(window, '__NOWLY_SYSTEM_LANGUAGE__', { configurable: true, value: tag });
    expect((await import('./store')).getLanguage()).toBe(expected);
    expect(localStorage.getItem('nowly.language')).toBeNull();
  },
);

it('preserves an explicit saved choice even when Windows uses another language', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'ja');
  Object.defineProperty(window, '__NOWLY_SYSTEM_LANGUAGE__', { configurable: true, value: 'fr-FR' });
  expect((await import('./store')).getLanguage()).toBe('ja');
});

it('follows Windows again when the saved choice is cleared in another window', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'ja');
  Object.defineProperty(window, '__NOWLY_SYSTEM_LANGUAGE__', { configurable: true, value: 'fr-FR' });
  const store = await import('./store');
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  try {
    localStorage.removeItem('nowly.language');
    window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: null }));
    expect(store.getLanguage()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    unsubscribe();
  }
});

it.each(['fr', 'es', 'ar', 'ja', 'ko', 'zh-Hant'])('restores saved %s across module reloads', async language => {
  vi.resetModules();
  localStorage.setItem('nowly.language', language);
  expect((await import('./store')).getLanguage()).toBe(language);
});

it('ignores a corrupt saved value and detects Traditional Chinese from the system', async () => {
  vi.resetModules();
  localStorage.setItem('nowly.language', 'not-a-language');
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-HK' });
  expect((await import('./store')).getLanguage()).toBe('zh-Hant');
});

it('can initialize when storage access is unavailable', async () => {
  vi.resetModules();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect((await import('./store')).getLanguage()).toBe('zh');
});
