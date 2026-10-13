import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { ChevronDown, ChevronUp, Plus, Trash2 } from '../components/icons';
import { isValidTimeZone, timeZoneOptions } from './time-format';
import { defaultWorldClock, type ClockFontMode, type ClockLayout, type ClockMode, type TimeSettings, type WorldClock } from './time-model';
import { tt } from './time-translations';
import { appearanceText } from './time-appearance-translations';

type Props = { settings: TimeSettings; onChange: (settings: TimeSettings) => void };

function layoutOptions() { return [
  { value: 'horizontal', label: appearanceText('layout.horizontal') },
  { value: 'stacked', label: appearanceText('layout.stacked') },
  { value: 'date', label: appearanceText('layout.date') }
]; }
function fontModeOptions() { return [
  { value: 'auto', label: appearanceText('fontMode.auto') },
  { value: 'manual', label: appearanceText('fontMode.manual') }
]; }

export function WorldClockSettings({ settings, onChange }: Props) {
  const modeOptions = [
    { value: 'digital', label: tt('time.mode.digital') },
    { value: 'analog', label: tt('time.mode.analog') },
    { value: 'mixed', label: tt('time.mode.mixed') }
  ];
  const hourCycleOptions = [
    { value: 'h23', label: tt('time.hourCycle.h23') },
    { value: 'h12', label: tt('time.hourCycle.h12') }
  ];
  function updateClock(id: string, patch: Partial<WorldClock>) {
    onChange({ clocks: settings.clocks.map((clock) => (clock.id === id ? { ...clock, ...patch } : clock)) });
  }
  function addClock() {
    onChange({ clocks: [...settings.clocks, { ...defaultWorldClock(), id: `clock-${Date.now()}`, label: appearanceText('newClock'), timeZone: 'UTC', showLabel: true }] });
  }
  function removeClock(id: string) {
    if (settings.clocks.length > 1) onChange({ clocks: settings.clocks.filter((clock) => clock.id !== id) });
  }
  function moveClock(id: string, offset: number) {
    const index = settings.clocks.findIndex((clock) => clock.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= settings.clocks.length) return;
    const next = [...settings.clocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ clocks: next });
  }
  return <div className="time-settings-section">
    <button type="button" className="time-action-button" onClick={addClock}><Plus aria-hidden="true" />{tt('time.clocks.add')}</button>
    <div className="time-clock-settings-list">
      {settings.clocks.map((clock, index) => {
        const invalid = !isValidTimeZone(clock.timeZone);
        return <section className="time-clock-settings-card" key={clock.id}>
          <div className="time-clock-settings-card__header"><strong>{clock.label || clock.timeZone}</strong><div className="time-clock-settings-card__actions">
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.moveUp', { label: clock.label || clock.timeZone })} disabled={index === 0} onClick={() => moveClock(clock.id, -1)}><ChevronUp aria-hidden="true" /></button>
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.moveDown', { label: clock.label || clock.timeZone })} disabled={index === settings.clocks.length - 1} onClick={() => moveClock(clock.id, 1)}><ChevronDown aria-hidden="true" /></button>
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.delete', { label: clock.label || clock.timeZone })} disabled={settings.clocks.length <= 1} onClick={() => removeClock(clock.id)}><Trash2 aria-hidden="true" /></button>
          </div></div>
          <div className="time-settings-group"><div className="time-settings-group__title">{appearanceText('appearance')}</div><div className="time-settings-grid">
            <Field label={tt('time.clocks.label')} value={clock.label} onChange={(label) => updateClock(clock.id, { label })} />
            <Select id={`time-zone-${clock.id}`} label={tt('time.clocks.zone')} searchable value={clock.timeZone} options={timeZoneOptions(clock.timeZone)} onChange={(timeZone) => updateClock(clock.id, { timeZone })} />
            <Select id={`time-mode-${clock.id}`} label={tt('time.clocks.mode')} value={clock.mode} options={modeOptions} onChange={(mode) => updateClock(clock.id, { mode: mode as ClockMode })} />
            <Select id={`time-layout-${clock.id}`} label={appearanceText('layout')} value={clock.layout ?? 'horizontal'} options={layoutOptions()} onChange={(layout) => updateClock(clock.id, { layout: layout as ClockLayout })} />
            <Select id={`time-font-mode-${clock.id}`} label={appearanceText('fontMode')} value={clock.fontMode ?? 'auto'} options={fontModeOptions()} onChange={(fontMode) => updateClock(clock.id, { fontMode: fontMode as ClockFontMode })} />
            {(clock.fontMode ?? 'auto') === 'manual' ? <label className="time-field"><span>{appearanceText('fontSize')}: {clock.fontSize ?? 96}px</span><Slider label={appearanceText('fontSize')} valueText={`${clock.fontSize ?? 96}px`} min={32} max={160} step={1} value={clock.fontSize ?? 96} onChange={(fontSize) => updateClock(clock.id, { fontSize })} /></label> : null}
          </div></div>
          <details className="time-settings-details"><summary>{appearanceText('details')}</summary><div className="time-settings-grid"><Select id={`time-hour-cycle-${clock.id}`} label={tt('time.clocks.hourCycle')} value={clock.hourCycle} options={hourCycleOptions} onChange={(hourCycle) => updateClock(clock.id, { hourCycle: hourCycle as WorldClock['hourCycle'] })} /></div><div className="time-check-grid"><Check label={tt('time.clocks.seconds')} checked={clock.showSeconds} onChange={(showSeconds) => updateClock(clock.id, { showSeconds })} /><Check label={tt('time.clocks.showLabel')} checked={clock.showLabel} onChange={(showLabel) => updateClock(clock.id, { showLabel })} /><Check label={tt('time.clocks.showDate')} checked={clock.showDate} onChange={(showDate) => updateClock(clock.id, { showDate })} /><Check label={tt('time.clocks.showDifference')} checked={clock.showDifference} onChange={(showDifference) => updateClock(clock.id, { showDifference })} /></div></details>
          {invalid ? <p className="time-error">{appearanceText('invalidZone')}: {clock.timeZone}</p> : null}
        </section>;
      })}
    </div>
  </div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="time-field"><span>{label}</span><input className="good-input" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="form-check-label">{label}</span></label>; }
