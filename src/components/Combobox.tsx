import { ChevronDown } from './icons';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

type ComboboxProps = {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  /** Shown in the list instead of options while they load. */
  loading?: boolean;
  loadingText: string;
  emptyText: string;
  toggleLabel: string;
  describedBy?: string;
  /** Rendered beside the input, e.g. a refresh button. */
  trailing?: ReactNode;
};

/**
 * A text field with a suggestion list: the typed value is always accepted,
 * and the list only offers known values. Popup styling matches `Select`.
 */
export function Combobox({ id, label, value, options, onChange, placeholder, disabled = false, loading = false, loadingText, emptyText, toggleLabel, describedBy, trailing }: ComboboxProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Typing filters the list; opening it shows every option.
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number; above: boolean; maxHeight: number } | null>(null);
  const shown = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    return filtering && query ? options.filter(option => option.toLocaleLowerCase().includes(query)) : [...options];
  }, [options, value, filtering]);
  const active = activeIndex >= 0 ? shown[activeIndex] : undefined;
  const optionId = (index: number) => `${listboxId}-${index}`;

  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const field = inputRef.current?.parentElement?.getBoundingClientRect();
      if (!field) return;
      const boundary = rootRef.current?.closest('.good-modal-body, .good-dialog__body')?.getBoundingClientRect();
      const topBoundary = Math.max(16, boundary?.top ?? 16);
      const bottomBoundary = Math.min(window.innerHeight - 16, boundary?.bottom ?? window.innerHeight - 16);
      const below = bottomBoundary - field.bottom - 8;
      const aboveSpace = field.top - topBoundary - 8;
      const above = below < 240 && aboveSpace > below;
      setRect({ left: field.left, top: field.bottom, bottom: field.top, width: field.width, above, maxHeight: Math.max(96, Math.min(320, above ? aboveSpace : below)) });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    function dismiss(event: Event) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('focusin', dismiss, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('focusin', dismiss, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(shown.indexOf(value));
  }, [open, shown, value]);

  useEffect(() => {
    if (open && active) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  function show() {
    if (disabled) return;
    setFiltering(false);
    setOpen(true);
  }

  function choose(option: string) {
    onChange(option);
    setOpen(false);
    inputRef.current?.focus();
  }

  function move(step: number) {
    if (!open) { show(); return; }
    if (!shown.length) return;
    setActiveIndex(index => index < 0 ? (step > 0 ? 0 : shown.length - 1) : (index + step + shown.length) % shown.length);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && open && active !== undefined) { event.preventDefault(); choose(active); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <div ref={rootRef} className="select-field combobox">
      <label className="select-label" htmlFor={id}>{label}</label>
      <div className="combobox__row">
        <div className="combobox__control">
          <input
            ref={inputRef}
            id={id}
            className="combobox__input"
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && active !== undefined ? optionId(activeIndex) : undefined}
            aria-describedby={describedBy}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onChange={event => { onChange(event.target.value); setFiltering(true); setOpen(true); }}
            onClick={() => { if (!open) show(); }}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="combobox__toggle" tabIndex={-1} aria-label={toggleLabel} aria-expanded={open} aria-controls={listboxId} disabled={disabled}
            onClick={() => { if (open) setOpen(false); else { show(); inputRef.current?.focus(); } }}>
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        {trailing}
      </div>
      {open ? (
        <div
          ref={popupRef}
          className={`select-popup${rect?.above ? ' select-popup--above' : ''}`}
          style={rect ? {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            maxHeight: `${rect.maxHeight}px`,
            ...(rect.above ? { bottom: `${window.innerHeight - rect.bottom + 8}px` } : { top: `${rect.top + 8}px` })
          } : { visibility: 'hidden' }}
        >
          <div className="select-listbox" id={listboxId} role="listbox" aria-label={label}>
            {loading ? <div className="select-empty" role="status">{loadingText}</div>
              : shown.map((option, index) => (
                <div
                  id={optionId(index)}
                  key={option}
                  className="select-option"
                  role="option"
                  aria-selected={option === value}
                  data-active={index === activeIndex || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onPointerDown={event => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="select-value">{option}</span>
                </div>
              ))}
            {!loading && shown.length === 0 ? <div className="select-empty">{emptyText}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
