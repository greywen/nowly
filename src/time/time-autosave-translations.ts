import { t } from '../i18n';

type AutosaveKey = 'saving' | 'idle' | 'error';
export function autosaveText(key: AutosaveKey) {
  return t(`time.autosave.${key}`);
}
