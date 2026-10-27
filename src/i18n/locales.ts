export const SUPPORTED_LANGUAGES = ['zh', 'en', 'fr', 'es', 'ja', 'ko', 'zh-Hant'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export const LOCALES: Record<Language, { name: string; locale: string; lang: string }> = {
  zh: { name: '简体中文', locale: 'zh-CN', lang: 'zh-Hans' },
  en: { name: 'English', locale: 'en-US', lang: 'en' },
  fr: { name: 'Français', locale: 'fr-FR', lang: 'fr' },
  es: { name: 'Español', locale: 'es-ES', lang: 'es' },
  ja: { name: '日本語', locale: 'ja-JP', lang: 'ja' },
  ko: { name: '한국어', locale: 'ko-KR', lang: 'ko' },
  'zh-Hant': { name: '繁體中文', locale: 'zh-TW', lang: 'zh-Hant' }
};

export function matchLanguage(tag: string | undefined | null): Language | null {
  const parts = tag?.trim().replace(/_/g, '-').toLowerCase().split('-');
  if (!parts?.[0]) return null;
  if (parts[0] === 'zh') {
    if (parts.includes('hans')) return 'zh';
    if (parts.includes('hant') || parts.some(part => ['tw', 'hk', 'mo'].includes(part))) return 'zh-Hant';
    return 'zh';
  }
  return SUPPORTED_LANGUAGES.find(language => language === parts[0]) ?? null;
}

export function normalizeLanguage(tag: string | undefined | null): Language {
  return matchLanguage(tag) ?? 'en';
}
