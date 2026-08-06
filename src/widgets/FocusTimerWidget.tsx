import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useModuleState, type ModuleHost } from './extension-module';

const PRESETS = [
  { label: '25 分钟', minutes: 25 },
  { label: '15 分钟', minutes: 15 },
  { label: '5 分钟', minutes: 5 }
];

function format(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Simple Pomodoro-style focus timer. No CSS animation — the countdown updates
// on a plain interval and all state changes are instant per design.md. The
// chosen preset is persisted through the module host so it survives restarts.
export function FocusTimerWidget({ host }: { host: ModuleHost }) {
  const [durationMinutes, setDurationMinutes] = useModuleState(host, 25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Keep the idle countdown in step with the persisted preset (also covers the
  // moment the stored value loads in).
  useEffect(() => {
    if (!running) setRemaining(durationMinutes * 60);
    // Only when the preset itself changes, not on every running toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMinutes]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          setRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [running]);

  function selectPreset(minutes: number) {
    setRunning(false);
    setDurationMinutes(minutes);
    setRemaining(minutes * 60);
  }

  function reset() {
    setRunning(false);
    setRemaining(durationMinutes * 60);
  }

  const done = remaining === 0;

  return (
    <div className="widget-content focus-timer">
      <div className="card-header">
        <div className="heading-group">
          <h2>专注计时</h2>
        </div>
      </div>
      <div className="panel-body focus-timer__body">
        <p className="focus-timer__display" aria-live="polite">
          {format(remaining)}
        </p>
        <p className="focus-timer__hint">{done ? '专注完成，休息一下吧' : '保持专注，减少切换'}</p>
        <div className="focus-timer__presets" role="group" aria-label="选择专注时长">
          {PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className={`btn focus-timer__preset${durationMinutes === preset.minutes ? ' is-active' : ''}`}
              aria-pressed={durationMinutes === preset.minutes}
              onClick={() => selectPreset(preset.minutes)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="focus-timer__actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-label={running ? '暂停' : '开始'}
            disabled={done}
            onClick={() => setRunning((current) => !current)}
          >
            {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {running ? '暂停' : '开始'}
          </button>
          <button type="button" className="btn" aria-label="重置计时" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
