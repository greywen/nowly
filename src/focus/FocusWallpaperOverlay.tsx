import type { CSSProperties } from 'react';
import { useTranslation } from '../i18n';
import { useFocusTimer } from './FocusTimerContext';

function format(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function lerp(from: number, to: number, ratio: number) {
  return Math.round(from + (to - from) * ratio);
}

// The glow reacts to how close the session is to finishing: as progress goes
// from 0 to 1 it breathes faster, swings wider/brighter, and shifts from the
// brand cyan toward a warm amber. Values are injected as CSS variables so the
// keyframes stay declarative and honour prefers-reduced-motion.
function glowStyle(progress: number): CSSProperties {
  const cyan = [79, 201, 218];
  const warm = [240, 150, 60];
  const rgb = `${lerp(cyan[0], warm[0], progress)},${lerp(cyan[1], warm[1], progress)},${lerp(cyan[2], warm[2], progress)}`;
  return {
    '--focus-glow-rgb': rgb,
    '--focus-glow-duration': `${(6 - 4 * progress).toFixed(2)}s`,
    '--focus-glow-scale-min': (0.9 - 0.08 * progress).toFixed(3),
    '--focus-glow-scale-max': (1.12 + 0.16 * progress).toFixed(3),
    '--focus-glow-opacity-min': (0.65 + 0.15 * progress).toFixed(3)
  } as CSSProperties;
}

// Fullscreen countdown shown while the app runs as the wallpaper during a focus
// session. It is read-only: double-clicking anywhere returns to the foreground,
// handled by DesktopShell. All state changes are immediate per design.md.
export function FocusWallpaperOverlay() {
  const { t } = useTranslation();
  const timer = useFocusTimer();
  const { status } = timer.state;
  const active = status === 'running' || status === 'paused' || status === 'completed';
  if (!active) return null;

  const planned = timer.state.plannedSeconds || 1;
  const progress = Math.min(1, Math.max(0, 1 - timer.remainingSeconds / planned));

  const label =
    status === 'completed'
      ? t('focusTimer.done')
      : status === 'paused'
        ? t('focusTimer.pausedHint')
        : t('focusTimer.runningHint');

  return (
    <section className="focus-fullscreen" aria-label={t('focusTimer.fullscreen')}>
      <div className="focus-fullscreen__background" aria-hidden="true">
        <span className="focus-fullscreen__shape focus-fullscreen__shape--cyan" />
        <span className="focus-fullscreen__shape focus-fullscreen__shape--ring" />
        <span className="focus-fullscreen__shape focus-fullscreen__shape--amber" />
      </div>
      <div className="focus-fullscreen__center">
        <span className="focus-fullscreen__glow" aria-hidden="true" style={glowStyle(progress)} />
        <p className="focus-fullscreen__display" role="timer">{format(timer.remainingSeconds)}</p>
        <p className="focus-fullscreen__status" aria-live="polite">{label}</p>
        <p className="focus-fullscreen__hint">{t('focusTimer.wallpaperHint')}</p>
      </div>
    </section>
  );
}
