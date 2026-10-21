import { getLocale, t } from '../i18n';
import { timeBarTranslations } from '../i18n/time-catalog';

export { timeBarTranslations } from '../i18n/time-catalog';


export function timeBarText(key: keyof typeof timeBarTranslations.en, params: Record<string, string | number> = {}): string {
  return t(key, params);
}

export function alarmLocalTime(value: string, includeDate = false): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(getLocale(), {
    calendar: 'gregory', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    ...(includeDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } as const : {})
  }).format(date);
}
