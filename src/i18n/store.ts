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
// the Windows UI language (the primary browser language on web), falling back
// to English when it is unavailable or unsupported.

import { LOCALES, matchLanguage, normalizeLanguage, SUPPORTED_LANGUAGES, type Language } from './locales';
export { normalizeLanguage, SUPPORTED_LANGUAGES };
export type { Language };

const LANGUAGE_STORAGE_KEY = 'nowly.language';

function detectSystemLanguage(): Language {
  // The native shell injects this before any app script in every window,
  // avoiding WebView language preferences and an asynchronous language flash.
  if (typeof window !== 'undefined' && '__NOWLY_SYSTEM_LANGUAGE__' in window) {
    return normalizeLanguage(window.__NOWLY_SYSTEM_LANGUAGE__);
  }
  return normalizeLanguage(typeof navigator === 'undefined' ? null : navigator.language);
}

// Read a persisted choice, ignoring anything unrecognized (or storage errors in
// restricted environments) so a bad value can never wedge startup.
function readSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved ? matchLanguage(saved) : null;
  } catch {
    return null;
  }
}

let current: Language = readSavedLanguage() ?? detectSystemLanguage();
const listeners = new Set<() => void>();

function updateDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LOCALES[current].lang;
  document.documentElement.dir = LOCALES[current].dir;
}

updateDocumentLanguage();

function handleStorageChange(event: StorageEvent): void {
  if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== localStorage) return;
  const next = event.newValue === null ? detectSystemLanguage() : normalizeLanguage(event.newValue);
  if (next === current) return;
  current = next;
  updateDocumentLanguage();
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageChange);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  if (!SUPPORTED_LANGUAGES.includes(next)) return;
  const changed = next !== current;
  current = next;
  updateDocumentLanguage();
  // Persistence never blocks the UI: save best-effort, then notify subscribers.
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    // Ignore storage failures (private mode, quota); the in-memory value still
    // drives this session.
  }
  if (changed) for (const listener of listeners) listener();
}

export function getLocale(): string {
  return LOCALES[current].locale;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
