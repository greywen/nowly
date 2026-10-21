import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage, subscribe } from './store';

afterEach(() => setLanguage('zh'));

describe('language synchronization between windows', () => {
  it('updates screenshot and bar subscribers when another window changes language', () => {
    setLanguage('zh');
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'en' }));
      expect(getLanguage()).toBe('en');
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('falls back to English for an unsupported language from another window', () => {
    setLanguage('zh');
    window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'de' }));
    expect(getLanguage()).toBe('en');
  });

  it('ignores unrelated storage changes', () => {
    setLanguage('zh');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'en' }));
    expect(getLanguage()).toBe('zh');
  });
});
