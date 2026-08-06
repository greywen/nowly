import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';

export type SettingsResource = { status:'loading'|'ready'|'error'; data:AppSettings; message?:string };
export const defaultSettings: AppSettings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true };

function message(error:unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '设置操作失败，请重试。';
}

export function useSettings() {
  const repository = useNowlyRepository();
  const [settings,setSettings] = useState<SettingsResource>({status:'loading',data:defaultSettings});
  const [writeError,setWriteError] = useState<string|null>(null);
  const [monitors,setMonitors] = useState<{status:'loading'|'ready'|'error';data:MonitorInfo[];message?:string}>({status:'loading',data:[]});
  const loadSettings = useCallback(async () => {
    setSettings(current=>({status:'loading',data:current.data}));
    try { setSettings({status:'ready',data:await repository.getSettings()}); }
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
    try {
      const saved=await repository.updateSettings(draft);
      setSettings({status:'ready',data:saved});
      return saved;
    } catch(error) { setWriteError(message(error)); throw error; }
  },[repository]);
  return {settings,monitors,writeError,retrySettings:loadSettings,retryMonitors:loadMonitors,saveSettings,dismissWriteError:()=>setWriteError(null)};
}
