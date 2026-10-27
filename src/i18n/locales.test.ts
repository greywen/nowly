import { afterEach, describe, expect, it } from 'vitest';
import { normalizeLanguage, setLanguage, getLanguage, SUPPORTED_LANGUAGES } from './store';
import { translations } from './translations';

const languages = ['zh', 'en', 'fr', 'es', 'ja', 'ko', 'zh-Hant'] as const;
afterEach(() => setLanguage('zh'));

describe('seven-language support', () => {
  it('registers every supported language', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(languages);
  });
  it.each([
    ['fr-CA', 'fr'], ['es-MX', 'es'], ['ja-JP', 'ja'],
    ['ko-KR', 'ko'], ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'], ['zh-Hant-CN', 'zh-Hant'], ['zh-Hans-HK', 'zh'],
    ['zh-SG', 'zh'], ['zh_CN', 'zh'], [' FR-fr ', 'fr'], ['ar-SA', 'en'], ['ar', 'en'], ['unknown', 'en']
  ])('normalizes %s to %s', (tag, expected) => {
    expect(normalizeLanguage(tag)).toBe(expected);
  });
  it.each(languages)('persists and synchronizes %s with document metadata', language => {
    setLanguage(language as Parameters<typeof setLanguage>[0]);
    expect(getLanguage()).toBe(language);
    expect(localStorage.getItem('nowly.language')).toBe(language);
    expect(document.documentElement.lang).toBe(language === 'zh' ? 'zh-Hans' : language);
  });
  it('receives a language from another window and updates the document language', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'ja' }));
    expect(getLanguage()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
  it('does not accept the removed Arabic language', () => {
    setLanguage('en');
    setLanguage('ar' as Parameters<typeof setLanguage>[0]);
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem('nowly.language')).toBe('en');
  });
  it.each(languages)('%s contains all base keys and simple placeholders', language => {
    const dictionary = (translations as Record<string, Record<string, string>>)[language] ?? {};
    const keys = Object.keys(translations.en);
    expect(keys.filter(key => !dictionary[key]?.trim())).toEqual([]);
    const params = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?:\}|,\s*plural,)/g)].map(match => match[1]))].sort();
    for (const key of keys) expect(params(dictionary[key]), key).toEqual(params(translations.en[key]));
  });
});
