import { Select } from '../components/Select';
import { Slider } from '../components/Slider';
import { ChevronDown, ChevronUp, Plus, Trash2 } from '../components/icons';
import { isValidTimeZone, timeZoneOptions } from './time-format';
import { defaultWorldClock, type ClockAppearance, type TimeSettings, type WorldClock } from './time-model';
import { tt } from './time-translations';
import { appearanceText } from './time-appearance-translations';

type Props = { settings: TimeSettings; onChange: (settings: TimeSettings) => void };

export function WorldClockSettings({ settings, onChange }: Props) {
  const appearance = settings.appearance;
  function updateAppearance(patch: Partial<ClockAppearance>) {
    onChange({ ...settings, appearance: { ...appearance, ...patch } });
  }
  function updateClock(id: string, patch: Partial<WorldClock>) {
    onChange({ ...settings, clocks: settings.clocks.map(clock => clock.id === id ? { ...clock, ...patch } : clock) });
  }
  function moveClock(id: string, offset: number) {
    const index = settings.clocks.findIndex(clock => clock.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= settings.clocks.length) return;
    const clocks = [...settings.clocks];
    [clocks[index], clocks[target]] = [clocks[target], clocks[index]];
    onChange({ ...settings, clocks });
  }
  return <div className="time-settings-section">
    <section className="time-settings-group">
      <h4 className="time-settings-group__title">{tt('time.appearance.title')}</h4>
      <p className="time-muted">{tt('time.appearance.hint')}</p>
      <div className="time-settings-grid time-settings-grid--appearance">
        <Select id="time-mode" label={tt('time.clocks.mode')} value={appearance.mode}
          options={[{ value: 'digital', label: tt('time.mode.digital') }, { value: 'analog', label: tt('time.mode.analog') }, { value: 'mixed', label: tt('time.mode.mixed') }]}
          onChange={mode => { if (mode === 'digital' || mode === 'analog' || mode === 'mixed') updateAppearance({ mode }); }} />
        <Select id="time-layout" label={appearanceText('layout')} value={appearance.layout} disabled={appearance.mode === 'analog'}
          options={[{ value: 'horizontal', label: appearanceText('layout.horizontal') }, { value: 'stacked', label: appearanceText('layout.stacked') }]}
          onChange={layout => { if (layout === 'horizontal' || layout === 'stacked') updateAppearance({ layout }); }} />
        <Select id="time-hour-cycle" label={tt('time.clocks.hourCycle')} value={appearance.hourCycle}
          options={[{ value: 'h23', label: tt('time.hourCycle.h23') }, { value: 'h12', label: tt('time.hourCycle.h12') }]}
          onChange={hourCycle => { if (hourCycle === 'h23' || hourCycle === 'h12') updateAppearance({ hourCycle }); }} />
      </div>
      <div className="time-settings-font">
      <Select id="time-font-mode" label={appearanceText('fontMode')} value={appearance.fontMode} disabled={appearance.mode === 'analog'}
        options={[{ value: 'auto', label: appearanceText('fontMode.auto') }, { value: 'manual', label: appearanceText('fontMode.manual') }]}
        onChange={fontMode => { if (fontMode === 'auto' || fontMode === 'manual') updateAppearance({ fontMode }); }} />
      {appearance.fontMode === 'manual' && appearance.mode !== 'analog' ? <div className="time-field">
        <span>{appearanceText('fontSize')}: {appearance.fontSize}px</span>
        <Slider label={appearanceText('fontSize')} valueText={`${appearance.fontSize}px`} min={32} max={160} step={1} value={appearance.fontSize} onChange={fontSize => updateAppearance({ fontSize })} />
      </div> : null}
      </div>
      <fieldset className="time-settings-checks">
        <legend>{tt('time.appearance.info')}</legend>
        <div className="time-check-grid">
          <Check label={tt('time.clocks.seconds')} checked={appearance.showSeconds} onChange={showSeconds => updateAppearance({ showSeconds })} />
          <Check label={tt('time.clocks.showLabel')} checked={appearance.showLabel} onChange={showLabel => updateAppearance({ showLabel })} />
          <Check label={tt('time.clocks.showDate')} checked={appearance.showDate} onChange={showDate => updateAppearance({ showDate })} />
          <Check label={tt('time.clocks.showDifference')} checked={appearance.showDifference} onChange={showDifference => updateAppearance({ showDifference })} />
        </div>
      </fieldset>
      <p className="time-muted">{tt('time.appearance.differenceHint')}</p>
    </section>
    <section className="time-settings-group time-settings-group--cities">
      <div className="time-clock-settings-card__header">
        <h4 className="time-settings-group__title">{tt('time.tabs.clocks')}</h4>
        <button type="button" className="time-action-button" onClick={() => onChange({ ...settings, clocks: [...settings.clocks, { ...defaultWorldClock(), id: crypto.randomUUID(), label: appearanceText('newClock'), timeZone: 'UTC' }] })}><Plus aria-hidden="true" />{tt('time.clocks.add')}</button>
      </div>
      <div className="time-clock-settings-list">
        {settings.clocks.map((clock, index) => <section className="time-clock-settings-card" key={clock.id}>
          <label className="time-field"><span>{tt('time.clocks.label')}</span><input className="good-input" value={clock.label} onChange={event => updateClock(clock.id, { label: event.target.value })} /></label>
          <Select id={`time-zone-${clock.id}`} label={tt('time.clocks.zone')} searchable value={clock.timeZone} options={timeZoneOptions(clock.timeZone)} onChange={timeZone => updateClock(clock.id, { timeZone })} />
          <div className="time-clock-settings-card__actions">
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.moveUp', { label: clock.label || clock.timeZone })} disabled={index === 0} onClick={() => moveClock(clock.id, -1)}><ChevronUp aria-hidden="true" /></button>
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.moveDown', { label: clock.label || clock.timeZone })} disabled={index === settings.clocks.length - 1} onClick={() => moveClock(clock.id, 1)}><ChevronDown aria-hidden="true" /></button>
            <button type="button" className="good-icon-button" aria-label={tt('time.clocks.delete', { label: clock.label || clock.timeZone })} disabled={settings.clocks.length <= 1} onClick={() => onChange({ ...settings, clocks: settings.clocks.filter(item => item.id !== clock.id) })}><Trash2 aria-hidden="true" /></button>
          </div>
          {!isValidTimeZone(clock.timeZone) ? <p className="time-error">{appearanceText('invalidZone')}: {clock.timeZone}</p> : null}
        </section>)}
      </div>
    </section>
  </div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="form-check-label">{label}</span></label>;
}
