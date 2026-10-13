import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { getLanguage, useTranslation } from '../i18n';
import { Bell, Plus, Settings } from '../components/icons';
import { computeClockLayout, computeDigitalFontSize, type ClockLayout } from './clock-layout';
import { ClockFace } from './ClockFace';
import { normalizeTimeSettings, type Alarm, type TimeSettings, type WorldClock } from './time-model';
import { formatClockDate, formatClockTime, formatDifference, primaryModeForClocks } from './time-format';
import { tt, timeLocalLabel } from './time-translations';
import { useTimeSettings } from './useTimeSettings';
import { useTimeSnapshot } from './useTimeSnapshot';
import './time.css';

type TimeWidgetProps = {
  onOpenSettings?: () => void;
  onCreateAlarm?: () => void;
  settings?: TimeSettings;
  now?: () => Date;
};

const DEFAULT_SIZE = { width: 360, height: 220 };

export function TimeWidget({ settings: providedSettings, now, onOpenSettings, onCreateAlarm }: TimeWidgetProps) {
  const { t } = useTranslation();
  const { repository, state } = useTimeSettings();
  const settings = providedSettings ? normalizeTimeSettings(providedSettings) : state.data;
  const [size, setSize] = useState(DEFAULT_SIZE);
  const rootRef = useRef<HTMLDivElement>(null);
  const snapshot = useTimeSnapshot(now);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    const load = () => {
      const request = ++version;
      void repository?.listAlarms().then((loaded) => { if (!cancelled && request === version) setAlarms(loaded); }).catch(() => { if (!cancelled && request === version) setAlarms([]); });
    };
    load();
    window.addEventListener('nowly:alarms-changed', load);
    const interval = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.removeEventListener('nowly:alarms-changed', load); window.clearInterval(interval); };
  }, [repository]);
  const nextAlarm = earliestAlarm(alarms, snapshot);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width || DEFAULT_SIZE.width, height: rect.height || DEFAULT_SIZE.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const mode = primaryModeForClocks(settings.clocks);
  const layout = useMemo(
    () => computeClockLayout({ width: size.width, height: Math.max(1, size.height - (nextAlarm ? 48 : 0)), count: settings.clocks.length, mode, formats: settings.clocks }),
    [mode, settings.clocks, size.height, size.width, Boolean(nextAlarm)]
  );

  return (
    <div className="widget-content time-widget-content" data-testid="time-widget" data-clock-count={settings.clocks.length} data-layout-columns={layout.columns} data-layout-scroll={layout.scroll ? 'true' : 'false'}>
      <div className="card-header">
        <div className="heading-group"><h1>{t('widget.time.name')}</h1></div>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-icon" aria-label={tt('time.title')} disabled={!onOpenSettings} onClick={onOpenSettings}>
            <Settings aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" aria-label={tt('time.alarms.add')} disabled={!onCreateAlarm} onClick={onCreateAlarm}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>
    <section
      ref={rootRef}
      className={`time-widget${layout.scroll ? ' time-widget--scroll' : ''}`}
      aria-label={t('widget.time.name')}
      data-testid="time-widget-body"
      data-clock-count={settings.clocks.length}
      data-layout-columns={layout.columns}
      data-layout-scroll={layout.scroll ? 'true' : 'false'}
    >
      {nextAlarm ? <div className="time-widget__alarm" data-testid="time-widget-alarm" aria-label={`${nextAlarm.alarm.title} ${formatAlarmDate(nextAlarm.date)}`}><Bell aria-hidden="true" /><span>{nextAlarm.alarm.title || tt('time.tabs.alarms')} · {formatAlarmDate(nextAlarm.date)}</span></div> : null}
      <div
        className="time-widget__grid"
        data-testid="time-widget-grid"
        style={{
          '--time-columns': String(layout.columns),
          '--time-font-size': `${layout.fontSize}rem`,
          '--time-row-min-height': `${layout.rowMinHeight}px`,
          '--time-cell-min-width': `${layout.minCellWidth}px`
        } as CSSProperties}
      >
        {settings.clocks.map((clock) => (
          <ClockTile key={clock.id} clock={clock} now={snapshot} layout={layout} size={{ ...size, height: Math.max(1, size.height - (nextAlarm ? 48 : 0)), count: settings.clocks.length }} />
        ))}
      </div>
    </section>
    </div>
  );
}

function ClockTile({ clock, now, layout, size }: { clock: WorldClock; now: Date; layout: ClockLayout; size: { width: number; height: number; count: number } }) {
  const label = displayClockLabel(clock);
  const time = formatClockTime(now, clock.timeZone, clock);
  const showFace = clock.mode !== 'digital';
  const showTime = clock.mode !== 'analog';
  const optionalVisible = layout.showOptionalInfo;
  const digitalLayout = clock.layout ?? 'horizontal';
  const cellWidth = (size.width - (layout.columns - 1) * 12) / layout.columns;
  const rows = Math.ceil(size.count / layout.columns);
  const cellHeight = Math.max(layout.rowMinHeight, (size.height - (rows - 1) * 12) / rows);
  const metadataRows = Number(digitalLayout === 'date' || (optionalVisible && clock.showDate)) + Number(optionalVisible && clock.showDifference);
  const fontSize = computeDigitalFontSize(cellWidth, cellHeight - (clock.showLabel ? 28 : 0) - metadataRows * 28, time, clock, digitalLayout);

  return (
    <article
      className={`time-clock time-clock--${clock.mode} time-clock--${digitalLayout}`}
      aria-label={`${label} ${time}`}
      data-testid="time-clock"
      data-clock-id={clock.id}
      data-clock-mode={clock.mode}
      data-clock-layout={digitalLayout}
      style={clock.mode === 'digital' ? { '--time-font-size': `${fontSize}rem` } as CSSProperties : undefined}
      data-time-zone={clock.timeZone}
      data-show-label={clock.showLabel ? 'true' : 'false'}
      data-show-date={clock.showDate ? 'true' : 'false'}
      data-show-difference={clock.showDifference ? 'true' : 'false'}
    >
      {clock.showLabel ? <div className="time-clock__label">{label}</div> : null}
      {showFace ? <ClockFace now={now} timeZone={clock.timeZone} label={label} showSeconds={clock.showSeconds} size={layout.faceSize} /> : null}
      {showTime ? <div className="time-clock__time" data-testid="time-clock-digital">{clock.mode === 'digital' && digitalLayout === 'stacked' ? time.split(':').map((part, index) => <span key={index}>{part}</span>) : time}</div> : null}
      {((clock.mode === 'digital' && digitalLayout === 'date') || (optionalVisible && clock.showDate)) ? <div className="time-clock__meta">{formatClockDate(now, clock.timeZone)}</div> : null}
      {optionalVisible && clock.showDifference ? <div className="time-clock__meta">{formatDifference(now, clock.timeZone)}</div> : null}
    </article>
  );
}

function displayClockLabel(clock: WorldClock) {
  if (clock.timeZone === 'local' && (!clock.label || clock.label === '本地' || clock.label === 'Local')) return timeLocalLabel();
  return clock.label || clock.timeZone;
}

function formatAlarmDate(date: Date) {
  return new Intl.DateTimeFormat(getLanguage() === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
function earliestAlarm(alarms: Alarm[], now: Date) {
  const candidates = alarms.filter((alarm) => alarm.enabled).flatMap((alarm) => {
    if (alarm.repeat.kind === 'once') {
      const date = new Date(alarm.repeat.date + 'T' + String(alarm.hour).padStart(2, '0') + ':' + String(alarm.minute).padStart(2, '0') + ':00');
      return Number.isFinite(date.getTime()) && date > now ? [{ alarm, date }] : [];
    }
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(alarm.hour, alarm.minute, 0, 0);
      if (date > now && alarm.repeat.weekdays.includes(date.getDay() || 7)) return [{ alarm, date }];
    }
    return [];
  });
  return candidates.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
}
