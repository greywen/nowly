import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { buildMonthGrid, formatChineseDate, toIsoDate } from '../lib/date';
import { t } from '../i18n';

function weekdayHeadingsList() {
  return t('datePicker.weekdays').split(',');
}

export type DatePickerProps = {
  id: string;
  label: string;
  value: string;
  errorId?: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  today?: Date;
};

function parseIsoDate(value: string, fallback: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function displayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return t('datePicker.placeholder');
  return t('datePicker.value', { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
}

export function DatePicker({
  id,
  label,
  value,
  errorId,
  disabled = false,
  open,
  onOpenChange,
  onChange,
  today = new Date()
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialDate = parseIsoDate(value, today);
  const [visibleMonth, setVisibleMonth] = useState({
    year: initialDate.getFullYear(),
    monthIndex: initialDate.getMonth()
  });
  const [cursorDate, setCursorDate] = useState(initialDate);
  const cursorDateRef = useRef(initialDate);
  const shouldRestoreFocusRef = useRef(false);

  const days = buildMonthGrid(visibleMonth.year, visibleMonth.monthIndex, today);
  const dialogId = `${id}-dialog`;

  useEffect(() => {
    if (!open) return;
    const selected = parseIsoDate(value, today);
    cursorDateRef.current = selected;
    setCursorDate(selected);
    setVisibleMonth({ year: selected.getFullYear(), monthIndex: selected.getMonth() });
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-date="${toIsoDate(selected)}"]`)?.focus();
    });

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

  function choose(date: Date) {
    onChange(toIsoDate(date));
    close(true);
  }

  function moveCursor(nextDate: Date) {
    cursorDateRef.current = nextDate;
    setCursorDate(nextDate);
    setVisibleMonth({ year: nextDate.getFullYear(), monthIndex: nextDate.getMonth() });
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-date="${toIsoDate(nextDate)}"]`)?.focus();
    });
  }

  function changeVisibleMonth(offset: number) {
    const date = new Date(visibleMonth.year, visibleMonth.monthIndex + offset, 1);
    setVisibleMonth({ year: date.getFullYear(), monthIndex: date.getMonth() });
  }

  function handleDateKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const cursor = cursorDateRef.current;
    let nextDate: Date | null = null;
    if (event.key === 'ArrowLeft') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    if (event.key === 'ArrowRight') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    if (event.key === 'ArrowUp') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
    if (event.key === 'ArrowDown') nextDate = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    if (event.key === 'PageUp') nextDate = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
    if (event.key === 'PageDown') nextDate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    if (nextDate) {
      event.preventDefault();
      moveCursor(nextDate);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(cursor);
    }
  }

  return (
    <div ref={rootRef} className="date-picker">
      <label className="date-picker__label" id={`${id}-label`} htmlFor={id}>{label}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="date-picker__trigger"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-describedby={errorId}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <span>{displayDate(value)}</span>
        <CalendarDays aria-hidden="true" />
      </button>
      {open ? (
        <div id={dialogId} role="dialog" aria-label={t('datePicker.select', { label })} className="date-picker__popup">
          <div className="date-picker__header">
            <button type="button" aria-label={t('datePicker.prevMonth')} onClick={() => changeVisibleMonth(-1)}><ChevronLeft aria-hidden="true" /></button>
            <strong>{t('datePicker.header', { year: visibleMonth.year, month: visibleMonth.monthIndex + 1 })}</strong>
            <button type="button" aria-label={t('datePicker.nextMonth')} onClick={() => changeVisibleMonth(1)}><ChevronRight aria-hidden="true" /></button>
          </div>
          <div role="grid" aria-label={t('datePicker.grid', { year: visibleMonth.year, month: visibleMonth.monthIndex + 1 })} className="date-picker__calendar">
            <div role="row" className="date-picker__weekdays">
              {weekdayHeadingsList().map((heading) => <span role="columnheader" key={heading}>{heading}</span>)}
            </div>
            <div role="rowgroup" className="date-picker__days">
              {days.map((day) => {
                const date = parseIsoDate(day.isoDate, today);
                const selected = day.isoDate === value;
                const current = day.isoDate === toIsoDate(today);
                return (
                  <button
                    key={day.isoDate}
                    type="button"
                    role="gridcell"
                    data-date={day.isoDate}
                    tabIndex={day.isoDate === toIsoDate(cursorDate) ? 0 : -1}
                    aria-label={formatChineseDate(date)}
                    aria-selected={selected}
                    aria-current={current ? 'date' : undefined}
                    className={`date-picker__day${day.isCurrentMonth ? '' : ' date-picker__day--outside'}${selected ? ' date-picker__day--selected' : ''}${current ? ' date-picker__day--today' : ''}`}
                    onClick={() => choose(date)}
                    onKeyDown={(event) => handleDateKeyDown(event, date)}
                  >
                    {day.dayOfMonth}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="date-picker__footer">
            <button type="button" aria-label={t('datePicker.clear')} onClick={() => { onChange(''); close(true); }}>{t('datePicker.clearShort')}</button>
            <button type="button" onClick={() => choose(today)}>{t('datePicker.today')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
