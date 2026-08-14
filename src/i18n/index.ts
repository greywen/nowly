import { useSyncExternalStore } from 'react';
import { getLanguage, setLanguage, subscribe, type Language } from './store';
import { translations } from './translations';

export type { Language } from './store';
export { SUPPORTED_LANGUAGES, getLanguage, setLanguage, normalizeLanguage } from './store';

type Params = Record<string, string | number>;

// Pick the CLDR plural category (e.g. "one", "other") for a count in the active
// language, so English templates can render "1 task" vs "2 tasks" correctly.
// Chinese only has "other", so its templates never need plural branches.
function pluralCategory(count: number, language: Language): string {
  try {
    return new Intl.PluralRules(language === 'zh' ? 'zh' : 'en').select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

// Resolve one `{count, plural, one {...} other {...}}` block. Supports exact
// matches (`=0 {...}`) taking precedence over category matches, and replaces `#`
// inside the chosen branch with the count value.
function resolvePlural(count: number, branchesSource: string, language: Language): string {
  const branches: Record<string, string> = {};
  let index = 0;
  while (index < branchesSource.length) {
    // Read a selector token (e.g. "one", "other", "=0") up to its `{`.
    while (index < branchesSource.length && /\s/.test(branchesSource[index])) index += 1;
    const braceStart = branchesSource.indexOf('{', index);
    if (braceStart === -1) break;
    const selector = branchesSource.slice(index, braceStart).trim();
    // Find the matching `}` for this branch, accounting for nesting.
    let depth = 0;
    let cursor = braceStart;
    for (; cursor < branchesSource.length; cursor += 1) {
      const char = branchesSource[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    branches[selector] = branchesSource.slice(braceStart + 1, cursor);
    index = cursor + 1;
  }
  const exact = branches[`=${count}`];
  const chosen = exact ?? branches[pluralCategory(count, language)] ?? branches.other ?? '';
  return chosen.replace(/#/g, String(count));
}

function interpolate(template: string, params?: Params, language: Language = getLanguage()): string {
  let result = template;
  // First expand any plural blocks, then simple `{placeholder}` values. Plural
  // branches may themselves contain `{placeholder}` tokens, so run the simple
  // pass afterwards to fill those in too.
  if (result.includes(', plural,')) {
    result = result.replace(
      /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
      (match, key: string, branches: string) => {
        const value = params?.[key];
        if (typeof value !== 'number') return match;
        return resolvePlural(value, branches, language);
      }
    );
  }
  if (!params) return result;
  return result.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match
  );
}

// Translate a key for the current language, with optional `{placeholder}`
// interpolation. Falls back to the other language, then the raw key, so a
// missing string never renders blank.
export function translate(key: string, params?: Params): string {
  const language = getLanguage();
  const table = translations[language];
  const template = table[key] ?? translations.en[key] ?? translations.zh[key] ?? key;
  return interpolate(template, params, language);
}

// Alias used across pure helpers where no React subscription is needed.
export const t = translate;

// React hook: subscribes to language changes so the component re-renders and
// its `t()` calls pick up the new strings. Returns the translate function, the
// active language, and a setter for switching languages in real time.
export function useTranslation() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t: translate, language, setLanguage } as { t: typeof translate; language: Language; setLanguage: typeof setLanguage };
}
