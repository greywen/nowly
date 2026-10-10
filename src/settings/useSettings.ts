import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_ICON_STYLE } from '../components/icon-style';
import { normalizeBarMenu } from '../app/bar-menu';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';
import { t } from '../i18n';

export type SettingsResource = { status:'loading'|'ready'|'error'; data:AppSettings; message?:string };
export const defaultSettings: AppSettings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true, iconStyle:DEFAULT_ICON_STYLE, hideTopbarInWallpaper:true, notificationMode:'persistent', quickPanelEnabled:true, quickPanelShortcut:'Ctrl+Space', screenshotShortcut:'Ctrl+Alt+A', screenshotHistoryShortcut:'Ctrl+Alt+H', barMenu:normalizeBarMenu(undefined), recentColors:[] };

function message(error:unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : t('settings.opError');
}

export function useSettings() {
  const repository = useNowlyRepository();
  const [settings,setSettings] = useState<SettingsResource>({status:'loading',data:defaultSettings});
  const [writeError,setWriteError] = useState<string|null>(null);
  const [monitors,setMonitors] = useState<{status:'loading'|'ready'|'error';data:MonitorInfo[];message?:string}>({status:'loading',data:[]});
  const loadSettings = useCallback(async () => {
    setSettings(current=>({status:'loading',data:current.data}));
    try {
      const data = await repository.getSettings();
      setSettings({status:'ready',data:{...data,barMenu:normalizeBarMenu(data.barMenu)}});
    }
    catch(error) { setSettings(current=>({status:'error',data:current.data,message:message(error)})); }
  },[repository]);
  const loadMonitors = useCallback(async()=>{
    setMonitors(current=>({status:'loading',data:current.data}));
    try{setMonitors({status:'ready',data:await repository.listMonitors()});}
    catch(error){setMonitors(current=>({status:'error',data:current.data,message:message(error)}));}
  },[repository]);
  useEffect(()=>{ void loadSettings(); void loadMonitors(); },[loadSettings,loadMonitors]);
  const saveSettings = useCallback(async (draft:AppSettings) => {
    setWriteError(null);
    const previous = settings;
    const normalized = {...draft,barMenu:normalizeBarMenu(draft.barMenu)};
    setSettings({status:'ready',data:normalized});
    try {
      const response=await repository.updateSettings(normalized);
      const saved={...response,barMenu:normalizeBarMenu(response.barMenu)};
      setSettings({status:'ready',data:saved});
      return saved;
    } catch(error) { setSettings(previous); setWriteError(message(error)); throw error; }
  },[repository, settings]);
  return {settings,monitors,writeError,retrySettings:loadSettings,retryMonitors:loadMonitors,saveSettings,dismissWriteError:()=>setWriteError(null)};
}
