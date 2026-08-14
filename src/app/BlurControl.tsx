import { Droplets } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_BLUR, MIN_BLUR } from './useBlur';
import { t } from '../i18n';

type Props = {
  blur: number;
  onChange: (blur: number) => void;
  // Fires when the popover opens or closes so the shell can show a live
  // preview of the blur while the slider is open, even in foreground mode.
  onOpenChange?: (open: boolean) => void;
};

// The slider stores blur in CSS pixels, but a raw pixel count is a poor way to
// describe "how frosted" the look is. Show it as a percentage of the maximum
// blur instead so the value reads as an intuitive 0–100% strength.
function toPercent(blur: number): number {
  return Math.round((blur / MAX_BLUR) * 100);
}

export function BlurControl({ blur, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const percent = toPercent(blur);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

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
    <div ref={rootRef} className="blur-control">
      <button
        type="button"
        className={`btn btn-icon${open ? ' is-active' : ''}`}
        aria-label={t('blur.adjust')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Droplets aria-hidden="true" />
      </button>
      {open ? (
        <div className="blur-popup" role="dialog" aria-label={t('blur.title')}>
          <div className="blur-popup__head">
            <span className="blur-popup__title">{t('blur.title')}</span>
            <span className="blur-popup__value" aria-live="polite">{percent}%</span>
          </div>
          <input
            className="blur-slider"
            type="range"
            min={MIN_BLUR}
            max={MAX_BLUR}
            step={1}
            value={blur}
            aria-label={t('blur.title')}
            aria-valuetext={`${percent}%`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <p className="blur-popup__hint">
            {t('blur.hint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
