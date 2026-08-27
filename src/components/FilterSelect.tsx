import { Check, ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type FilterOption = {
  value: string;
  label: string;
  // Optional accent colour for the label text (e.g. tag / priority colours).
  color?: string;
};

type FilterSelectProps = {
  // The muted caption shown before the trigger, e.g. "Status". Omit to render
  // the trigger with no leading caption.
  label?: string;
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
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [popupMaxHeight, setPopupMaxHeight] = useState(320);
  const [popupRect, setPopupRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  // Measure before paint so the fixed-position popup anchors to the trigger's
  // viewport rect instead of flashing at its natural spot.
  //
  // Why a portal + fixed (not just absolute or fixed in place): the module body
  // (`.module-frame__body`) sets `container: module / size`, i.e.
  // `container-type: size`, which applies layout containment. That makes the
  // body BOTH a clipping box (`overflow: hidden`) AND the containing block for
  // absolute *and* fixed descendants. So an in-tree popup — absolute or fixed —
  // is anchored to and clipped by the body, and a short module cuts it off.
  // Portaling the popup to `document.body` removes it from that containing /
  // clipping ancestor entirely; then `position: fixed` with viewport coords
  // places it correctly over everything (same approach as ColorPicker).
  useLayoutEffect(() => {
    if (!open) return;
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);

    function measurePlacement() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const topBoundary = 16;
      const bottomBoundary = window.innerHeight - 16;
      const spaceBelow = bottomBoundary - rect.bottom - 8;
      const spaceAbove = rect.top - topBoundary - 8;
      // Prefer opening downward. Only flip above when the popup genuinely can't
      // fit below (less than the minimum height) and there's more room on top.
      const minHeight = 96;
      const above = spaceBelow < minHeight && spaceAbove > spaceBelow;
      setPlaceAbove(above);
      setPopupMaxHeight(Math.max(96, Math.min(320, above ? spaceAbove : spaceBelow)));
      setPopupRect({ left: rect.left, top: rect.bottom, bottom: rect.top, width: rect.width });
    }
    measurePlacement();
    window.addEventListener('resize', measurePlacement);
    window.addEventListener('scroll', measurePlacement, true);

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
      {label ? <span className="filter-select__label">{label}</span> : null}
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
      {open
        ? createPortal(
            <div
              ref={popupRef}
              className={`filter-select__popup${placeAbove ? ' filter-select__popup--above' : ''}`}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
