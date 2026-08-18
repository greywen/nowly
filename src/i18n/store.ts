// Language store: the single source of truth for the active UI language.
//
// It lives at module scope (not just in React state) so pure helpers — date
// formatters, label lookups, validation messages — can read the current
// language synchronously via `getLanguage()` without threading it through every
// call. React components subscribe through `useTranslation` (which wraps
// `subscribe`) so a language switch re-renders the whole tree and every `t()`
// call picks up the new strings. On startup we prefer a previously saved
// choice (persisted in localStorage, mirroring `useBlur`/`useOnboarding`) so a
// manual switch survives reloads and restarts; with no saved choice we follow
// the system language, falling back to English for anything we do not localize.

export type Language = 'zh' | 'en';

const LANGUAGE_STORAGE_KEY = 'nowly.language';

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

// Read a persisted choice, ignoring anything unrecognized (or storage errors in
// restricted environments) so a bad value can never wedge startup.
function readSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'zh' || saved === 'en' ? saved : null;
  } catch {
    return null;
  }
}

let current: Language = readSavedLanguage() ?? detectSystemLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (next === current) return;
  current = next;
  // Persistence never blocks the UI: save best-effort, then notify subscribers.
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    // Ignore storage failures (private mode, quota); the in-memory value still
    // drives this session.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
