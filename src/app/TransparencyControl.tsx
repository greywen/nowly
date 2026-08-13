import { Blend } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_OPACITY, MIN_OPACITY } from './useTransparency';

type Props = {
  opacity: number;
  onChange: (opacity: number) => void;
  // Fires when the popover opens or closes so the shell can show a live
  // preview of the fade while the slider is open, even in foreground mode.
  onOpenChange?: (open: boolean) => void;
};

// The slider works in transparency space (0% = fully opaque content, higher =
// more see-through) while the app stores opacity. Convert between the two so
// dragging right always means "more transparent".
const MAX_TRANSPARENCY = Math.round((MAX_OPACITY - MIN_OPACITY) * 100); // 100

function toTransparency(opacity: number): number {
  return Math.round((MAX_OPACITY - opacity) * 100);
}

function toOpacity(transparency: number): number {
  return MAX_OPACITY - transparency / 100;
}

export function TransparencyControl({ opacity, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const transparency = toTransparency(opacity);

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
        aria-label="调整透明度"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Blend aria-hidden="true" />
      </button>
      {open ? (
        <div className="transparency-popup" role="dialog" aria-label="透明度">
          <div className="transparency-popup__head">
            <span className="transparency-popup__title">透明度</span>
            <span className="transparency-popup__value" aria-live="polite">{transparency}%</span>
          </div>
          <input
            className="transparency-slider"
            type="range"
            min={0}
            max={MAX_TRANSPARENCY}
            step={1}
            value={transparency}
            aria-label="透明度"
            aria-valuetext={`${transparency}%`}
            onChange={(event) => onChange(toOpacity(Number(event.target.value)))}
          />
        </div>
      ) : null}
    </div>
  );
}
