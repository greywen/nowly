// Language store: the single source of truth for the active UI language.
//
// It lives at module scope (not just in React state) so pure helpers — date
// formatters, label lookups, validation messages — can read the current
// language synchronously via `getLanguage()` without threading it through every
// call. React components subscribe through `useTranslation` (which wraps
// `subscribe`) so a language switch re-renders the whole tree and every `t()`
// call picks up the new strings. The choice persists to localStorage so it
// survives reloads; the very first run falls back to the system language.

export type Language = 'zh' | 'en';

export const SUPPORTED_LANGUAGES: Language[] = ['zh', 'en'];
const STORAGE_KEY = 'nowly.language';

function isLanguage(value: unknown): value is Language {
  return value === 'zh' || value === 'en';
}

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

function readInitial(): Language {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (isLanguage(stored)) return stored;
  } catch {
    // Ignore storage access errors (private mode, disabled storage) and fall
    // back to system detection.
  }
  return detectSystemLanguage();
}

let current: Language = readInitial();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Persisting is best-effort; the in-memory value still drives the UI.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
