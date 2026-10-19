import { BarChart3, Clock3, Settings, Timer } from '../components/icons';
import { useTranslation } from '../i18n';
import { FocusTimerWidget } from '../focus/FocusTimerWidget';
import { useFocusTimer } from '../focus/FocusTimerContext';
import { TimeWidget } from './TimeWidget';
import { useTimeSettings } from './useTimeSettings';
import { tt } from './time-translations';

type Props = {
  mode: 'foreground' | 'wallpaper';
  onOpenSettings: () => void;
  onOpenStatistics: () => void;
  onEnterWallpaper?: () => void;
};

export function TimeModule({ mode, onOpenSettings, onOpenStatistics, onEnterWallpaper }: Props) {
  const { t } = useTranslation();
  const { state, load, save } = useTimeSettings();
  const timer = useFocusTimer();
  const ready = state.status === 'ready';
  const showFocus = state.data.displayContent === 'focus' && !(mode === 'wallpaper' && timer.state.status === 'idle');
  function selectDisplay(value: 'clocks' | 'focus') {
    if (!ready || state.data.displayContent === value) return;
    save({ ...state.data, displayContent: value });
  }
  const active = timer.state.status === 'running' || timer.state.status === 'paused';
  const remaining = `${String(Math.floor(timer.remainingSeconds / 60)).padStart(2, '0')}:${String(timer.remainingSeconds % 60).padStart(2, '0')}`;
  return <div className="widget-content time-module" data-testid="time-module" data-display-content={state.data.displayContent}>
    <div className="card-header">
      <div className="heading-group"><h1>{t('widget.time.name')}</h1></div>
      <div className="toolbar-actions">
        <div className="view-switch" role="group" aria-label={tt('time.display.switch')}>
          <button type="button" className={`view-switch__btn view-switch__btn--icon${!showFocus ? ' is-active' : ''}`} aria-label={tt('time.tabs.clocks')} title={tt('time.tabs.clocks')} aria-pressed={!showFocus} disabled={!ready} onClick={() => selectDisplay('clocks')}><Clock3 aria-hidden="true" /></button>
          <button type="button" className={`view-switch__btn view-switch__btn--icon${showFocus ? ' is-active' : ''}`} aria-label={tt('time.tabs.focus')} title={tt('time.tabs.focus')} aria-pressed={showFocus} disabled={!ready} onClick={() => selectDisplay('focus')}><Timer aria-hidden="true" /></button>
        </div>
        {showFocus ? <button type="button" className="btn" onClick={onOpenStatistics}><BarChart3 aria-hidden="true" />{tt('time.focus.statistics')}</button> : null}
        <button type="button" className="btn btn-icon" aria-label={tt('time.title')} onClick={onOpenSettings}><Settings aria-hidden="true" /></button>
      </div>
    </div>
    {state.status === 'loading' ? <p className="time-muted">{tt('time.loading')}</p> : null}
    {state.status === 'error' ? <div className="time-load-error"><p role="alert" className="time-error">{state.error || tt('time.loadError')}</p><button type="button" className="time-action-button" onClick={() => void load()}>{tt('time.retry')}</button></div> : null}
    <div className="time-module__content" hidden={showFocus}><TimeWidget settings={state.data} embedded /></div>
    <div className="time-module__content" hidden={!showFocus}>
      <FocusTimerWidget mode={mode} embedded defaultMinutes={state.data.focusPreferences.defaultMinutes} onOpenStatistics={onOpenStatistics} onEnterWallpaper={onEnterWallpaper} />
    </div>
    {!showFocus && active ? <div className="time-module__focus-status">
      <span>{tt(timer.state.status === 'running' ? 'time.focus.running' : 'time.focus.paused', { remaining })}</span>
      <button type="button" className="time-action-button" onClick={() => selectDisplay('focus')}>{tt('time.focus.showFocus')}</button>
    </div> : null}
  </div>;
}
