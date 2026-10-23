import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Crop, FileText, History, LayoutGrid, Sparkles, type AppIcon } from '../../components/icons';
import { useTranslation } from '../../i18n';
import { localizedRepositoryErrorMessage } from '../../i18n/localize-error';
import { normalizeShortcutStatus, type ScreenshotShortcutStatus, type ShortcutBinding } from '../../screenshot-history/client';
import { SurfaceIconProvider } from '../../screenshot-history/SurfaceIconProvider';
import { groupBarMenu, quickCreateKindOf, type BarFeatureId, type BarMenuItem } from '../bar-menu';

const commands: Partial<Record<BarFeatureId, string>> = {
  screenshot: 'start_screen_capture',
  screenshotHistory: 'open_screenshot_history',
  assistant: 'toggle_nowly_panel'
};
const icons: Record<BarFeatureId, AppIcon> = {
  screenshot: Crop,
  screenshotHistory: History,
  assistant: Sparkles,
  createEvent: CalendarDays,
  createTask: LayoutGrid,
  createNote: FileText
};
const groupLabels = { create: 'barMenu.groupCreate', capture: 'barMenu.groupCapture' } as const;

function bindingOf(status: ScreenshotShortcutStatus | null, id: BarFeatureId): ShortcutBinding | null {
  if (!status) return null;
  switch (id) {
    case 'screenshot': return status.screenshot;
    case 'screenshotHistory': return status.history;
    case 'createEvent': return status.createEvent;
    case 'createTask': return status.createTask;
    case 'createNote': return status.createNote;
    default: return null;
  }
}

export function BarMenuPanel({ active, items }: { active: boolean; items: readonly BarMenuItem[] }) {
  const { t } = useTranslation();
  const groupId = useId();
  const groups = groupBarMenu(items, item => item.visible && item.id !== 'assistant').filter(group => group.items.length);
  const visible = groups.flatMap(group => group.items);
  const visibleIds = visible.map(item => item.id).join(',');
  const wasActive = useRef(false);
  const focusPending = useRef(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const body = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState<ScreenshotShortcutStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const failedAction = useRef<BarFeatureId | null>(null);
  const refresh = useCallback(() => {
    const request = ++requestId.current;
    setStatusFailed(false);
    setShortcuts(null);
    void invoke<unknown>('screenshot_shortcut_status').then(normalizeShortcutStatus).then(status => {
      if (mounted.current && request === requestId.current) setShortcuts(status);
    }).catch(() => {
      if (mounted.current && request === requestId.current) setStatusFailed(true);
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current++; };
  }, []);
  useEffect(() => {
    if (!active) return;
    refresh();
    let disposed = false;
    let remove: (() => void) | undefined;
    void listen('nowly-data-changed', refresh).then(unlisten => {
      if (disposed) unlisten(); else remove = unlisten;
    }).catch(() => { if (!disposed) setStatusFailed(true); });
    return () => { disposed = true; remove?.(); requestId.current++; };
  }, [active, refresh]);
  useEffect(() => {
    if (!active) focusPending.current = false;
    if (active && (!wasActive.current || focusPending.current || document.activeElement === document.body)) {
      const deferred = focusPending.current;
      focusPending.current = pending;
      if (!pending) {
        // Focus deferred behind a pending action lands on that action when it fails, ready to retry.
        const failed = deferred && failedAction.current ? visibleIds.split(',').indexOf(failedAction.current) : -1;
        if (visibleIds) buttons.current[Math.max(0, failed)]?.focus();
        else document.querySelector<HTMLButtonElement>('[data-owner="menu"]')?.focus();
      }
    }
    wasActive.current = active;
  }, [active, pending, visibleIds]);
  useEffect(() => {
    // The grouped menu has little spare height, so keep a new alert in view.
    if ((error || statusFailed) && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [error, statusFailed]);

  async function activate(id: BarFeatureId) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    failedAction.current = null;
    try {
      const kind = quickCreateKindOf(id);
      if (kind) await invoke('open_quick_create', { kind });
      else await invoke(commands[id] ?? '');
    } catch (reason: unknown) {
      if (!mounted.current) return;
      const message = localizedRepositoryErrorMessage(reason) ?? t('barMenu.actionFailed');
      failedAction.current = id;
      setError(message || t('barMenu.actionFailed'));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    // Movement is linear in visual order; horizontal keys follow the reading direction.
    const rtl = document.documentElement.dir === 'rtl';
    const forward = ['ArrowDown', rtl ? 'ArrowLeft' : 'ArrowRight'];
    const backward = ['ArrowUp', rtl ? 'ArrowRight' : 'ArrowLeft'];
    const step = forward.includes(event.key) ? 1 : backward.includes(event.key) ? -1 : 0;
    if ((!step && event.key !== 'Home' && event.key !== 'End') || !visible.length || pending) return;
    event.preventDefault();
    const index = buttons.current.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : (Math.max(0, index) + step + visible.length) % visible.length;
    buttons.current[next]?.focus();
  }

  function entry(item: BarMenuItem, tile: boolean) {
    const index = visible.indexOf(item);
    const Icon = icons[item.id];
    const binding = bindingOf(shortcuts, item.id);
    const unavailable = binding && !binding.registered ? t('barMenu.shortcutUnavailable') : '';
    const label = <span className="bar-menu-panel__label">{t(`barMenu.${item.id}`)}</span>;
    const keys = binding && <span className="bar-menu-panel__keys">{binding.shortcut}</span>;
    return <button key={item.id} type="button" role="menuitem"
      className={tile ? 'bar-menu-panel__tile' : 'bar-menu-panel__item'}
      ref={element => { buttons.current[index] = element; }} disabled={pending}
      onClick={() => void activate(item.id)}>
      <Icon size={18} />
      {/* Quick-create shortcuts are optional, so a tile shows keys only once one is set. */}
      {tile ? <>{label}{keys}{unavailable && <span className="bar-menu-panel__note">{unavailable}</span>}</>
        : <span className="bar-menu-panel__text">
          {label}
          <span className="bar-menu-panel__shortcut">
            {keys || <span>{t(statusFailed ? 'barMenu.shortcutUnavailable' : 'barMenu.loadingShortcut')}</span>}
            {unavailable && <span>{unavailable}</span>}
          </span>
        </span>}
    </button>;
  }

  return <SurfaceIconProvider><section className="bar-menu-panel" aria-label={t('barMenu.title')}>
    <header className="bar-menu-panel__header"><h2>{t('barMenu.title')}</h2></header>
    <div className="bar-menu-panel__body" ref={body}>
      <div role="menu" className="bar-menu-panel__menu" aria-label={t('barMenu.title')} aria-busy={pending} onKeyDown={navigate}>
        {groups.map(group => {
          const labelId = `${groupId}-${group.id}`;
          return <div key={group.id} role="group" className="bar-menu-panel__group" data-group={group.id} aria-labelledby={labelId}>
            <div id={labelId} className="bar-menu-panel__group-label" aria-hidden="true">{t(groupLabels[group.id])}</div>
            <div className="bar-menu-panel__items">{group.items.map(item => entry(item, group.id === 'create'))}</div>
          </div>;
        })}
      </div>
      {!visible.length && <p className="bar-menu-panel__empty">{t('barMenu.empty')}</p>}
      {statusFailed && <p className="bar-menu-panel__error" role="alert">
        {t('barMenu.statusFailed')} <button type="button" onClick={refresh}>{t('common.retry')}</button>
      </p>}
      {error && <p className="bar-menu-panel__error" role="alert">
        {error} <button type="button" disabled={pending} onClick={() => {
          if (failedAction.current) void activate(failedAction.current);
        }}>{t('common.retry')}</button>
      </p>}
    </div>
  </section></SurfaceIconProvider>;
}
