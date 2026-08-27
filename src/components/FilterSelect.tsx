import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export type FilterOption = {
  value: string;
  label: string;
  // Optional accent colour for the label text (e.g. tag / priority colours).
  color?: string;
};

type FilterSelectProps = {
  // The muted caption shown before the trigger, e.g. "Status".
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  // Accessible name for the trigger button, e.g. "Filter by status".
  ariaLabel: string;
};

// An inline label + dropdown filter matching the reference navigation-bar
// style: a muted caption, a bold current-selection trigger with a chevron, and
// a popover list where the active option shows a check. No animation, per the
// project's static-motion rule.
export function FilterSelect({ label, options, value, onChange, ariaLabel }: FilterSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(option: FilterOption) {
    onChange(option.value);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (options.length ? (index + 1) % options.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (options.length ? (index - 1 + options.length) % options.length : 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(options.length - 1, 0));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  }

  return (
    <div ref={rootRef} className="filter-select">
      <span className="filter-select__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="filter-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={handleKeyDown}
      >
        <span style={selected?.color ? { color: selected.color } : undefined}>{selected?.label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-select__popup" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className="filter-select__option"
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex || undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span style={option.color ? { color: option.color } : undefined}>{option.label}</span>
              {option.value === value ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
