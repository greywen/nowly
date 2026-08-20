import { BarChart3, Bell, Pause, Pencil, Play, RotateCcw, Timer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../i18n';
import { useFocusTimer } from './FocusTimerContext';

const PRESETS = [25, 15, 5];

function format(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Today's accumulated focus, shown in the widget header. Under an hour it stays
// in minutes; past that it splits into hours and minutes. A zero total reads as
// a gentle "not yet" nudge rather than a bare 0m.
function formatTodayFocus(totalSeconds: number, translate: (key: string, params?: Record<string, string | number>) => string) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  if (minutes <= 0) return translate('focusTimer.todayFocusNone');
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return translate('focusTimer.todayFocusMinutes', { minutes });
  return translate('focusTimer.todayFocusHours', { hours, minutes: minutes % 60 });
}

type Tone = 'primary' | 'paused' | 'done';

// Circular countdown ring — the heart of a pomodoro timer. It shows the share
// of the session still remaining and redraws in discrete one-second steps
// (driven by re-render, never a CSS transition), keeping it compliant with the
// no-animation rule in design.md. The clock and label sit calmly in the middle
// with generous breathing room; the ring, not the digits, carries the scale.
function FocusRing({ fraction, tone, children }: { fraction: number; tone: Tone; children: React.ReactNode }) {
  const center = 60;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = circumference * (1 - clamped);
  const toneClass = tone === 'paused' ? ' is-paused' : tone === 'done' ? ' is-done' : '';
  return (
    <div className="focus-timer__ring-wrap">
      <div className="focus-timer__ring-box">
        <svg className="focus-timer__ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="focus-timer__ring-track" cx={center} cy={center} r={radius} />
          <circle
            className={`focus-timer__ring-progress${toneClass}`}
            cx={center}
            cy={center}
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        </svg>
        <div className="focus-timer__ring-center">{children}</div>
      </div>
    </div>
  );
}

type Props = { mode: 'foreground' | 'wallpaper'; onOpenStatistics: () => void; onEnterWallpaper?: () => void };

export function FocusTimerWidget({ mode, onOpenStatistics, onEnterWallpaper }: Props) {
  const { t } = useTranslation();
  const timer = useFocusTimer();
  const [minutes, setMinutes] = useState(timer.state.plannedSeconds / 60);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  // Remember the most recent custom duration so it stays available as a preset
  // chip, sparing the user from reopening the input to reuse it.
  const [lastCustom, setLastCustom] = useState<number | null>(null);
  const [autoWallpaper, setAutoWallpaper] = useState(false);

  const customValue = Number(custom);
  const customValid = Number.isInteger(customValue) && customValue >= 1 && customValue <= 720;
  const running = timer.state.status === 'running';
  const paused = timer.state.status === 'paused';
  const completed = timer.state.status === 'completed';
  const active = running || paused;
  // The remembered custom value only earns a chip when it is not already one of
  // the fixed presets, so the row never shows duplicates.
  const customChip = lastCustom !== null && !PRESETS.includes(lastCustom) ? lastCustom : null;
  const durations = customChip === null ? PRESETS : [...PRESETS, customChip];
  const isCustomDuration = !PRESETS.includes(minutes) && minutes !== customChip;
  const unit = t('focusTimer.preset25').replace('25 ', '');
  // While a session is active the display counts down; when idle it previews the
  // currently selected duration so presets and custom values give real feedback.
  const displaySeconds = active ? timer.remainingSeconds : minutes * 60;
  const totalSeconds = active ? timer.state.plannedSeconds : minutes * 60;
  const fraction = totalSeconds > 0 ? Math.max(0, Math.min(1, displaySeconds / totalSeconds)) : 0;
  const tone: Tone = paused ? 'paused' : completed ? 'done' : 'primary';
  const labelTone = paused ? ' is-paused' : completed ? ' is-done' : '';
  const hintText = running
    ? t('focusTimer.runningHint')
    : paused
      ? t('focusTimer.pausedHint')
      : completed
        ? t('focusTimer.done')
        : t('focusTimer.idleHint');

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
    if (!PRESETS.includes(customValue)) setLastCustom(customValue);
    setCustom('');
    setCustomOpen(false);
  }

  function startFocus() {
    void timer.start(minutes);
    if (autoWallpaper) onEnterWallpaper?.();
  }

  return (
    <div className="widget-content focus-timer">
      <div className="card-header focus-timer__header">
        <div className="focus-timer__today">
          <span className="focus-timer__today-label">{t('focusTimer.todayFocusLabel')}</span>
          <span className="focus-timer__today-value">{formatTodayFocus(timer.todayFocusedSeconds, t)}</span>
        </div>
        <button className="btn btn-icon" aria-label={t('focusTimer.statistics')} onClick={onOpenStatistics}>
          <BarChart3 aria-hidden="true" />
        </button>
      </div>
      <div className="panel-body focus-timer__body">
        <FocusRing fraction={fraction} tone={tone}>
          <p className={`focus-timer__label${labelTone}`}>{t('focusTimer.title')}</p>
          <p className="focus-timer__display" role="timer">{format(displaySeconds)}</p>
          <p className={`focus-timer__status${labelTone}`}><Bell aria-hidden="true" /><span>{hintText}</span></p>
        </FocusRing>

        <div className="focus-timer__actions">
          {!active ? (
            <button className="btn btn-primary focus-timer__start" aria-label={t('focusTimer.startFocus')} onClick={startFocus}>
              <Play aria-hidden="true" />{t('focusTimer.startFocus')}
            </button>
          ) : (
            <button className="btn btn-primary focus-timer__start" onClick={() => void (running ? timer.pause() : timer.resume())}>
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {running ? t('focusTimer.pause') : t('focusTimer.resume')}
            </button>
          )}
          <button className="btn btn-icon focus-timer__reset" aria-label={t('focusTimer.reset')} disabled={!active} onClick={() => void timer.interrupt()}>
            <RotateCcw aria-hidden="true" />
          </button>
        </div>

        {!active && customOpen && (
          <div className="focus-timer__custom">
            <input
              className="focus-timer__custom-input"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('focusTimer.customMinutes')}
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

        {!active && (
          <label className="focus-timer__auto form-check form-check-custom form-check-solid">
            <input className="form-check-input" type="checkbox" checked={autoWallpaper} onChange={event => setAutoWallpaper(event.target.checked)} />
            <span className="form-check-label">{t('focusTimer.autoWallpaper')}</span>
          </label>
        )}
      </div>

      {!active && (
        <div className="focus-timer__footer" role="group" aria-label={t('focusTimer.selectDuration')}>
          {durations.map(value => {
            const selected = !isCustomDuration && minutes === value;
            return (
              <button
                key={value}
                className={`focus-timer__duration${selected ? ' is-active' : ''}`}
                aria-pressed={selected}
                onClick={() => { setMinutes(value); setCustomOpen(false); }}
              ><Timer aria-hidden="true" /><span>{value} {unit}</span></button>
            );
          })}
          <button
            className={`focus-timer__duration focus-timer__duration--custom${isCustomDuration || customOpen ? ' is-active' : ''}`}
            aria-pressed={isCustomDuration || customOpen}
            onClick={() => setCustomOpen(open => !open)}
          ><Pencil aria-hidden="true" /><span>{t('focusTimer.custom')}</span></button>
        </div>
      )}
    </div>
  );
}
