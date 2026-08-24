import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export type TabItem<Id extends string> = {
  id: Id;
  label: string;
  count?: number;
  disabled?: boolean;
};

type TabsProps<Id extends string> = {
  idPrefix: string;
  label: string;
  items: readonly TabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
};

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

// The single underline tab style for the whole app (design.md §8.12). Every
// settings surface — app-level and per-module — goes through this component so
// no screen re-implements a look-alike.
export function Tabs<Id extends string>({ idPrefix, label, items, value, onChange }: TabsProps<Id>) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const selectable = items.filter((item) => !item.disabled);
    if (selectable.length === 0) return;
    const current = selectable.findIndex((item) => item.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % selectable.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + selectable.length) % selectable.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = selectable.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = selectable[next];
    onChange(target.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, target.id))}`)?.focus();
  }

  return (
    <div ref={listRef} className="good-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            id={tabId(idPrefix, item.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(idPrefix, item.id)}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            className={`good-tabs__tab${active ? ' is-active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {item.count === undefined ? null : <span className="good-tabs__count">({item.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  tabId: id,
  active,
  className,
  children
}: {
  idPrefix: string;
  tabId: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      id={panelId(idPrefix, id)}
      role="tabpanel"
      aria-labelledby={tabId(idPrefix, id)}
      className={className ? `good-tabs__panel ${className}` : 'good-tabs__panel'}
    >
      {children}
    </div>
  );
}
