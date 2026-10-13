export type ClockMode = 'digital' | 'analog' | 'mixed';
export type ClockLayout = 'horizontal' | 'stacked';
export type ClockFontMode = 'auto' | 'manual';

export type WorldClock = {
  id: string;
  timeZone: string;
  label: string;
};

export type ClockAppearance = {
  mode: ClockMode;
  hourCycle: 'h12' | 'h23';
  showSeconds: boolean;
  showLabel: boolean;
  showDate: boolean;
  showDifference: boolean;
  layout: ClockLayout;
  fontMode: ClockFontMode;
  fontSize: number;
};

export type AlarmRepeat =
  | { kind: 'once'; date: string }
  | { kind: 'weekly'; weekdays: number[] };

export type Alarm = {
  id: string;
  title: string;
  hour: number;
  minute: number;
  repeat: AlarmRepeat;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlarmDraft = Omit<Alarm, 'id' | 'createdAt' | 'updatedAt'>;

export type TimeSettings = {
  displayContent: 'clocks' | 'focus';
  appearance: ClockAppearance;
  focusPreferences: { defaultMinutes: number };
  clocks: WorldClock[];
};

export type AlarmNotice = {
  id: string;
  kind: 'alarm' | 'missedSummary';
  title: string;
  dueAt: string;
  alarmId: string | null;
  count: number;
  rangeStart: string;
  rangeEnd: string;
};

export type TimeRepository = {
  getTimeSettings(): Promise<TimeSettings>;
  saveTimeSettings(settings: TimeSettings): Promise<TimeSettings>;
  listAlarms(): Promise<Alarm[]>;
  createAlarm(draft: AlarmDraft): Promise<Alarm>;
  updateAlarm(id: string, draft: AlarmDraft): Promise<Alarm>;
  deleteAlarm(id: string): Promise<void>;
};

export const defaultWorldClock = (): WorldClock => ({
  id: 'local',
  timeZone: 'local',
  label: timeLocalLabel()
});

export const defaultClockAppearance = (): ClockAppearance => ({
  mode: 'digital',
  hourCycle: 'h23',
  showSeconds: false,
  showLabel: false,
  showDate: false,
  showDifference: false,
  layout: 'horizontal',
  fontMode: 'auto',
  fontSize: 96
});

export const defaultTimeSettings = (): TimeSettings => ({
  displayContent: 'clocks',
  appearance: defaultClockAppearance(),
  focusPreferences: { defaultMinutes: 25 },
  clocks: [defaultWorldClock()]
});

export function normalizeTimeSettings(value: TimeSettings | null | undefined): TimeSettings {
  const clocks = Array.isArray(value?.clocks) ? value.clocks.filter(Boolean) : [];
  const appearance = value?.appearance ?? defaultClockAppearance();
  const minutes = value?.focusPreferences?.defaultMinutes;
  return {
    displayContent: value?.displayContent === 'focus' ? 'focus' : 'clocks',
    focusPreferences: { defaultMinutes: typeof minutes === 'number' && Number.isFinite(minutes) ? Math.min(720, Math.max(1, Math.round(minutes))) : 25 },
    appearance: {
      ...defaultClockAppearance(),
      ...appearance,
      layout: appearance.layout === 'stacked' ? 'stacked' : 'horizontal',
      fontMode: appearance.fontMode === 'manual' ? 'manual' : 'auto',
      fontSize: clampFontSize(appearance.fontSize)
    },
    clocks: (clocks.length ? clocks : [defaultWorldClock()]).map((clock, index) => ({
      id: clock.id || `clock-${index + 1}`,
      timeZone: clock.timeZone || 'local',
      label: normalizeClockLabel(clock.label, clock.timeZone)
    }))
  };
}

function clampFontSize(value: unknown) {
  const size = typeof value === 'number' && Number.isFinite(value) ? value : 96;
  return Math.min(160, Math.max(32, Math.round(size)));
}

function normalizeClockLabel(label: string, timeZone: string) {
  if (timeZone === 'local' && (!label || label === '本地' || label === 'Local')) return timeLocalLabel();
  return label || timeZone;
}

export function alarmToDraft(alarm: Alarm): AlarmDraft {
  return {
    title: alarm.title,
    hour: alarm.hour,
    minute: alarm.minute,
    repeat: alarm.repeat,
    enabled: alarm.enabled
  };
}
import { timeLocalLabel } from './time-translations';
