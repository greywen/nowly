import { getLanguage } from './store';
import { translations } from './translations';
import { nativeErrorTranslations } from './native-errors';

const knownCodes = new Set(['conflict', 'not_found', 'validation_error', 'database_error', 'system_error']);

// UI boundaries must not render arbitrary IPC strings or JS exception details.
// Domain-specific code mappings (e.g. pin limits) remain with their callers.
export function localizedRepositoryErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)
    || typeof error.code !== 'string' || !knownCodes.has(error.code)) return null;
  const localized = localizeRepositoryError(error);
  return localized && typeof localized === 'object' && 'message' in localized
    && typeof localized.message === 'string' && localized.message
    ? localized.message : null;
}

// Only the native structured-error contract is translated: strings, arbitrary
// exceptions and user-authored content must not be interpreted as UI messages.
export function localizeRepositoryError(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return error;
  if (typeof error.code !== 'string' || !knownCodes.has(error.code) || typeof error.message !== 'string') return error;

  const language = getLanguage();
  const fallbackKey = `nativeError.${error.code}`;
  if (language === 'zh') {
    // Chinese native messages carry intentional, specific guidance. Only the
    // two fixed English messages from CommandError::{database,system} are safe
    // to replace in this locale.
    if (!['database_error', 'system_error'].includes(error.code)
      || error.message !== nativeErrorTranslations.en[fallbackKey]) return error;
  } else if (Object.values(translations[language]).includes(error.message)
    || Object.values(nativeErrorTranslations[language]).includes(error.message)) {
    // Browser-backed IPC can already reject with a localized message.
    return error;
  }

  let message = nativeErrorTranslations[language][fallbackKey];
  if (language !== 'zh') {
    for (const source of [translations.zh, translations.en]) {
      const match = Object.entries(source).find(([, value]) => value === error.message);
      const localized = match && translations[language][match[0]];
      if (localized) {
        message = localized;
        break;
      }
    }
  }
  if (message === error.message) return error;
  // Native errors are plain objects, but a wrapper may use an Error instance.
  // Preserve stack/cause, symbols, prototype and other non-enumerable metadata.
  const descriptors = Object.getOwnPropertyDescriptors(error);
  if (error instanceof Error) {
    // V8's stack accessor needs the original Error's internal slots.
    descriptors.stack = { value: error.stack, enumerable: false, writable: true, configurable: true };
  }
  descriptors.message = {
    value: message,
    enumerable: descriptors.message?.enumerable ?? true,
    writable: true,
    configurable: true,
  };
  // Retain the first diagnostic even if the error crosses this boundary twice.
  if (!('originalMessage' in error)) {
    descriptors.originalMessage = { value: error.message, enumerable: true, writable: true, configurable: true };
  }
  return Object.create(Object.getPrototypeOf(error), descriptors);
}
