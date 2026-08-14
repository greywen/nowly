import { ChevronDown, ChevronUp, Clock3 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

const QUICK_TIMES = ['09:00', '09:30', '12:00', '14:00', '15:00', '18:00'] as const;

type TimePickerProps = {
  id: string;
  label: string;
  value: string;
  errorId?: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  now?: () => Date;
};

type TimeValue = { hour: number; minute: number };

function parseTime(value: string, fallback: Date): TimeValue {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 55 && minute % 5 === 0) {
      return { hour, minute };
    }
  }
  return { hour: fallback.getHours(), minute: Math.floor(fallback.getMinutes() / 5) * 5 };
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatTime(time: TimeValue) {
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

function wrap(value: number, maximum: number) {
  return ((value % maximum) + maximum) % maximum;
}

export function TimePicker({
  id,
  label,
  value,
  errorId,
  disabled = false,
  open,
  onOpenChange,
  onChange,
  now = () => new Date()
}: TimePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initial = parseTime(value, now());
  const [time, setTime] = useState(initial);
  const timeRef = useRef(initial);
  const shouldRestoreFocusRef = useRef(false);
  const dialogId = `${id}-dialog`;

  useEffect(() => {
    if (!open) return;
    const selected = parseTime(value, now());
    timeRef.current = selected;
    setTime(selected);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus());

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(true);
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open && shouldRestoreFocusRef.current) {
      shouldRestoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function close(restoreFocus: boolean) {
    shouldRestoreFocusRef.current = restoreFocus;
    onOpenChange(false);
  }

  function change(next: TimeValue) {
    timeRef.current = next;
    setTime(next);
  }

  function changeHour(offset: number) {
    change({ ...timeRef.current, hour: wrap(timeRef.current.hour + offset, 24) });
  }

  function changeMinute(offset: number) {
    change({ ...timeRef.current, minute: wrap(timeRef.current.minute + offset, 60) });
  }

  function choose(next: TimeValue) {
    onChange(formatTime(next));
    close(true);
  }

  function handleSpinKey(event: KeyboardEvent<HTMLDivElement>, unit: 'hour' | 'minute') {
    const current = timeRef.current;
    let next: TimeValue | null = null;
    const isHour = unit === 'hour';
    if (event.key === 'ArrowUp') next = isHour ? { ...current, hour: wrap(current.hour + 1, 24) } : { ...current, minute: wrap(current.minute + 5, 60) };
    if (event.key === 'ArrowDown') next = isHour ? { ...current, hour: wrap(current.hour - 1, 24) } : { ...current, minute: wrap(current.minute - 5, 60) };
    if (event.key === 'PageUp') next = isHour ? { ...current, hour: wrap(current.hour + 5, 24) } : { ...current, minute: wrap(current.minute + 25, 60) };
    if (event.key === 'PageDown') next = isHour ? { ...current, hour: wrap(current.hour - 5, 24) } : { ...current, minute: wrap(current.minute - 25, 60) };
    if (event.key === 'Home') next = isHour ? { ...current, hour: 0 } : { ...current, minute: 0 };
    if (event.key === 'End') next = isHour ? { ...current, hour: 23 } : { ...current, minute: 55 };
    if (next) {
      event.preventDefault();
      change(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(current);
    }
  }

  function chooseString(value: string) {
    const [hour, minute] = value.split(':').map(Number);
    choose({ hour, minute });
  }

  return (
    <div ref={rootRef} className="time-picker">
      <label className="time-picker__label" id={`${id}-label`} htmlFor={id}>{label}</label>
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
        onClick={() => onOpenChange(!open)}
      >
        <span>{value || t('timePicker.placeholder')}</span>
        <Clock3 aria-hidden="true" />
      </button>
      {open ? (
        <div id={dialogId} role="dialog" aria-label={t('timePicker.select', { label })} className="time-picker__popup">
          <div className="time-picker__steppers">
            <div className="time-picker__stepper">
              <span className="time-picker__unit">{t('timePicker.hour')}</span>
              <button type="button" aria-label={t('timePicker.increaseHour')} onClick={() => changeHour(1)}><ChevronUp aria-hidden="true" /></button>
              <div
                role="spinbutton"
                tabIndex={0}
                aria-label={t('timePicker.hour')}
                aria-valuemin={0}
                aria-valuemax={23}
                aria-valuenow={time.hour}
                aria-valuetext={pad(time.hour)}
                className="time-picker__value"
                onKeyDown={(event) => handleSpinKey(event, 'hour')}
              >{pad(time.hour)}</div>
              <button type="button" aria-label={t('timePicker.decreaseHour')} onClick={() => changeHour(-1)}><ChevronDown aria-hidden="true" /></button>
            </div>
            <span className="time-picker__separator" aria-hidden="true">:</span>
            <div className="time-picker__stepper">
              <span className="time-picker__unit">{t('timePicker.minute')}</span>
              <button type="button" aria-label={t('timePicker.increaseMinute')} onClick={() => changeMinute(5)}><ChevronUp aria-hidden="true" /></button>
              <div
                role="spinbutton"
                tabIndex={0}
                aria-label={t('timePicker.minute')}
                aria-valuemin={0}
                aria-valuemax={55}
                aria-valuenow={time.minute}
                aria-valuetext={pad(time.minute)}
                className="time-picker__value"
                onKeyDown={(event) => handleSpinKey(event, 'minute')}
              >{pad(time.minute)}</div>
              <button type="button" aria-label={t('timePicker.decreaseMinute')} onClick={() => changeMinute(-5)}><ChevronDown aria-hidden="true" /></button>
            </div>
          </div>
          <div className="time-picker__quick-values">
            {QUICK_TIMES.map((quickTime) => (
              <button type="button" key={quickTime} onClick={() => chooseString(quickTime)}>{quickTime}</button>
            ))}
          </div>
          <div className="time-picker__footer">
            <button type="button" aria-label={t('timePicker.clear')} onClick={() => { onChange(''); close(true); }}>{t('timePicker.clearShort')}</button>
            <button type="button" onClick={() => choose(parseTime('', now()))}>{t('timePicker.now')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
