import { afterEach, describe, expect, it } from 'vitest';
import { normalizeLanguage, setLanguage, getLanguage, SUPPORTED_LANGUAGES } from './store';
import { translations } from './translations';

const languages = ['zh', 'en', 'fr', 'es', 'ar', 'ja', 'ko', 'zh-Hant'] as const;
afterEach(() => setLanguage('zh'));

describe('eight-language support', () => {
  it('registers every supported language', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(languages);
  });
  it.each([
    ['fr-CA', 'fr'], ['es-MX', 'es'], ['ar-SA', 'ar'], ['ja-JP', 'ja'],
    ['ko-KR', 'ko'], ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'], ['zh-Hant-CN', 'zh-Hant'], ['zh-Hans-HK', 'zh'],
    ['zh-SG', 'zh'], ['zh_CN', 'zh'], [' FR-fr ', 'fr'], ['unknown', 'en']
  ])('normalizes %s to %s', (tag, expected) => {
    expect(normalizeLanguage(tag)).toBe(expected);
  });
  it.each(languages)('persists and synchronizes %s with document metadata', language => {
    setLanguage(language as Parameters<typeof setLanguage>[0]);
    expect(getLanguage()).toBe(language);
    expect(localStorage.getItem('nowly.language')).toBe(language);
    expect(document.documentElement.lang).toBe(language === 'zh' ? 'zh-Hans' : language);
    expect(document.documentElement.dir).toBe(language === 'ar' ? 'rtl' : 'ltr');
  });
  it('receives Arabic from another window and restores LTR after switching', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'ar' }));
    expect(getLanguage()).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    setLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
  it.each(languages)('%s contains all base keys and simple placeholders', language => {
    const dictionary = (translations as Record<string, Record<string, string>>)[language] ?? {};
    const keys = Object.keys(translations.en);
    expect(keys.filter(key => !dictionary[key]?.trim())).toEqual([]);
    const params = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?:\}|,\s*plural,)/g)].map(match => match[1]))].sort();
    for (const key of keys) expect(params(dictionary[key]), key).toEqual(params(translations.en[key]));
  });
});
