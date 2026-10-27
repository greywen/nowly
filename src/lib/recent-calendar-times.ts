const STORAGE_KEY = 'nowly-calendar-recent-times-v1';
export const DEFAULT_QUICK_TIMES = ['09:00', '09:30', '12:00', '14:00', '15:00', '18:00'];
const LIMIT = 6;
const isTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function readRecentTimes(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter(isTime))].slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function calendarQuickTimes(): string[] {
  return [...new Set([...readRecentTimes(), ...DEFAULT_QUICK_TIMES])].slice(0, LIMIT);
}

export function rememberCalendarTime(time: string): void {
  if (!isTime(time)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([time, ...readRecentTimes().filter(value => value !== time)].slice(0, LIMIT)));
  } catch {
    // Optional preferences must not prevent selecting an event time.
  }
}
