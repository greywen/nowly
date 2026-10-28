import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical as MenuDots } from './icons';

export type ActionMenuItem = {
  id: string;
  label: string;
  tone?: 'danger';
  // Receives the trigger so a dialog opened from the menu can return focus to it.
  onSelect(trigger: HTMLElement | null): void;
};

type ActionMenuProps = {
  // Accessible name of the "⋯" trigger, e.g. "待处理泳道操作".
  label: string;
  items: ActionMenuItem[];
};

// A "⋯" icon button that opens a short list of commands. Portaled and fixed for
// the same reason as FilterSelect: module bodies clip in-tree popups.
export function ActionMenu({ label, items }: ActionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ right: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const box = triggerRef.current?.getBoundingClientRect();
      if (box) setRect({ right: window.innerWidth - box.right, top: box.bottom + 8 });
    }
    measure();
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      setRect(null);
    };
  }, [open]);

  // Browsers refuse focus while the menu is still `visibility: hidden`, so the
  // first item is focused only once the menu has been positioned.
  const positioned = rect !== null;
  useLayoutEffect(() => {
    if (open && positioned) itemRefs.current[0]?.focus();
  }, [open, positioned]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = itemRefs.current.findIndex((item) => item === document.activeElement);
    const focusAt = (next: number) => itemRefs.current[(next + items.length) % items.length]?.focus();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="good-icon-button action-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MenuDots aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={popupRef}
              id={menuId}
              className="action-menu"
              role="menu"
              aria-label={label}
              style={rect ? { right: `${rect.right}px`, top: `${rect.top}px` } : { visibility: 'hidden' }}
              onKeyDown={handleMenuKeyDown}
            >
              {items.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => { itemRefs.current[index] = node; }}
                  type="button"
                  role="menuitem"
                  className={`action-menu__item${item.tone === 'danger' ? ' action-menu__item--danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect(triggerRef.current);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
