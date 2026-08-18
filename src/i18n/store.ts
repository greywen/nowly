// Language store: the single source of truth for the active UI language.
//
// It lives at module scope (not just in React state) so pure helpers — date
// formatters, label lookups, validation messages — can read the current
// language synchronously via `getLanguage()` without threading it through every
// call. React components subscribe through `useTranslation` (which wraps
// `subscribe`) so a language switch re-renders the whole tree and every `t()`
// call picks up the new strings. The active language always follows the system
// language on startup — nothing is cached — so the app matches the OS locale
// every run, falling back to English for anything we do not localize yet.

export type Language = 'zh' | 'en';

export const SUPPORTED_LANGUAGES: Language[] = ['zh', 'en'];

// Map a BCP-47 tag (e.g. "zh-CN", "en-US") onto one of our supported
// languages, defaulting to English for anything we do not localize yet.
export function normalizeLanguage(tag: string | undefined | null): Language {
  if (!tag) return 'en';
  return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function detectSystemLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const candidate of candidates) {
    if (candidate) return normalizeLanguage(candidate);
  }
  return 'en';
}

let current: Language = detectSystemLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
