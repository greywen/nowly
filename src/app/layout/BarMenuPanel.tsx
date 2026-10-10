import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Crop, History, Sparkles } from '../../components/icons';
import { useTranslation } from '../../i18n';
import { normalizeShortcutStatus, type ScreenshotShortcutStatus } from '../../screenshot-history/client';
import { SurfaceIconProvider } from '../../screenshot-history/SurfaceIconProvider';
import type { BarFeatureId, BarMenuItem } from '../bar-menu';

const commands: Record<BarFeatureId, string> = {
  screenshot: 'start_screen_capture',
  screenshotHistory: 'open_screenshot_history',
  assistant: 'toggle_nowly_panel'
};
const labels = {
  screenshot: 'barMenu.screenshot',
  screenshotHistory: 'barMenu.screenshotHistory',
  assistant: 'barMenu.assistant'
} as const;
const icons = { screenshot: Crop, screenshotHistory: History, assistant: Sparkles };

export function BarMenuPanel({ active, items }: { active: boolean; items: readonly BarMenuItem[] }) {
  const { t } = useTranslation();
  const visible = items.filter(item => item.visible);
  const visibleIds = visible.map(item => item.id).join(',');
  const wasActive = useRef(false);
  const focusPending = useRef(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
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
      focusPending.current = pending;
      if (!pending) {
        if (visibleIds) buttons.current[0]?.focus();
        else document.querySelector<HTMLButtonElement>('[data-owner="menu"]')?.focus();
      }
    }
    wasActive.current = active;
  }, [active, pending, visibleIds]);

  async function activate(id: BarFeatureId) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    failedAction.current = null;
    try {
      await invoke(commands[id]);
    } catch (reason: unknown) {
      if (!mounted.current) return;
      const message = reason instanceof Error ? reason.message
        : typeof reason === 'string' ? reason
        : typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string'
          ? reason.message : t('barMenu.actionFailed');
      failedAction.current = id;
      setError(message || t('barMenu.actionFailed'));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !visible.length || pending) return;
    event.preventDefault();
    const index = buttons.current.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : (Math.max(0, index) + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    buttons.current[next]?.focus();
  }

  return <SurfaceIconProvider><section className="bar-menu-panel" aria-label={t('barMenu.title')}>
    <header className="bar-menu-panel__header"><h2>{t('barMenu.title')}</h2></header>
    <div className="bar-menu-panel__body">
      <div role="menu" aria-label={t('barMenu.title')} aria-busy={pending} onKeyDown={navigate}>
        {visible.map((item, index) => {
          const Icon = icons[item.id];
          const binding = item.id === 'screenshot' ? shortcuts?.screenshot
            : item.id === 'screenshotHistory' ? shortcuts?.history : null;
          return <button key={item.id} role="menuitem" className="bar-menu-panel__item"
            ref={element => { buttons.current[index] = element; }} disabled={pending}
            onClick={() => void activate(item.id)}>
            <Icon size={18} /><span>{t(labels[item.id])}</span>
            {item.id !== 'assistant' && <span className="bar-menu-panel__shortcut">
              <span>{binding?.shortcut ?? t(statusFailed ? 'barMenu.shortcutUnavailable' : 'barMenu.loadingShortcut')}</span>
              {binding && !binding.registered && <span>{t('barMenu.shortcutUnavailable')}</span>}
            </span>}
          </button>;
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
