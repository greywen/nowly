import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState, type ReactNode } from 'react';
import { IconStyleProvider } from '../components/icons';
import { DEFAULT_ICON_STYLE, isIconStyle } from '../components/icon-style';

export function SurfaceIconProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState(DEFAULT_ICON_STYLE);
  useEffect(() => {
    let disposed = false;
    let request = 0;
    let remove: (() => void) | undefined;
    const refresh = () => {
      const generation = ++request;
      void invoke<{ iconStyle?: unknown }>('get_app_settings').then(settings => {
        if (!disposed && generation === request && isIconStyle(settings?.iconStyle)) setStyle(settings.iconStyle);
      }).catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    void listen('nowly-data-changed', refresh).then(unlisten => disposed ? unlisten() : remove = unlisten).catch(() => undefined);
    return () => { disposed = true; remove?.(); window.removeEventListener('focus', refresh); };
  }, []);
  return <IconStyleProvider style={style}>{children}</IconStyleProvider>;
}
