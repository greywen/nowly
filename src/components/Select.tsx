import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';

export type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  id: string;
  name?: string;
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  errorId?: string;
  // Keep the label accessible to screen readers but hide it visually, for
  // compact inline selects that already have a nearby textual label.
  hideLabel?: boolean;
};

export function Select({ id, name, label, options, value, onChange, placeholder, searchable = false, disabled = false, errorId, hideLabel = false }: SelectProps) {
  const resolvedPlaceholder = placeholder ?? t('select.placeholder');
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [popupMaxHeight, setPopupMaxHeight] = useState(320);
  const [popupRect, setPopupRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(
    () => options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [options, query]
  );
  const activeOption = filteredOptions[activeIndex];

  // Measure before paint so the fixed-position popup never flashes at the
  // viewport's full width before it is anchored to the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    function measurePlacement() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Prefer a scrollable modal body as the vertical boundary, but fall back
      // to a plain dialog body so selects inside either container stay bounded.
      const modalBody = rootRef.current?.closest('.good-modal-body, .good-dialog__body');
      const boundary = modalBody?.getBoundingClientRect();
      const topBoundary = Math.max(16, boundary?.top ?? 16);
      const bottomBoundary = Math.min(window.innerHeight - 16, boundary?.bottom ?? window.innerHeight - 16);
      const spaceBelow = bottomBoundary - rect.bottom - 8;
      const spaceAbove = rect.top - topBoundary - 8;
      const above = spaceBelow < 240 && spaceAbove > spaceBelow;
      setPlaceAbove(above);
      setPopupMaxHeight(Math.max(96, Math.min(320, above ? spaceAbove : spaceBelow)));
      // Anchor the popup with viewport coordinates so it can escape the
      // modal body's overflow clipping via position: fixed.
      setPopupRect({ left: rect.left, top: rect.bottom, bottom: rect.top, width: rect.width });
    }
    measurePlacement();
    window.addEventListener('resize', measurePlacement);
    window.addEventListener('scroll', measurePlacement, true);
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());

    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', measurePlacement);
      window.removeEventListener('scroll', measurePlacement, true);
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) setActiveIndex(0);
  }, [activeIndex, filteredOptions.length]);

  function openList() {
    if (!disabled) setOpen(true);
  }

  function close(restoreFocus = true) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => filteredOptions.length ? (index + 1) % filteredOptions.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => filteredOptions.length ? (index - 1 + filteredOptions.length) % filteredOptions.length : 0);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(filteredOptions.length - 1, 0));
    } else if ((event.key === 'Enter' || (!searchable && event.key === ' ')) && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (!searchable && event.key.length === 1 && event.key !== ' ') {
      const match = filteredOptions.findIndex((option) => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match >= 0) setActiveIndex(match);
    }
  }

  return (
    <div ref={rootRef} className="select-field">
      <label className={hideLabel ? 'select-label select-label--hidden' : 'select-label'} id={`${id}-label`} htmlFor={id}>{label}</label>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeOption ? `${listboxId}-${activeOption.value || 'empty'}` : undefined}
        aria-describedby={errorId}
        disabled={disabled}
        className="select-trigger"
        onClick={() => open ? close(false) : openList()}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label ?? resolvedPlaceholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popupRef}
          className={`select-popup${placeAbove ? ' select-popup--above' : ''}`}
          style={{
            maxHeight: `${popupMaxHeight}px`,
            ...(popupRect
              ? {
                  left: `${popupRect.left}px`,
                  width: `${popupRect.width}px`,
                  ...(placeAbove
                    ? { bottom: `${window.innerHeight - popupRect.bottom + 8}px` }
                    : { top: `${popupRect.top + 8}px` })
                }
              : { visibility: 'hidden' })
          }}
        >
          {searchable ? (
            <input
              className="select-search"
              ref={searchRef}
              type="search"
              autoComplete="off"
              aria-label={t('select.search', { label })}
              aria-controls={listboxId}
              aria-activedescendant={activeOption ? `${listboxId}-${activeOption.value || 'empty'}` : undefined}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={handleKeyDown}
            />
          ) : null}
          <div className="select-listbox" id={listboxId} role="listbox" aria-labelledby={`${id}-label`}>
            {filteredOptions.map((option, index) => (
              <button
                id={`${listboxId}-${option.value || 'empty'}`}
                key={option.value}
                type="button"
                className="select-option"
                role="option"
                aria-selected={option.value === value}
                data-active={index === activeIndex || undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.value === value ? <Check aria-hidden="true" /> : null}
              </button>
            ))}
            {filteredOptions.length === 0 ? <div className="select-empty">{options.length === 0 ? t('select.noOptions') : t('select.noMatch')}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
