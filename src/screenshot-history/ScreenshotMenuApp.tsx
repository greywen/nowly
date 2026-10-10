import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Crop, History } from '../components/icons';
import { useTranslation } from '../i18n';
import { useTransparentSurfaces } from '../quick-panel/useTransparentSurfaces';
import { normalizeShortcutStatus, type ScreenshotShortcutStatus } from './client';
import { SurfaceIconProvider } from './SurfaceIconProvider';
import './styles.css';

export function ScreenshotMenuApp() {
  useTransparentSurfaces();
  const { t } = useTranslation();
  const [shortcuts, setShortcuts] = useState<ScreenshotShortcutStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    setStatusFailed(false);
    setShortcuts(null);
    setActionFailed(false);
    void invoke<unknown>('screenshot_shortcut_status').then(status => {
      if (request !== generation.current) return;
          setShortcuts(normalizeShortcutStatus(status));
      buttons.current[0]?.focus();
    }).catch(() => { if (request === generation.current) setStatusFailed(true); });
  }, []);
  const close = useCallback(() => { void invoke('close_screenshot_menu').catch(() => setActionFailed(true)); }, []);
  useEffect(() => {
    let disposed = false;
    const removers: Array<() => void> = [];
    const keep = (remove: () => void) => disposed ? remove() : removers.push(remove);
    void listen('screenshot-menu-opened', refresh).then(keep).catch(() => undefined);
    void listen('nowly-data-changed', refresh).then(keep).catch(() => undefined);
    window.addEventListener('blur', close);
    window.addEventListener('focus', refresh);
    buttons.current[0]?.focus();
    refresh();
    return () => { disposed = true; generation.current++; removers.forEach(remove => remove()); window.removeEventListener('blur', close); window.removeEventListener('focus', refresh); };
  }, [close, refresh]);
  const activate = async (command: 'start_screen_capture' | 'open_screenshot_history') => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setActionFailed(false);
    try { await invoke('close_screenshot_menu'); await invoke(command); }
    catch { setActionFailed(true); }
    finally { busy.current = false; setPending(false); }
  };
  const commands = ['start_screen_capture', 'open_screenshot_history'] as const;
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = buttons.current.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (Math.max(0, index) + (event.key === 'ArrowDown' ? 1 : -1) + 2) % 2;
      buttons.current[next]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
      event.preventDefault();
      void activate(commands[index]);
    }
  };
  return <SurfaceIconProvider><div className="screenshot-menu" role="menu" aria-label={t('screenshotMenu.label')} aria-busy={pending} onKeyDown={navigate}>
    {commands.map((command, index) => {
      const binding = shortcuts?.[index === 0 ? 'screenshot' : 'history'];
      const Icon = index === 0 ? Crop : History;
      const shortcutLabel = binding?.shortcut ?? t(statusFailed ? 'screenshotMenu.shortcutUnavailable' : 'screenshotMenu.loadingShortcut');
      return <button key={command} ref={element => { buttons.current[index] = element; }} role="menuitem" aria-label={`${t(index === 0 ? 'screenshotMenu.capture' : 'screenshotHistory.title')} ${shortcutLabel}${binding && !binding.registered ? ` ${t('screenshotMenu.shortcutUnavailable')}` : ''}`} className="screenshot-menu__item" disabled={pending} onClick={() => void activate(command)}>
        <Icon size={18} /><span>{t(index === 0 ? 'screenshotMenu.capture' : 'screenshotHistory.title')}</span>
        <span className="screenshot-menu__shortcut"><span>{shortcutLabel}</span>
          {binding && !binding.registered && <span className="screenshot-menu__unavailable">{t('screenshotMenu.shortcutUnavailable')}</span>}
        </span>
      </button>;
    })}
    {statusFailed && <div className="screenshot-menu__error" role="alert"><span>{t('screenshotMenu.statusFailed')}</span><button className="screenshot-menu__retry" onClick={refresh}>{t('common.retry')}</button></div>}
    {actionFailed && <p className="screenshot-menu__error" role="alert">{t('screenshotMenu.actionFailed')}</p>}
  </div></SurfaceIconProvider>;
}
