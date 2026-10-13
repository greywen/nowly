import { getLanguage } from '../i18n';

export const timeBarTranslations = {
  zh: {
    'timeBar.alarm': '闹钟',
    'timeBar.missedSummary': '错过的闹钟',
    'timeBar.missedCount': '错过 {count} 次闹钟',
    'timeBar.dueAt': '闹钟 · {time}',
    'timeBar.acknowledge': '确认',
    'timeBar.snooze': '稍后 5 分钟',
    'timeBar.actionFailed': '闹钟操作失败，请重试'
  },
  en: {
    'timeBar.alarm': 'Alarm',
    'timeBar.missedSummary': 'Missed alarms',
    'timeBar.missedCount': '{count} missed alarms',
    'timeBar.dueAt': 'Alarm · {time}',
    'timeBar.acknowledge': 'Acknowledge',
    'timeBar.snooze': 'Snooze 5 minutes',
    'timeBar.actionFailed': 'Alarm action failed. Please retry.'
  }
};

export function timeBarText(key: keyof typeof timeBarTranslations.en, params: Record<string, string | number> = {}): string {
  const table = getLanguage() === 'zh' ? timeBarTranslations.zh : timeBarTranslations.en;
  return table[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}

export function alarmLocalTime(value: string, includeDate = false): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return includeDate ? `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}` : time;
}
