import { getLanguage, type Language } from '../i18n';

type AutosaveKey = 'saving' | 'idle' | 'error';
const messages: Record<Language, Record<AutosaveKey, string>> = {
  zh: { saving: '自动保存中…', idle: '修改立即生效并自动保存', error: '未保存' },
  en: { saving: 'Saving automatically…', idle: 'Changes apply immediately and save automatically', error: 'Not saved' }
};
export function autosaveText(key: AutosaveKey) {
  return messages[getLanguage()][key];
}
