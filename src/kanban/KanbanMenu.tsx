import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

type TriggerIcon = React.ComponentType<{ 'aria-hidden'?: boolean }>;

export type KanbanMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  icon?: ReactNode;
};

// A small accessible dropdown used for lane and card action menus. It opens and
// closes instantly (no animation), closes on Esc / outside click, and restores
// focus to its trigger. Items are plain buttons so keyboard Tab order works.
export function KanbanMenu({
  label,
  items,
  triggerClassName,
  triggerIcon: TriggerIcon = MoreHorizontal
}: {
  label: string;
  items: KanbanMenuItem[];
  triggerClassName?: string;
  triggerIcon?: TriggerIcon;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(item: KanbanMenuItem) {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  }

  return (
    <div ref={rootRef} className="kanban-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-icon${open ? ' is-active' : ''}${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <TriggerIcon aria-hidden={true} />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="kanban-menu__popup" aria-label={label}>
          {items.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              role="menuitem"
              className={`kanban-menu__item${item.tone === 'danger' ? ' kanban-menu__item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => choose(item)}
            >
              {item.icon ? <span className="kanban-menu__icon">{item.icon}</span> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
