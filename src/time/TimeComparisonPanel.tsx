import { useMemo, useState } from 'react';
import { clockParts, formatClockTime, formatOffset } from './time-format';
import type { TimeSettings } from './time-model';
import { tt } from './time-translations';

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TimeComparisonPanel({ settings, now = () => new Date() }: { settings: TimeSettings; now?: () => Date }) {
  const [value, setValue] = useState(() => toLocalInput(now()));
  const instant = useMemo(() => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [value]);

  return (
    <div className="time-settings-section">
      <div className="time-comparison-inputs">
        <label className="time-field">
          <span>{tt('time.compare.localInput')}</span>
          <input className="good-input" type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button type="button" className="time-action-button" onClick={() => setValue(toLocalInput(now()))}>{tt('time.compare.now')}</button>
      </div>
      {instant ? (
        <div className="time-comparison-list">
          {settings.clocks.map((clock) => {
            const parts = clockParts(instant, clock.timeZone);
            const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
            return (
              <article className="time-comparison-row" key={clock.id}>
                <strong>{clock.label || clock.timeZone}</strong>
                <span>{formatClockTime(instant, clock.timeZone, { hourCycle: clock.hourCycle, showSeconds: false })}</span>
                <small>{date} · {formatOffset(instant, clock.timeZone)}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="time-error">{tt('time.compare.invalid')}</p>
      )}
    </div>
  );
}
