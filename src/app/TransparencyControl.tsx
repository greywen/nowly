import { Blend } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_BLUR_RADIUS, MIN_BLUR_RADIUS } from './useTransparency';

type Props = {
  blurRadius: number;
  onChange: (blurRadius: number) => void;
  onOpenChange?: (open: boolean) => void;
};

export function TransparencyControl({ blurRadius, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <div ref={rootRef} className="transparency-control">
      <button
        type="button"
        className={`btn btn-icon${open ? ' is-active' : ''}`}
        aria-label="调整高斯模糊"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Blend aria-hidden="true" />
      </button>
      {open ? (
        <div className="transparency-popup" role="dialog" aria-label="高斯模糊">
          <div className="transparency-popup__head">
            <span className="transparency-popup__title">高斯模糊</span>
            <span className="transparency-popup__value" aria-live="polite">{blurRadius}px</span>
          </div>
          <input
            className="transparency-slider"
            type="range"
            min={MIN_BLUR_RADIUS}
            max={MAX_BLUR_RADIUS}
            step={1}
            value={blurRadius}
            aria-label="高斯模糊"
            aria-valuetext={`${blurRadius}px`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
      ) : null}
    </div>
  );
}
