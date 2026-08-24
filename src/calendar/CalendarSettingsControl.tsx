import { Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Select } from '../components/Select';
import type { AppSettings } from '../data/nowly-repository';
import { t } from '../i18n';

export type CalendarSettings = Pick<AppSettings, 'weekStart' | 'dateFormat' | 'showWeekends'>;

type Props = {
  settings: CalendarSettings;
  onChange: (settings: CalendarSettings) => void;
  onOpenSubscriptions?: () => void;
};

// Calendar-scoped preferences (week start, date format, weekend visibility)
// live directly on the calendar as a settings-icon popover instead of the
// global settings dialog, so they sit next to the view they affect. Changes
// persist immediately through onChange; there is no separate save step.
export function CalendarSettingsControl({ settings, onChange, onOpenSubscriptions }: Props) {
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
        aria-label={t('calendarSettings.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings aria-hidden="true" />
      </button>
      {open ? (
        <div className="calendar-settings-popup" role="dialog" aria-label={t('calendarSettings.label')}>
          <Select
            id="calendar-week-start"
            label={t('calendarSettings.weekStart')}
            value={settings.weekStart}
            options={[{ value: 'monday', label: t('calendarSettings.monday') }, { value: 'sunday', label: t('calendarSettings.sunday') }]}
            onChange={(value) => onChange({ ...settings, weekStart: value as AppSettings['weekStart'] })}
          />
          <Select
            id="calendar-date-format"
            label={t('calendarSettings.dateFormat')}
            value={settings.dateFormat}
            options={[{ value: 'localized', label: t('calendarSettings.localized') }, { value: 'iso', label: t('calendarSettings.iso') }]}
            onChange={(value) => onChange({ ...settings, dateFormat: value as AppSettings['dateFormat'] })}
          />
          <label className="form-check form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="checkbox"
              checked={settings.showWeekends}
              onChange={(event) => onChange({ ...settings, showWeekends: event.target.checked })}
            />
            <span className="form-check-label">{t('calendarSettings.showWeekends')}</span>
          </label>
          {onOpenSubscriptions ? (
            <div className="calendar-settings-popup__section">
              <span className="calendar-settings-popup__section-title">{t('settings.calendarSubscriptions')}</span>
              <button
                type="button"
                className="good-button"
                onClick={() => {
                  setOpen(false);
                  onOpenSubscriptions();
                }}
              >
                {t('settings.manageSubscriptions')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
