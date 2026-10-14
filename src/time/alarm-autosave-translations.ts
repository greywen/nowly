import { getLanguage } from '../i18n';

const messages = {
  zh: { create: '创建闹钟', done: '结束编辑', saving: '自动保存中…', unsaved: '未保存', defaultTitle: '闹钟' },
  en: { create: 'Create alarm', done: 'End editing', saving: 'Autosaving…', unsaved: 'Not saved', defaultTitle: 'Alarm' }
};
const weekdayLabels = {
  zh: ['一', '二', '三', '四', '五', '六', '日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
};
export function alarmWeekdayText(weekday: number) {
  return (weekdayLabels[getLanguage()] ?? weekdayLabels.en)[weekday - 1];
}
export function alarmText(key: keyof typeof messages.en) {
  return (messages[getLanguage()] ?? messages.en)[key];
}
