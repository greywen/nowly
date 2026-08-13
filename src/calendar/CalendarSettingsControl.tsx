import { Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Select } from '../components/Select';
import type { AppSettings } from '../data/nowly-repository';

export type CalendarSettings = Pick<AppSettings, 'weekStart' | 'dateFormat' | 'showWeekends'>;

type Props = {
  settings: CalendarSettings;
  onChange: (settings: CalendarSettings) => void;
};

// Calendar-scoped preferences (week start, date format, weekend visibility)
// live directly on the calendar as a settings-icon popover instead of the
// global settings dialog, so they sit next to the view they affect. Changes
// persist immediately through onChange; there is no separate save step.
export function CalendarSettingsControl({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="calendar-settings-control">
      <button
        type="button"
        className={`btn btn-icon${open ? ' is-active' : ''}`}
        aria-label="日历设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings aria-hidden="true" />
      </button>
      {open ? (
        <div className="calendar-settings-popup" role="dialog" aria-label="日历设置">
          <Select
            id="calendar-week-start"
            label="每周开始日"
            value={settings.weekStart}
            options={[{ value: 'monday', label: '周一' }, { value: 'sunday', label: '周日' }]}
            onChange={(value) => onChange({ ...settings, weekStart: value as AppSettings['weekStart'] })}
          />
          <Select
            id="calendar-date-format"
            label="日期格式"
            value={settings.dateFormat}
            options={[{ value: 'localized', label: '本地格式' }, { value: 'iso', label: 'ISO 格式' }]}
            onChange={(value) => onChange({ ...settings, dateFormat: value as AppSettings['dateFormat'] })}
          />
          <label className="form-check form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="checkbox"
              checked={settings.showWeekends}
              onChange={(event) => onChange({ ...settings, showWeekends: event.target.checked })}
            />
            <span className="form-check-label">显示周末</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
