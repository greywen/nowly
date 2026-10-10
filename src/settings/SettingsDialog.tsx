import { X } from '../components/icons';
import type { IconStyle } from '../components/icon-style';
import { useEffect, useState } from 'react';
import { AssistantSettingsPanel } from '../assistant/AssistantSettingsPanel';
import { BarMenuSettings } from './BarMenuSettings';
import { normalizeBarMenu } from '../app/bar-menu';
import { ShortcutRecorder, normalizeShortcut } from './ShortcutRecorder';
import { invoke } from '@tauri-apps/api/core';
import './shortcut-settings.css';
type ShortcutStatus = {shortcut:string;registered:boolean;error:string|null};
type ShortcutStatuses = {screenshot:ShortcutStatus;history:ShortcutStatus};
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import type { AppSettings, MonitorInfo } from '../data/nowly-repository';
import { t, useTranslation, type Language } from '../i18n';

type Props={settings:AppSettings;monitors?:MonitorInfo[];onClose():void;onSave(settings:AppSettings):Promise<AppSettings>};
type SettingsTab='interface'|'desktop'|'notifications'|'model'|'shortcuts';
function errorMessage(error:unknown){return typeof error==='object'&&error!==null&&'message'in error&&typeof error.message==='string'?error.message:t('settings.saveError')}

export function SettingsDialog({settings,monitors=[],onClose,onSave}:Props){
 // Language switches in real time via the i18n store, independent of the save
 // button, so the whole UI updates the moment the user picks a language.
 const {language,setLanguage}=useTranslation();
 const [draft,setDraft]=useState(()=>({...settings, barMenu: normalizeBarMenu(settings.barMenu), notificationMode: settings.notificationMode ?? 'persistent', quickPanelEnabled: true, quickPanelShortcut: settings.quickPanelShortcut ?? 'Ctrl+Space', screenshotShortcut: settings.screenshotShortcut ?? 'Ctrl+Alt+A', screenshotHistoryShortcut: settings.screenshotHistoryShortcut ?? 'Ctrl+Alt+H'})); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null);
 const [tab,setTab]=useState<SettingsTab>('interface');
 const [shortcutStatus,setShortcutStatus]=useState<ShortcutStatuses|null>(null);
 const [statusError,setStatusError]=useState(false);
 useEffect(()=>{if(tab!=='shortcuts')return;let active=true;setStatusError(false);void invoke<ShortcutStatuses>('screenshot_shortcut_status').then(value=>{if(active)setShortcutStatus(value);}).catch(()=>{if(active)setStatusError(true);});return()=>{active=false;};},[tab]);
 // Resolve the monitor that should appear selected: the saved id when it still
 // matches a connected monitor, otherwise the primary (or first) one. Falling
 // back here rather than trusting the saved id blindly keeps the dropdown from
 // showing a blank placeholder when the saved monitor is gone or unset.
 const resolvedMonitorId=monitors.length?((draft.targetMonitorId&&monitors.some(item=>item.id===draft.targetMonitorId))?draft.targetMonitorId:monitors.find(item=>item.isPrimary)?.id??monitors[0].id):null;
 // Sync that resolved id back into the draft so saving persists exactly what
 // the dropdown shows, instead of a null or stale id.
 useEffect(()=>{if(resolvedMonitorId&&resolvedMonitorId!==draft.targetMonitorId)setDraft(current=>({...current,targetMonitorId:resolvedMonitorId}));},[resolvedMonitorId,draft.targetMonitorId]);
 const toggle=(key:keyof AppSettings)=>(event:React.ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:event.target.checked}));
 async function save(){
  const screenshotShortcut=normalizeShortcut(draft.screenshotShortcut);
  const screenshotHistoryShortcut=normalizeShortcut(draft.screenshotHistoryShortcut);
  if(!screenshotShortcut||!screenshotHistoryShortcut){setError(t('settings.shortcutInvalid'));return;}
  if(screenshotShortcut===screenshotHistoryShortcut){setError(t('settings.shortcutDuplicate'));return;}
  setSaving(true);setError(null);try{await onSave({...draft,screenshotShortcut,screenshotHistoryShortcut,quickPanelEnabled:true});onClose();}catch(reason){setError(typeof reason==='object'&&reason!==null&&'field'in reason&&['screenshotShortcut','screenshotHistoryShortcut'].includes(String(reason.field))?t('settings.shortcutConflict'):errorMessage(reason));}finally{setSaving(false)}
 }
 const tabs:TabItem<SettingsTab>[]=[{id:'interface',label:t('settings.interface')},{id:'desktop',label:t('settings.desktopStartup')},{id:'notifications',label:t('settings.notifications')},{id:'shortcuts',label:t('settings.shortcuts')},{id:'model',label:t('settings.model')}];
 return <Dialog title={t('settings.title')} ariaLabelledBy="settings-title" onRequestClose={onClose} className="settings-dialog" headerActions={<button className="good-icon-button" aria-label={t('settings.close')} onClick={onClose}><X aria-hidden="true"/></button>} footer={<><button className="good-button" onClick={onClose}>{t('common.cancel')}</button><button className="good-button good-button--primary" disabled={saving} onClick={()=>void save()}>{saving?t('common.saving'):t('settings.saveSettings')}</button></>}>
  <div className="settings-form">
   <Tabs idPrefix="settings" label={t('settings.title')} items={tabs} value={tab} onChange={setTab}/>
   <TabPanel idPrefix="settings" tabId="interface" active={tab==='interface'}>
    <div className="settings-grid">
     <Select id="settings-language" label={t('settings.language')} value={language} options={[{value:'zh',label:t('settings.langZh')},{value:'en',label:t('settings.langEn')}]} onChange={value=>setLanguage(value as Language)}/>
     <Select id="settings-density" label={t('settings.density')} value={draft.density} options={[{value:'compact',label:t('settings.densityCompact')},{value:'balanced',label:t('settings.densityBalanced')},{value:'comfortable',label:t('settings.densityComfortable')}]} onChange={value=>setDraft({...draft,density:value as AppSettings['density']})}/>
     <Select id="settings-icon-style" label={t('settings.iconStyle')} value={draft.iconStyle} options={[{value:'duotone',label:t('settings.iconStyleDuotone')},{value:'solid',label:t('settings.iconStyleSolid')},{value:'outline',label:t('settings.iconStyleOutline')}]} onChange={value=>setDraft({...draft,iconStyle:value as IconStyle})}/>
    </div>
    <div className="settings-checks">
     <Check label={t('settings.hideTopbarInWallpaper')} checked={draft.hideTopbarInWallpaper} onChange={toggle('hideTopbarInWallpaper')}/>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="notifications" active={tab==='notifications'}>
    <div className="settings-grid">
     <Select id="settings-notification-mode" label={t('settings.notificationMode')} value={draft.notificationMode ?? 'persistent'} options={[{value:'persistent',label:t('settings.notificationModePersistent')},{value:'notification',label:t('settings.notificationModeNotification')}]} onChange={value=>setDraft({...draft,notificationMode:value as NonNullable<AppSettings['notificationMode']>})}/>
    </div>
    <BarMenuSettings menu={draft.barMenu} onChange={barMenu=>setDraft(current=>({...current,barMenu}))}/>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="desktop" active={tab==='desktop'}>
    {monitors.length?<Select id="settings-monitor" label={t('settings.targetMonitor')} value={resolvedMonitorId??''} options={monitors.map(item=>({value:item.id,label:`${item.name}${item.isPrimary?t('settings.primaryMonitor'):''} · ${item.width}×${item.height} · ${Math.round(item.scaleFactor*100)}%`}))} onChange={value=>setDraft({...draft,targetMonitorId:value})}/>:null}
    <div className="settings-checks">
     <Check label={t('settings.restoreWallpaper')} checked={draft.wallpaperEnabled} onChange={toggle('wallpaperEnabled')}/><Check label={t('settings.launchAtLogin')} checked={draft.launchAtLogin} onChange={toggle('launchAtLogin')}/>
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="shortcuts" active={tab==='shortcuts'}>
    <div className="shortcut-settings">
     <ShortcutRecorder id="settings-screenshot-shortcut" label={t('settings.screenshotShortcut')} value={draft.screenshotShortcut} otherValue={draft.screenshotHistoryShortcut} disabled={saving} onChange={screenshotShortcut=>setDraft(current=>({...current,screenshotShortcut}))}/>
     <ShortcutRecorder id="settings-history-shortcut" label={t('settings.screenshotHistoryShortcut')} value={draft.screenshotHistoryShortcut} otherValue={draft.screenshotShortcut} disabled={saving} onChange={screenshotHistoryShortcut=>setDraft(current=>({...current,screenshotHistoryShortcut}))}/>
     <p className="shortcut-settings__status">{t('settings.shortcutPending')}</p>
     {statusError?<p className="shortcut-settings__status shortcut-settings__status--error" role="status">{t('settings.shortcutStatusError')}</p>:shortcutStatus?(['screenshot','history'] as const).map(action=>{const status=shortcutStatus[action];return <p key={action} className={`shortcut-settings__status${status.registered?'':' shortcut-settings__status--error'}`} role="status">{t(action==='screenshot'?'settings.screenshotShortcut':'settings.screenshotHistoryShortcut')}: {status.shortcut} — {t(status.registered?'settings.shortcutRegistered':'settings.shortcutUnavailable')}</p>;}):<p role="status" className="shortcut-settings__status">{t('settings.shortcutStatusLoading')}</p>}
    </div>
   </TabPanel>
   <TabPanel idPrefix="settings" tabId="model" active={tab==='model'}>
    <AssistantSettingsPanel/>
   </TabPanel>
   {error?<div className="dialog-error" role="alert">{error}</div>:null}
  </div>
 </Dialog>;
}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(event:React.ChangeEvent<HTMLInputElement>)=>void}){return <label className="form-check form-check-custom form-check-solid"><input className="form-check-input" type="checkbox" checked={checked} onChange={onChange}/><span className="form-check-label">{label}</span></label>}
