import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Trash2 } from '../components/icons';
import { barAppIcon, barAppLabel } from '../app/layout/BarButtonLane';
import {
  BAR_APPS,
  BAR_BUTTON_SLOTS,
  normalizeBarButtons,
  type BarAppId
} from '../app/bar-buttons';
import { t } from '../i18n';

// The Nowly Bar's app button configuration. The preview is a real-scale replica
// of the collapsed bar built from the same CSS custom properties and the same
// lane geometry as the live rail (design.md §8.3), so what the user sees here is
// what lands on the bar.
//
// Empty slots show a plus. They exist only here: the live bar renders configured
// buttons and nothing else, so it never carries a dead placeholder.

export function BarButtonSettings({
  buttons,
  onChange
}: {
  buttons: readonly string[] | undefined;
  onChange: (buttons: BarAppId[]) => void;
}) {
  const configured = normalizeBarButtons(buttons);
  // Which slot's picker is open. Null is "none"; slots are identified by index so
  // the same popover serves adding, replacing and removing.
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const slots = Array.from({ length: BAR_BUTTON_SLOTS }, (_, index) => configured[index] ?? null);

  function assign(slot: number, id: BarAppId) {
    // An app occupies at most one slot, so picking it again moves it rather than
    // duplicating it. Annotated because narrowing a single-member union in the
    // predicate would otherwise infer `never[]`.
    const next: BarAppId[] = configured.filter(existing => existing !== id);
    // Slots fill left to right and stay contiguous, so a pick lands at the end
    // rather than leaving a hole behind an empty slot.
    next.splice(Math.min(slot, next.length), 0, id);
    onChange(next.slice(0, BAR_BUTTON_SLOTS));
    setOpenSlot(null);
  }

  function remove(slot: number) {
    onChange(configured.filter((_, index) => index !== slot));
    setOpenSlot(null);
  }

  return (
    <div className="bar-buttons">
      <div className="bar-buttons__head">
        <span className="bar-buttons__label">{t('settings.barButtons')}</span>
        <p className="bar-buttons__hint">{t('settings.barButtonsHint')}</p>
      </div>
      <div className="bar-buttons__stage" role="group" aria-label={t('settings.barButtonsPreview')}>
        {/* Same class names and variables as the live rail, at 1:1 scale. */}
        <div
          className="status-rail bar-buttons__rail"
          data-preview="true"
          // The collapsed status surface is what the preview shows. Without this
          // the live rail's "a panel took over" rules would fade the logo and the
          // app buttons out, since they match on the attribute being absent.
          data-surface="status"
          style={{ '--app-buttons': BAR_BUTTON_SLOTS } as React.CSSProperties}
        >
          <div className="status-rail__status-presence">
            <div className="bar-buttons__status">
              <span className="bar-buttons__status-icon" aria-hidden="true">
                <Check size={16} />
              </span>
              <span className="bar-buttons__status-copy">
                <strong>{t('settings.barButtonsPreviewStatus')}</strong>
                <span>{t('settings.barButtonsPreviewMeta')}</span>
              </span>
            </div>
            <span className="status-rail__nowly" data-preview="true" aria-hidden="true">
              <img src="/logo.png" alt="" />
            </span>
          </div>
          <ul className="bar-buttons__slots">
            {slots.map((id, index) => (
              <li key={index} className="bar-buttons__slot">
                <SlotControl
                  slot={index}
                  appId={id}
                  open={openSlot === index}
                  onToggle={() => setOpenSlot(current => (current === index ? null : index))}
                  onClose={() => setOpenSlot(null)}
                  onAssign={assign}
                  onRemove={remove}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * One slot: a plus when empty, the app's icon when filled. Both open the same
 * popover, which lists the catalogue and — when the slot is filled — the removal.
 * A single control keeps the 48x40 lane clickable and keyboard-reachable; a
 * hover-only remove affordance would be neither.
 */
function SlotControl({
  slot,
  appId,
  open,
  onToggle,
  onClose,
  onAssign,
  onRemove
}: {
  slot: number;
  appId: BarAppId | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAssign: (slot: number, id: BarAppId) => void;
  onRemove: (slot: number) => void;
}) {
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const label = appId
    ? t('settings.barButtonsConfigure', { slot: slot + 1, app: barAppLabel(appId) })
    : t('settings.barButtonsAdd', { slot: slot + 1 });

  useLayoutEffect(() => {
    if (!open) return;
    function positionMenu() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const boundary = container.current?.closest('.good-dialog__body')?.getBoundingClientRect();
      const topBoundary = Math.max(16, boundary?.top ?? 16);
      const bottomBoundary = Math.min(window.innerHeight - 16, boundary?.bottom ?? window.innerHeight - 16);
      const menuHeight = menu.current?.offsetHeight || 96;
      const spaceBelow = bottomBoundary - rect.bottom - 8;
      const spaceAbove = rect.top - topBoundary - 8;
      const top = spaceBelow < menuHeight && spaceAbove > spaceBelow
        ? Math.max(topBoundary, rect.top - menuHeight - 8)
        : rect.bottom + 8;
      setMenuPosition({ left: Math.max(16, rect.right - 200), top });
    }
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: MouseEvent) {
      const target = event.target as Node;
      if (!container.current?.contains(target) && !menu.current?.contains(target)) onClose();
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, onClose]);

  const Icon = appId ? barAppIcon(appId) : Plus;
  return (
    <div className="bar-buttons__slot-control" ref={container}>
      <button
        ref={trigger}
        type="button"
        className="bar-buttons__slot-button"
        data-filled={appId !== null}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onToggle}
      >
        <Icon aria-hidden="true" size={24} />
      </button>
      {open ? createPortal(
        <div
          ref={menu}
          className="bar-buttons__menu"
          id={menuId}
          role="menu"
          aria-label={t('settings.barButtonsPick')}
          style={menuPosition ?? { visibility: 'hidden' }}
        >
          {BAR_APPS.map(app => (
            <button
              key={app.id}
              type="button"
              role="menuitemradio"
              aria-checked={appId === app.id}
              className="bar-buttons__menu-item"
              onClick={() => onAssign(slot, app.id)}
            >
              <AppGlyph id={app.id} />
              <span>{barAppLabel(app.id)}</span>
              {appId === app.id ? (
                <span className="bar-buttons__menu-current">{t('settings.barButtonsCurrent')}</span>
              ) : null}
            </button>
          ))}
          {appId ? (
            <button
              type="button"
              role="menuitem"
              className="bar-buttons__menu-item"
              data-destructive="true"
              onClick={() => onRemove(slot)}
            >
              <Trash2 aria-hidden="true" size={16} />
              <span>{t('settings.barButtonsRemove')}</span>
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function AppGlyph({ id }: { id: BarAppId }) {
  const Icon = barAppIcon(id);
  return <Icon className="bar-buttons__menu-app-icon" aria-hidden="true" size={20} />;
}
