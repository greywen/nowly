import { useEffect, useRef, useState } from 'react';
import { Crop, type AppIcon } from '../../components/icons';
import { findBarApp, type BarAppId } from '../bar-buttons';
import { t } from '../../i18n';

// The app buttons that sit to the right of the Nowly logo. One component renders
// them for the live bar and for the settings preview, so the two can never drift
// apart. The lane owns no geometry: the shell's width (design.md §8.3) makes the
// room, and each button fills one 48px slot.

// One icon per catalogued app. Kept next to the rendering rather than in the
// registry so the registry stays free of view concerns; a missing entry is a type
// error, not a blank button.
const ICONS: Record<BarAppId, AppIcon> = { screenshot: Crop };

export function barAppIcon(id: BarAppId): AppIcon {
  return ICONS[id];
}

export function barAppLabel(id: BarAppId): string {
  const app = findBarApp(id);
  return app ? t(app.labelKey) : id;
}

/** design.md §12.3: the shell grows in 280ms and shrinks in 220ms. */
const GROW_MS = 280;
const SHRINK_MS = 220;

/**
 * Reports whether the lane just gained or lost a button, so the shell tweens its
 * width only for a real configuration change. Null on mount and once the tween is
 * over, so nothing animates itself into existence or keeps a stale duration.
 */
export function useBarButtonLaneAnim(count: number): 'grow' | 'shrink' | null {
  const previous = useRef(count);
  const [anim, setAnim] = useState<'grow' | 'shrink' | null>(null);
  useEffect(() => {
    if (previous.current === count) return;
    const direction = count > previous.current ? 'grow' : 'shrink';
    previous.current = count;
    setAnim(direction);
    const timer = setTimeout(
      () => setAnim(null),
      direction === 'grow' ? GROW_MS : SHRINK_MS
    );
    return () => clearTimeout(timer);
  }, [count]);
  return anim;
}

export function BarButtonLane({
  buttons,
  available,
  errors,
  pending,
  onActivate
}: {
  buttons: readonly BarAppId[];
  /** False while a panel is open or morphing: the lane is fading out. */
  available: boolean;
  /**
   * Per-button failure text. Reported in place on the button that failed rather
   * than as a toast, per design.md §11's Error state.
   */
  errors?: Partial<Record<BarAppId, string>>;
  pending?: Partial<Record<BarAppId, boolean>>;
  onActivate: (id: BarAppId) => void;
}) {
  return (
    <>
      {buttons.map((id, index) => {
        const Icon = barAppIcon(id);
        const label = barAppLabel(id);
        const error = errors?.[id];
        const busy = pending?.[id] === true;
        return (
          <button
            key={id}
            type="button"
            className="status-rail__app-button"
            // The lane is ordered left to right after the logo. Index drives the
            // offset so a removal slides the remaining buttons rightwards into
            // the shell's new edge rather than leaving a hole.
            style={{ '--app-slot': index } as React.CSSProperties}
            data-available={available}
            data-app={id}
            {...(error ? { 'data-error': true } : {})}
            aria-label={error ? `${label}：${error}` : label}
            title={error ? `${label}：${error}` : label}
            disabled={busy}
            aria-busy={busy}
            {...(!available ? { 'aria-hidden': true, tabIndex: -1 } : {})}
            onClick={() => onActivate(id)}
          >
            {error ? (
              <span className="status-rail__app-retry" aria-hidden="true">{t('common.retry')}</span>
            ) : (
              <Icon aria-hidden="true" size={24} />
            )}
          </button>
        );
      })}
    </>
  );
}
