import { getLanguage, getLocale, t } from '../i18n';
export function alarmWeekdayText(weekday: number) {
  if (getLanguage() === 'zh') return ['一', '二', '三', '四', '五', '六', '日'][weekday - 1];
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(new Date(2026, 0, 4 + weekday));
}
export function alarmText(key: 'create' | 'done' | 'saving' | 'unsaved' | 'defaultTitle') {
  return t(`time.alarm.${key}`);
}
