import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../data/nowly-repository';
import { useNowlyRepository } from '../data/RepositoryContext';

export type SettingsResource = { status:'loading'|'ready'|'error'; data:AppSettings; message?:string };
export const defaultSettings: AppSettings = { wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced', weekStart:'monday', dateFormat:'localized', showWeekends:true, calendarEnabled:true, matrixEnabled:true, notesEnabled:true };

function message(error:unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '设置操作失败，请重试。';
}

export function useSettings() {
  const repository = useNowlyRepository();
  const [settings,setSettings] = useState<SettingsResource>({status:'loading',data:defaultSettings});
  const [writeError,setWriteError] = useState<string|null>(null);
  const loadSettings = useCallback(async () => {
    setSettings(current=>({status:'loading',data:current.data}));
    try { setSettings({status:'ready',data:await repository.getSettings()}); }
    catch(error) { setSettings(current=>({status:'error',data:current.data,message:message(error)})); }
  },[repository]);
  useEffect(()=>{ void loadSettings(); },[loadSettings]);
  const saveSettings = useCallback(async (draft:AppSettings) => {
    setWriteError(null);
    try {
      const saved=await repository.updateSettings(draft);
      setSettings({status:'ready',data:saved});
      return saved;
    } catch(error) { setWriteError(message(error)); throw error; }
  },[repository]);
  return {settings,writeError,retrySettings:loadSettings,saveSettings,dismissWriteError:()=>setWriteError(null)};
}
