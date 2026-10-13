import type { ClockMode, WorldClock } from './time-model';
import { timeLocalLabel } from './time-translations';

export type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type TimeFormatterKey = `${string}|${'h23' | 'h12'}|${boolean}`;

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const displayFormatterCache = new Map<TimeFormatterKey, Intl.DateTimeFormat>();

export const COMMON_TIME_ZONES = [
  { value: 'local', label: 'local' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: '上海 / 北京' },
  { value: 'Asia/Tokyo', label: '东京' },
  { value: 'Asia/Singapore', label: '新加坡' },
  { value: 'Asia/Kathmandu', label: '加德满都' },
  { value: 'Europe/London', label: '伦敦' },
  { value: 'Europe/Paris', label: '巴黎' },
  { value: 'America/New_York', label: '纽约' },
  { value: 'America/Los_Angeles', label: '洛杉矶' },
  { value: 'Australia/Sydney', label: '悉尼' }
] as const;

export type TimeZoneOption = { value: string; label: string };

export function timeZoneOptions(selectedZone?: string): TimeZoneOption[] {
  const base = buildTimeZoneOptions();
  if (!selectedZone || selectedZone === 'local' || base.some((option) => option.value === selectedZone)) return base;
  return [...base, { value: selectedZone, label: selectedZone }];
}

function buildTimeZoneOptions(): TimeZoneOption[] {
  const aliases = new Map<string, string>(COMMON_TIME_ZONES.map((zone) => [zone.value, zone.value === 'local' ? timeLocalLabel() : zone.label]));
  const intlWithValues = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const supported = typeof intlWithValues.supportedValuesOf === 'function'
    ? intlWithValues.supportedValuesOf('timeZone')
    : COMMON_TIME_ZONES.map((zone) => zone.value).filter((zone) => zone !== 'local');
  const merged = new Set<string>(['local', ...COMMON_TIME_ZONES.map((zone) => zone.value), ...supported]);
  return Array.from(merged)
    .filter((zone) => zone === 'local' || isValidTimeZone(zone))
    .map((zone) => ({
      value: zone,
      label: aliases.get(zone) ?? zone.split('_').join(' ')
    }))
    .sort((a, b) => (a.value === 'local' ? -1 : b.value === 'local' ? 1 : a.label.localeCompare(b.label)));
}

export function resolveTimeZone(zone: string): string {
  return zone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    getPartsFormatter(resolveTimeZone(zone));
    return true;
  } catch {
    return false;
  }
}

function getPartsFormatter(zone: string) {
  const resolved = resolveTimeZone(zone);
  const cached = partsFormatterCache.get(resolved);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolved,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  formatter.format(new Date('2026-01-01T00:00:00Z'));
  partsFormatterCache.set(resolved, formatter);
  return formatter;
}

function getDisplayFormatter(zone: string, hourCycle: 'h23' | 'h12', showSeconds: boolean) {
  const resolved = resolveTimeZone(zone);
  const key: TimeFormatterKey = `${resolved}|${hourCycle}|${showSeconds}`;
  const cached = displayFormatterCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolved,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle,
    hour: 'numeric',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined
  });
  displayFormatterCache.set(key, formatter);
  return formatter;
}

export function clockParts(now: Date, zone: string): ClockParts {
  let entries: Record<string, number>;
  try {
    entries = Object.fromEntries(
      getPartsFormatter(zone).formatToParts(now).flatMap((part) =>
        part.type === 'literal' ? [] : [[part.type, Number(part.value)]]
      )
    );
  } catch (error) {
    throw new RangeError(`Invalid time zone: ${zone}`);
  }
  return {
    year: entries.year,
    month: entries.month,
    day: entries.day,
    hour: entries.hour,
    minute: entries.minute,
    second: entries.second
  };
}

export function formatClockTime(
  now: Date,
  zone: string,
  options: Pick<WorldClock, 'hourCycle' | 'showSeconds'>
) {
  return getDisplayFormatter(zone, options.hourCycle, options.showSeconds).format(now);
}

export function formatClockDate(now: Date, zone: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: resolveTimeZone(zone),
    calendar: 'gregory',
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(now);
}

export function analogAngles(parts: Pick<ClockParts, 'hour' | 'minute' | 'second'>) {
  return {
    hour: ((parts.hour % 12) + parts.minute / 60) * 30,
    minute: (parts.minute + parts.second / 60) * 6,
    second: parts.second * 6
  };
}

export function formatOffset(now: Date, zone: string) {
  const resolved = resolveTimeZone(zone);
  const parts = clockParts(now, resolved);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMinutes = Math.round((asUtc - now.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

export function formatDifference(now: Date, zone: string, baseZone = 'local') {
  const currentOffset = offsetMinutes(now, zone);
  const baseOffset = offsetMinutes(now, baseZone);
  const diff = currentOffset - baseOffset;
  if (diff === 0) return '同本地';
  const sign = diff > 0 ? '+' : '-';
  const absolute = Math.abs(diff);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0 ? `${sign}${hours} 小时` : `${sign}${hours}小时${minutes}分`;
}

function offsetMinutes(now: Date, zone: string) {
  const parts = clockParts(now, zone);
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - now.getTime()) / 60_000);
}

export function primaryModeForClocks(clocks: readonly Pick<WorldClock, 'mode'>[]): ClockMode {
  return clocks.some((clock) => clock.mode === 'mixed')
    ? 'mixed'
    : clocks.some((clock) => clock.mode === 'analog')
      ? 'analog'
      : 'digital';
}
