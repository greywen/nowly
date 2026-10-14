import { Clock3 } from '../components/icons';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';

const QUICK_TIMES = ['09:00', '09:30', '12:00', '14:00', '15:00', '18:00'] as const;

type TimePickerProps = {
  id: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  errorId?: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  now?: () => Date;
};

type TimeValue = { hour: string; minute: string };
const pad = (value: number) => String(value).padStart(2, '0');
const valid = (value: string, max: number) => /^\d{1,2}$/.test(value) && Number(value) <= max;
function parseTime(value: string, fallback: Date): TimeValue {
  const parts = value.split(':');
  return parts.length === 2 && valid(parts[0], 23) && valid(parts[1], 59)
    ? { hour: pad(Number(parts[0])), minute: pad(Number(parts[1])) }
    : { hour: pad(fallback.getHours()), minute: pad(fallback.getMinutes()) };
}

export function TimePicker({ id, label, hideLabel = false, value, errorId, disabled = false,
  open, onOpenChange, onChange, now = () => new Date() }: TimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [time, setTime] = useState(() => parseTime(value, now()));
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>();
  const [showError, setShowError] = useState(false);
  const composingRef = useRef(false);
  const activeRef = useRef(false);
  const shouldRestoreFocusRef = useRef(false);
  const dialogId = id + '-dialog';
  function close() {
    activeRef.current = false; shouldRestoreFocusRef.current = true; onOpenChange(false);
  }
  function commit(next: string) {
    if (!activeRef.current || disabled) return;
    activeRef.current = false; onChange(next); close();
  }
  function confirm() {
    if (composingRef.current) return;
    if (!valid(time.hour, 23) || !valid(time.minute, 59)) {
      setShowError(true);
      popupRef.current?.querySelector<HTMLInputElement>(!valid(time.hour, 23) ? '[data-unit="hour"]' : '[data-unit="minute"]')?.focus();
      return;
    }
    commit(pad(Number(time.hour)) + ':' + pad(Number(time.minute)));
  }
  function adjust(unit: 'hour' | 'minute', offset: number) {
    setTime(current => {
      const cycle = unit === 'hour' ? 24 : 60;
      const base = valid(current[unit], cycle - 1) ? Number(current[unit]) : 0;
      return { ...current, [unit]: pad(((base + offset) % cycle + cycle) % cycle) };
    });
  }
  function handleSpinKey(event: KeyboardEvent<HTMLInputElement>, unit: 'hour' | 'minute') {
    if (event.nativeEvent.isComposing || composingRef.current) return;
    const step = unit === 'hour' ? 1 : 5;
    const offsets: Record<string, number> = { ArrowUp: step, ArrowDown: -step, PageUp: step * 5, PageDown: -step * 5 };
    if (event.key in offsets) { event.preventDefault(); adjust(unit, offsets[event.key]); }
    else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); const next = event.key === 'Home' ? '00' : unit === 'hour' ? '23' : '59';
      setTime(current => ({ ...current, [unit]: next }));
    }
  }
  useEffect(() => {
    if (!open || disabled) { activeRef.current = false; return; }
    activeRef.current = true; setTime(parseTime(value, now())); setShowError(false);
    popupRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    function outside(event: PointerEvent) { if (!rootRef.current?.contains(event.target as Node)) close(); }
    document.addEventListener('pointerdown', outside);
    return () => { activeRef.current = false; document.removeEventListener('pointerdown', outside); };
  }, [open, disabled]);
  useEffect(() => {
    if (!open && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false; triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    function reposition() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const popup = popupRef.current; if (!trigger || !popup) return;
      const parent = rootRef.current?.closest('.good-dialog');
      const bounds = parent?.getBoundingClientRect();
      const header = parent?.querySelector('.good-dialog__header')?.getBoundingClientRect();
      const leftBound = Math.max(16, bounds?.left ?? 16);
      const rightBound = Math.min(window.innerWidth - 16, bounds?.right ?? window.innerWidth - 16);
      const topBound = Math.max(16, header?.bottom ?? bounds?.top ?? 16);
      const bottomBound = Math.min(window.innerHeight - 16, bounds?.bottom ?? window.innerHeight - 16);
      if (rightBound <= leftBound || bottomBound <= topBound) return;
      const width = Math.min(352, rightBound - leftBound);
      const height = Math.min(popup.scrollHeight, bottomBound - topBound);
      const preferredTop = trigger.bottom + 8;
      const top = preferredTop + height <= bottomBound ? preferredTop : Math.max(topBound, trigger.top - height - 8);
      const preferredLeft = rootRef.current?.closest('.event-form__range') ? trigger.right - width : trigger.left;
      setPosition({ left: Math.max(leftBound, Math.min(preferredLeft, rightBound - width)), top,
        width, maxHeight: Math.max(0, bottomBound - top) });
    }
    reposition(); window.addEventListener('resize', reposition); document.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); document.removeEventListener('scroll', reposition, true); };
  }, [open, disabled, showError]);

  return (
    <div ref={rootRef} className="time-picker">
      <label className={hideLabel ? 'time-picker__label visually-hidden' : 'time-picker__label'} id={`${id}-label`} htmlFor={id}>{label}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="time-picker__trigger"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-describedby={errorId}
        disabled={disabled}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <span>{value || t('timePicker.placeholder')}</span>
        <Clock3 aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div ref={popupRef} id={dialogId} role="dialog" aria-label={t('timePicker.select', { label })}
          className="time-picker__popup" style={position} onKeyDown={event => {
            if (['Escape', 'Enter', 'Tab'].includes(event.key)) event.stopPropagation();
            if (event.nativeEvent.isComposing || composingRef.current) return;
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); confirm(); }
            else if (event.key === 'Tab') {
              const nodes = Array.from(popupRef.current?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button') ?? []).filter(node => !node.disabled);
              const first = nodes[0]; const last = nodes[nodes.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
          <div className="time-picker__steppers">
            {(['hour', 'minute'] as const).map((unit, index) => <div key={unit} className="time-picker__column">
              <label className="time-picker__unit" htmlFor={id + '-' + unit}>{t('timePicker.' + unit)}</label>
              <div className="time-picker__stepper">
                <button type="button" aria-label={t(index ? 'timePicker.decreaseMinute' : 'timePicker.decreaseHour')} onClick={() => adjust(unit, index ? -5 : -1)}><span aria-hidden="true">−</span></button>
                <input id={id + '-' + unit} data-unit={unit} type="text" inputMode="numeric" maxLength={2} autoComplete="off"
                  role="spinbutton" aria-label={t('timePicker.' + unit)} aria-valuemin={0} aria-valuemax={index ? 59 : 23}
                  aria-valuenow={valid(time[unit], index ? 59 : 23) ? Number(time[unit]) : undefined}
                  aria-invalid={showError && !valid(time[unit], index ? 59 : 23) || undefined}
                  aria-describedby={showError && !valid(time[unit], index ? 59 : 23) ? id + '-error' : undefined}
                  className="time-picker__value" value={time[unit]} onFocus={event => event.target.select()} onClick={event => event.currentTarget.select()}
                  onChange={event => { const next = event.target.value; setTime(current => ({ ...current, [unit]: next })); if (!composingRef.current) setShowError(true); }}
                  onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; setShowError(true); }}
                  onBlur={() => { if (valid(time[unit], index ? 59 : 23)) setTime(current => ({ ...current, [unit]: pad(Number(current[unit])) })); }}
                  onKeyDown={event => handleSpinKey(event, unit)} />
                <button type="button" aria-label={t(index ? 'timePicker.increaseMinute' : 'timePicker.increaseHour')} onClick={() => adjust(unit, index ? 5 : 1)}><span aria-hidden="true">+</span></button>
              </div>
            </div>)}
            <span className="time-picker__separator" aria-hidden="true">:</span>
          </div>
          {showError && (!valid(time.hour, 23) || !valid(time.minute, 59)) ? <p id={id + '-error'} role="alert" className="time-picker__error">{t('timePicker.invalid')}</p> : null}
          <div className="time-picker__quick-values">
            {QUICK_TIMES.map(quickTime => <button type="button" key={quickTime}
              aria-pressed={quickTime === time.hour + ':' + time.minute}
              onClick={() => { setTime(parseTime(quickTime, now())); setShowError(false); }}>{quickTime}</button>)}
          </div>
          <div className="time-picker__footer">
            <button type="button" aria-label={t('timePicker.clear')} onClick={() => commit('')}>{t('timePicker.clearShort')}</button>
            <button type="button" onClick={() => { setTime(parseTime('', now())); setShowError(false); }}>{t('timePicker.now')}</button>
            <button type="button" className="time-picker__confirm" onClick={confirm}>{t('timePicker.confirm')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
