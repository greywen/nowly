import { BarChart3, Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../i18n';
import { useFocusTimer } from './FocusTimerContext';

const PRESETS = [25, 15, 5];

function format(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

type Props = { mode: 'foreground' | 'wallpaper'; onOpenStatistics: () => void; onEnterWallpaper?: () => void };

export function FocusTimerWidget({ mode, onOpenStatistics, onEnterWallpaper }: Props) {
  const { t } = useTranslation();
  const timer = useFocusTimer();
  const [minutes, setMinutes] = useState(timer.state.plannedSeconds / 60);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [autoWallpaper, setAutoWallpaper] = useState(false);

  const customValue = Number(custom);
  const customValid = Number.isInteger(customValue) && customValue >= 1 && customValue <= 720;
  const running = timer.state.status === 'running';
  const paused = timer.state.status === 'paused';
  const active = running || paused;
  const isCustomDuration = !PRESETS.includes(minutes);
  const unit = t('focusTimer.preset25').replace('25 ', '');
  // While a session is active the display counts down; when idle it previews the
  // currently selected duration so presets and custom values give real feedback.
  const displaySeconds = active ? timer.remainingSeconds : minutes * 60;

  if (mode === 'wallpaper') {
    return (
      <div className="widget-content focus-timer focus-timer--wallpaper">
        <div className="panel-body focus-timer__body">
          <p className="focus-timer__display" role="timer">{format(displaySeconds)}</p>
          <p className="focus-timer__hint">{t('focusTimer.wallpaperHint')}</p>
        </div>
      </div>
    );
  }

  function applyCustom() {
    if (!customValid) return;
    setMinutes(customValue);
    setCustomOpen(false);
  }

  function startFocus() {
    void timer.start(minutes);
    if (autoWallpaper) onEnterWallpaper?.();
  }

  return (
    <div className="widget-content focus-timer">
      <div className="card-header focus-timer__header">
        <button className="btn btn-icon" aria-label={t('focusTimer.statistics')} onClick={onOpenStatistics}>
          <BarChart3 aria-hidden="true" />
        </button>
      </div>
      <div className="panel-body focus-timer__body">
        <div className="focus-timer__clock">
          <p className="focus-timer__display" role="timer">{format(displaySeconds)}</p>
          <p className="focus-timer__hint">
            {running ? t('focusTimer.runningHint') : paused ? t('focusTimer.pausedHint') : t('focusTimer.idleHint')}
          </p>
        </div>

        {!active && (
          <div className="focus-timer__controls">
            <div className="focus-timer__presets" role="group" aria-label={t('focusTimer.selectDuration')}>
              {PRESETS.map(value => {
                const selected = !isCustomDuration && minutes === value;
                return (
                  <button
                    key={value}
                    className={`btn focus-timer__preset${selected ? ' is-active' : ''}`}
                    aria-pressed={selected}
                    onClick={() => { setMinutes(value); setCustomOpen(false); }}
                  >{value} {unit}</button>
                );
              })}
              <button
                className={`btn focus-timer__preset${isCustomDuration || customOpen ? ' is-active' : ''}`}
                aria-pressed={isCustomDuration || customOpen}
                onClick={() => setCustomOpen(open => !open)}
              >{t('focusTimer.custom')}</button>
            </div>

            {customOpen && (
              <div className="focus-timer__custom">
                <label htmlFor="focus-custom-minutes">{t('focusTimer.customMinutes')}</label>
                <input
                  id="focus-custom-minutes"
                  className="focus-timer__custom-input"
                  inputMode="numeric"
                  value={custom}
                  placeholder={String(minutes)}
                  onChange={event => setCustom(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') applyCustom(); }}
                />
                <button className="btn btn-primary focus-timer__custom-apply" disabled={!customValid} onClick={applyCustom}>
                  {t('focusTimer.useDuration')}
                </button>
                {custom && !customValid ? <span role="alert">{t('focusTimer.customError')}</span> : null}
              </div>
            )}
          </div>
        )}

        <div className="focus-timer__actions">
          {!active ? (
            <button className="btn btn-primary" aria-label={t('focusTimer.startFocus')} onClick={startFocus}>
              <Play aria-hidden="true" />{t('focusTimer.startFocus')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void (running ? timer.pause() : timer.resume())}>
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {running ? t('focusTimer.pause') : t('focusTimer.resume')}
            </button>
          )}
          <button className="btn btn-icon" aria-label={t('focusTimer.reset')} disabled={!active} onClick={() => void timer.interrupt()}>
            <RotateCcw aria-hidden="true" />
          </button>
        </div>

        {!active && (
          <label className="focus-timer__auto">
            <input type="checkbox" checked={autoWallpaper} onChange={event => setAutoWallpaper(event.target.checked)} />
            {t('focusTimer.autoWallpaper')}
          </label>
        )}
      </div>
    </div>
  );
}
