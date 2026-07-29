import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

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
};

export function Select({ id, name, label, options, value, onChange, placeholder = '请选择', searchable = false, disabled = false }: SelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [popupMaxHeight, setPopupMaxHeight] = useState(320);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(
    () => options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [options, query]
  );
  const activeOption = filteredOptions[activeIndex];

  useEffect(() => {
    if (!open) return;
    function measurePlacement() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const modalBody = rootRef.current?.closest('.good-modal-body');
      const boundary = modalBody?.getBoundingClientRect();
      const topBoundary = Math.max(16, boundary?.top ?? 16);
      const bottomBoundary = Math.min(window.innerHeight - 16, boundary?.bottom ?? window.innerHeight - 16);
      const spaceBelow = bottomBoundary - rect.bottom - 8;
      const spaceAbove = rect.top - topBoundary - 8;
      const above = spaceBelow < 240 && spaceAbove > spaceBelow;
      setPlaceAbove(above);
      setPopupMaxHeight(Math.max(96, Math.min(320, above ? spaceAbove : spaceBelow)));
    }
    measurePlacement();
    window.addEventListener('resize', measurePlacement);
    const selectedIndex = filteredOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());

    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', measurePlacement);
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
      <label className="select-label" id={`${id}-label`} htmlFor={id}>{label}</label>
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
        disabled={disabled}
        className="select-trigger"
        onClick={() => open ? close(false) : openList()}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className={`select-popup${placeAbove ? ' select-popup--above' : ''}`} style={{ maxHeight: `${popupMaxHeight}px` }}>
          {searchable ? (
            <input
              className="select-search"
              ref={searchRef}
              type="search"
              aria-label={`搜索${label}`}
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
            {filteredOptions.length === 0 ? <div className="select-empty">{options.length === 0 ? '暂无可选项' : '未找到匹配项'}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
