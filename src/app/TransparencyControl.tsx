import { Blend } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_BLUR_RADIUS, MIN_BLUR_RADIUS } from './useTransparency';

type Props = {
  blurRadius: number;
  onChange: (blurRadius: number) => void;
  onOpenChange?: (open: boolean) => void;
};

export function TransparencyControl({ blurRadius, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
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
        aria-label="调整模糊"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Blend aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <div ref={popupRef} className="transparency-popup" role="dialog" aria-label="模糊">
          <div className="transparency-popup__head">
            <span className="transparency-popup__title">模糊</span>
            <span className="transparency-popup__value" aria-live="polite">{blurRadius}px</span>
          </div>
          <p className="transparency-popup__hint">设置为桌面壁纸后，页面将保持当前模糊效果。</p>
          <input
            className="transparency-slider"
            type="range"
            min={MIN_BLUR_RADIUS}
            max={MAX_BLUR_RADIUS}
            step={1}
            value={blurRadius}
            aria-label="模糊"
            aria-valuetext={`${blurRadius}px`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>,
        document.body
      ) : null}
    </div>
  );
}
